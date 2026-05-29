/**
 * Local control server (loopback only) so external tools — a CLI invoked from
 * Sublime/VSCode/Zed — can trigger upload/download/sync on a path. Listens on a
 * fixed port, guarded by a token persisted in the app data dir. The CLI reads
 * the same token file and POSTs commands; the app resolves the owning project.
 */
import { statSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { appDataDir } from "../paths";
import type { AppContext } from "../app-context";
import { PathResolver, type ResolvedTarget } from "../services/path-resolver";
import { rulesToRcloneFilters } from "../util/ignore";
import { joinRemote } from "../connections/transport";

export const CONTROL_PORT = 8911;

/** Resolved lazily so it honors KIRA_DATA_DIR set after module load. */
function tokenFile(): string {
  return join(appDataDir(), "control-token");
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

export class ControlServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private token: string;
  private resolver: PathResolver;

  constructor(private ctx: AppContext) {
    this.token = ensureControlToken();
    this.resolver = new PathResolver({
      listProjects: () => ctx.projects.list(),
      listEnvironments: (id) => ctx.environments.listForProject(id),
      getConnection: (id) => ctx.connections.get(id),
    });
  }

  start(): void {
    if (this.server) return;
    this.server = Bun.serve({
      port: CONTROL_PORT,
      hostname: "127.0.0.1",
      fetch: (req) => this.handle(req),
    });
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ping") return this.json({ ok: true, app: "kira-ftp" });

    if (req.headers.get("x-kira-token") !== this.token) {
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
      return this.json(
        { ok: false, error: `No project contains: ${body.path}` },
        404,
      );
    }

    try {
      const result = await this.dispatch(body.action, target);
      return this.json({ ok: true, project: target.project.name, ...result });
    } catch (err) {
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
    const remoteDir = isDir ? t.remotePath : remoteParent(t.remotePath);
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

/** Parent of a remote (POSIX) path. */
function remoteParent(p: string): string {
  const t = p.replace(/\/$/, "");
  const i = t.lastIndexOf("/");
  return i <= 0 ? "/" : t.slice(0, i);
}
