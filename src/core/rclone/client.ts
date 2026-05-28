/**
 * rclone integration for bulk transfer and sync. We run a long-lived
 * `rclone rcd` daemon and drive it over its JSON-RPC HTTP API. Backends are
 * passed as on-the-fly connection strings so no secrets are written to
 * rclone.conf. Passwords are obscured via the rclone CLI on demand.
 */
import type { Subprocess } from "bun";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import type { Connection } from "../../shared/domain";
import { resolveKeyPath } from "../connections/keys";

/** Ask the OS for a free localhost TCP port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export interface RcloneStats {
  bytes: number;
  totalBytes: number;
  speed: number;
  transfers: number;
  totalTransfers: number;
  errors: number;
  eta: number | null;
}

export interface RcloneJob {
  jobid: number;
}

/**
 * Locate the rclone binary. Order: explicit env override, a binary bundled in
 * the app's Resources (production), then the system PATH (dev).
 */
function resolveRcloneBinary(): string {
  if (process.env.KIRA_RCLONE_PATH) return process.env.KIRA_RCLONE_PATH;
  // Electrobun copies extra resources next to the bun executable; check there.
  try {
    const bundled = `${import.meta.dir}/rclone`;
    if (existsSync(bundled)) return bundled;
  } catch {
    /* import.meta.dir unavailable in some contexts */
  }
  return "rclone";
}

export class RcloneClient {
  private proc: Subprocess | null = null;
  private addr = "";
  private user = "kira";
  private pass = "";
  private obscureCache = new Map<string, string>();

  /** Start the daemon if not already running. Idempotent. */
  async ensureDaemon(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) return;

    const port = await freePort();
    this.addr = `127.0.0.1:${port}`;
    this.pass = crypto.randomUUID();

