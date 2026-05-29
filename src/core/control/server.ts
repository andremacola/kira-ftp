/**
 * Local control server (loopback only) so external tools — a CLI invoked from
 * Sublime/VSCode/Zed — can trigger upload/download/sync on a path. Listens on a
 * fixed port, guarded by a token persisted in the app data dir. The CLI reads
 * the same token file and POSTs commands; the app resolves the owning project.
 */
import { statSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { appDataDir } from "../paths";
import type { AppContext } from "../app-context";
import { PathResolver, type ResolvedTarget } from "../services/path-resolver";
import { rulesToRcloneFilters } from "../util/ignore";
import { joinRemote, dirnameRemote } from "../connections/transport";

export const DEFAULT_CONTROL_PORT = 8911;

/** Resolved lazily so it honors KIRA_DATA_DIR set after module load. */
function tokenFile(): string {
  return join(appDataDir(), "control-token");
}
function portFile(): string {
  return join(appDataDir(), "control-port");
}

/** Persist the active control port so the CLI can find it without the DB. */
export function writeControlPort(port: number): void {
  try {
    mkdirSync(appDataDir(), { recursive: true });
    writeFileSync(portFile(), String(port));
  } catch {
    /* best effort */
  }
}

/** Read the control port the running app published, or the default. */
export function readControlPort(): number {
  try {
    const n = parseInt(readFileSync(portFile(), "utf-8").trim(), 10);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  } catch {
    /* fall through */
  }
  return DEFAULT_CONTROL_PORT;
}

/** Read the control token, creating one if needed. */
export function ensureControlToken(): string {
  const file = tokenFile();
  if (existsSync(file)) return readFileSync(file, "utf-8").trim();
  mkdirSync(appDataDir(), { recursive: true });
  const token = crypto.randomUUID();
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export function readControlToken(): string | null {
  try {
    return readFileSync(tokenFile(), "utf-8").trim();
  } catch {
    return null;
  }
}

export type ControlAction = "upload" | "download" | "sync-up" | "sync-down" | "sync-both";

interface ControlRequest {
  action: ControlAction;
  path: string;
}

export type ControlState = "active" | "stopped" | "failed";

export interface ControlStatus {
  state: ControlState;
  port: number;
  error: string | null;
}

export class ControlServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private token: string;
  private resolver: PathResolver;
  private state: ControlState = "stopped";
  private lastError: string | null = null;

  constructor(private ctx: AppContext) {
    this.token = ensureControlToken();
    this.resolver = new PathResolver({
      listProjects: () => ctx.projects.list(),
      listEnvironments: (id) => ctx.environments.listForProject(id),
      getConnection: (id) => ctx.connections.get(id),
    });
  }

  /** Current control-server status for the global settings UI. */
  status(): ControlStatus {
    return { state: this.state, port: this.port(), error: this.lastError };
  }

  /** Emit a log line to the shared log panel. */
  private log(level: "info" | "warn" | "error", message: string): void {
    this.ctx.bus.emit("log", { level, message, at: new Date().toISOString() });
  }

  /** Active control port (from settings, else default). */
  port(): number {
    const v = this.ctx.settings.get("controlPort");
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_CONTROL_PORT;
  }

  /** Change the port and restart the server (persists for the CLI). */
  setPort(port: number): void {
    this.ctx.settings.set("controlPort", String(port));
    this.stop();
    this.start();
  }

  start(): void {
    if (this.server) return;
    const port = this.port();
    try {
      this.server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch: (req) => this.handle(req),
      });
      writeControlPort(port);
      this.state = "active";
      this.lastError = null;
      this.log("info", `Control server listening on 127.0.0.1:${port}`);
    } catch (err) {
      // Port busy usually means another Kira FTP instance owns it. Don't crash
      // the app — the CLI will talk to whichever instance holds the port.
      this.server = null;
      this.state = "failed";
      this.lastError = (err as Error).message;
      this.log("error", `Control server failed on port ${port}: ${this.lastError}`);
    }
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
    this.state = "stopped";
  }

  /** Constant-time token comparison (avoids prefix/length timing leaks). */
  private tokenMatches(provided: string | null): boolean {
    if (!provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(this.token);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Reject anything carrying a browser Origin/Referer: the CLI never sends
    // them, so this blocks any web page from driving the server via fetch even
    // if it somehow obtained the token (defense-in-depth, survives refactors).
    if (req.headers.get("origin") || req.headers.get("referer")) {
      return this.json({ ok: false, error: "forbidden" }, 403);
    }

    if (url.pathname === "/ping") return this.json({ ok: true, app: "kira-ftp" });

    if (!this.tokenMatches(req.headers.get("x-kira-token"))) {
      return this.json({ ok: false, error: "unauthorized" }, 401);
    }
    if (url.pathname !== "/command" || req.method !== "POST") {
      return this.json({ ok: false, error: "not found" }, 404);
    }

    let body: ControlRequest;
    try {
      body = (await req.json()) as ControlRequest;
    } catch {
      return this.json({ ok: false, error: "invalid JSON body" }, 400);
    }

    const target = this.resolver.resolve(body.path);
    if (!target) {
      this.log("warn", `CLI ${body.action}: no project contains ${body.path}`);
      return this.json(
        { ok: false, error: `No project contains: ${body.path}` },
        404,
      );
    }

    try {
      const result = await this.dispatch(body.action, target);
      this.log("info", `CLI ${body.action} [${target.project.name}]: ${result.message}`);
      return this.json({ ok: true, project: target.project.name, ...result });
    } catch (err) {
      this.log("error", `CLI ${body.action} [${target.project.name}] failed: ${(err as Error).message}`);
      return this.json({ ok: false, error: (err as Error).message }, 500);
    }
  }

  /** Run the requested action against the resolved target. */
  private async dispatch(
    action: ControlAction,
    t: ResolvedTarget,
  ): Promise<{ job?: string; message: string }> {
    const { ctx } = this;
    const filters = rulesToRcloneFilters(ctx.ignoreRules.listForProject(t.project.id));
    let isDir = false;
    try {
      isDir = statSync(t.localPath).isDirectory();
    } catch {
      // local path may not exist for a download into a new location
    }

    if (action === "upload") {
      const job = isDir
        ? ctx.transfers.enqueueUploadFolder(t.connection, t.localPath, t.remotePath, filters)
        : ctx.transfers.enqueueUpload(t.connection, t.localPath, t.remotePath);
      return { job: job.id, message: `upload ${t.relPath || basename(t.localPath)} → ${t.remotePath}` };
    }

    if (action === "download") {
      const remoteStat = await ctx.fileService.statRemote(t.connection, t.remotePath);
      const remoteIsDir = remoteStat?.type === "dir";
      const job = remoteIsDir
        ? ctx.transfers.enqueueDownloadFolder(t.connection, t.remotePath, t.localPath, filters)
        : ctx.transfers.enqueueDownload(t.connection, t.remotePath, t.localPath);
      return { job: job.id, message: `download ${t.remotePath} → ${t.localPath}` };
    }

    // sync actions operate on the directory (file -> its parent dir)
    const localDir = isDir ? t.localPath : dirname(t.localPath);
    const remoteDir = isDir ? t.remotePath : dirnameRemote(t.remotePath);
    const opts = {
      skipDeletes: t.project.syncSkipDeletes,
      sameAge: t.project.syncSameAge,
      filters,
    };

    if (action === "sync-up") {
      const job = ctx.transfers.enqueueSync(
        t.connection, "up", `Sync up ${t.relPath || "."}`,
        () => ctx.sync.runOneWay(t.connection, localDir, remoteDir, "up", opts),
        t.project.id,
      );
      return { job: job.id, message: `sync up ${localDir} → ${remoteDir}` };
    }
    if (action === "sync-down") {
      const job = ctx.transfers.enqueueSync(
        t.connection, "down", `Sync down ${t.relPath || "."}`,
        () => ctx.sync.runOneWay(t.connection, localDir, remoteDir, "down", opts),
        t.project.id,
      );
      return { job: job.id, message: `sync down ${remoteDir} → ${localDir}` };
    }
    // sync-both
    const job = ctx.transfers.enqueueSync(
      t.connection, "both", `Sync both ${t.relPath || "."}`,
      () => ctx.sync.runBoth(t.connection, localDir, remoteDir, opts),
      t.project.id,
    );
    return { job: job.id, message: `sync both ${localDir} ↔ ${remoteDir}` };
  }
}