    this.proc = Bun.spawn(
      [
        resolveRcloneBinary(),
        "rcd",
        `--rc-addr=${this.addr}`,
        `--rc-user=${this.user}`,
        `--rc-pass=${this.pass}`,
        "--rc-serve=false",
        "--transfers=8",
        "--checkers=16",
        "--use-mmap",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    try {
      await this.waitReady();
    } catch (err) {
      // don't leave an orphaned daemon if it never became ready
      this.proc.kill();
      this.proc = null;
      throw err;
    }
  }

  private async waitReady(timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        await this.call("rc/noop", {});
        return;
      } catch {
        await Bun.sleep(150);
      }
    }
    throw new Error("rclone daemon did not become ready in time");
  }

  /** Stop the daemon (app shutdown). */
  async stop(): Promise<void> {
    if (this.proc) {
      try {
        await this.call("core/quit", {});
      } catch {
        this.proc.kill();
      }
      this.proc = null;
    }
  }

  /** Synchronously kill the daemon (for non-awaitable exit handlers). */
  killSync(): void {
    this.proc?.kill();
    this.proc = null;
  }

  /** Low-level RC call. */
  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    const res = await fetch(`http://${this.addr}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " + Buffer.from(`${this.user}:${this.pass}`).toString("base64"),
      },
      body: JSON.stringify(params ?? {}),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`rclone ${method} failed (${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  }

  /** Obscure a plaintext password (cached). Passes via stdin, not argv. */
  private async obscure(plain: string): Promise<string> {
    const cached = this.obscureCache.get(plain);
    if (cached) return cached;
    // "obscure -" reads from stdin so the secret never appears in `ps`.
    const proc = Bun.spawn([resolveRcloneBinary(), "obscure", "-"], {
      stdin: "pipe",
      stdout: "pipe",
    });
    proc.stdin.write(plain);
    await proc.stdin.end();
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    this.obscureCache.set(plain, out);
    return out;
  }

  /**
   * Build an on-the-fly rclone fs string for a connection + remote path.
   * Examples:
   *   :sftp,host=h,port=22,user=u,key_file=/p:/remote/path
   *   :ftp,host=h,port=21,user=u,pass=OBSCURED:/remote/path
   */
  async buildFs(conn: Connection, remotePath: string): Promise<string> {
    const opts: string[] = [`host=${conn.host}`, `port=${conn.port}`, `user=${conn.user}`];

    if (conn.type === "sftp") {
      if (conn.authType === "agent") {
        opts.push("key_use_agent=true");
      } else if (conn.authType === "password" && conn.password) {
        opts.push(`pass=${await this.obscure(conn.password)}`);
      } else {
        // key auth: explicit path, else discovered ~/.ssh key, else agent
        const keyPath = resolveKeyPath(conn.sshKeyPath);
        if (keyPath) opts.push(`key_file=${keyPath}`);
        else opts.push("key_use_agent=true");
      }
      const fs = `:sftp,${opts.join(",")}:`;
      return `${fs}${remotePath}`;
    }

    // ftp / ftps
    if (conn.password) opts.push(`pass=${await this.obscure(conn.password)}`);
    if (conn.type === "ftps") opts.push("tls=true", "no_check_certificate=true");
    if (!conn.ftpPassiveMode) opts.push("disable_epsv=true");
    const fs = `:ftp,${opts.join(",")}:`;
    return `${fs}${remotePath}`;
  }

  /** Start an async sync/copy job. Returns the rclone job id. */
  async startSync(params: {
    srcFs: string;
    dstFs: string;
    /** sync = make dst match src (deletes); copy = additive. */
    mode: "sync" | "copy";
    filters?: string[];
    /** create-empty-src-dirs etc. */
    extra?: Record<string, unknown>;
  }): Promise<number> {
    const method = params.mode === "sync" ? "sync/sync" : "sync/copy";
    const body: Record<string, unknown> = {
      srcFs: params.srcFs,
      dstFs: params.dstFs,
      _async: true,
      _config: { Transfers: 8, Checkers: 16 },
      ...params.extra,
    };
    if (params.filters && params.filters.length > 0) {
      body._filter = { ExcludeRule: params.filters };
    }
    const res = await this.call<RcloneJob>(method, body);
    return res.jobid;
  }

  /**
   * Start an async bidirectional bisync job. When `resync` is set we also pass
   * `resyncMode: "newer"` so the baseline run keeps the newest version of each
   * conflicting file instead of blindly favouring one side.
   */
  async startBisync(params: {
    path1: string;
    path2: string;
    resync?: boolean;
    filters?: string[];
  }): Promise<number> {
    const body: Record<string, unknown> = {
      path1: params.path1,
      path2: params.path2,
      _async: true,
    };
    if (params.resync) {
      body.resync = true;
      body.resyncMode = "newer";
    }
    if (params.filters && params.filters.length > 0) {
      body._filter = { ExcludeRule: params.filters };
    }
    const res = await this.call<RcloneJob>("sync/bisync", body);
    return res.jobid;
  }

  /** Poll a job's status. */
  async jobStatus(jobid: number): Promise<{
    finished: boolean;
    success: boolean;
    error: string;
    duration: number;
  }> {
    return this.call("job/status", { jobid });
  }

  /** Stop a running job. */
  async stopJob(jobid: number): Promise<void> {
    await this.call("job/stop", { jobid });
  }

  /** Recursively list an fs, returning rclone's structured entries. */
  async listFs(
    fs: string,
    recurse = true,
  ): Promise<
    Array<{ Path: string; Name: string; Size: number; ModTime: string; IsDir: boolean }>
  > {
    const res = await this.call<{
      list: Array<{
        Path: string;
        Name: string;
        Size: number;
        ModTime: string;
        IsDir: boolean;
      }>;
    }>("operations/list", {
      fs,
      remote: "",
      opt: { recurse, noModTime: false },
    });
    return res.list ?? [];
  }

  /** Per-job transfer stats (bytes/speed/eta). */
  async jobStats(jobid: number): Promise<RcloneStats> {
    const raw = await this.call<{
      bytes?: number;
      totalBytes?: number;
      speed?: number;
      transfers?: number;
      totalTransfers?: number;
      errors?: number;
      eta?: number | null;
    }>("core/stats", { group: `job/${jobid}` });
    return {
      bytes: raw.bytes ?? 0,
      totalBytes: raw.totalBytes ?? 0,
      speed: raw.speed ?? 0,
      transfers: raw.transfers ?? 0,
      totalTransfers: raw.totalTransfers ?? 0,
      errors: raw.errors ?? 0,
      eta: raw.eta ?? null,
    };
  }

  /**
   * Dry-run a one-way sync and return the planned operations as text lines.
   * Uses sync/copy with dryRun; combined output captured from core stats and
   * the operations/check transfer list is approximated via the log.
   */
  async dryRun(params: {
    srcFs: string;
    dstFs: string;
    mode: "sync" | "copy";
    filters?: string[];
  }): Promise<number> {
    const method = params.mode === "sync" ? "sync/sync" : "sync/copy";
    const body: Record<string, unknown> = {
      srcFs: params.srcFs,
      dstFs: params.dstFs,
      _async: true,
      _config: { DryRun: true },
    };
    if (params.filters && params.filters.length > 0) {
      body._filter = { ExcludeRule: params.filters };
    }
    const res = await this.call<RcloneJob>(method, body);
    return res.jobid;
  }
}
