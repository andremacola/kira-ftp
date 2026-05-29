/**
 * Connection pool keyed by connection id. Keeps one live Transport per server
 * and reconnects transparently when the link drops. A single in-flight connect
 * is shared so concurrent callers never create duplicate connections.
 *
 * SFTP multiplexes many operations over one ssh2 connection, so those run
 * concurrently. FTP/FTPS cannot share a control connection across simultaneous
 * transfers, so operations on a single FTP connection are serialized.
 */
import type { Connection, ConnectionState } from "../../shared/domain";
import { FtpTransport } from "./ftp";
import { SftpTransport } from "./sftp";
import type { Transport } from "./transport";

export function createTransport(conn: Connection): Transport {
  return conn.type === "sftp"
    ? new SftpTransport(conn)
    : new FtpTransport(conn);
}

export class ConnectionPool {
  private transports = new Map<number, Transport>();
  private connecting = new Map<number, Promise<Transport>>();
  /** Per-connection serialization tail for non-multiplexing transports. */
  private queues = new Map<number, Promise<unknown>>();
  /** Count of in-flight withTransport ops, for the activity indicator. */
  private inFlight = 0;
  private onActivity: ((busy: boolean) => void) | null = null;
  private onState: ((connId: number, state: ConnectionState) => void) | null = null;
  private onLog: ((message: string) => void) | null = null;

  /** Last activity (ms epoch) per connection, used by the idle sweeper. */
  private lastActivity = new Map<number, number>();
  /** Per-connection in-flight op count, so a busy link is never reaped. */
  private connInFlight = new Map<number, number>();
  private idleMs = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  /** Subscribe to remote-activity changes (true when any op is in flight). */
  setActivityListener(fn: (busy: boolean) => void): void {
    this.onActivity = fn;
  }
  /** Subscribe to per-connection state transitions (connecting/…/disconnected). */
  setStateListener(fn: (connId: number, state: ConnectionState) => void): void {
    this.onState = fn;
  }
  /** Subscribe to pool log lines (e.g. idle reaps). */
  setLogListener(fn: (message: string) => void): void {
    this.onLog = fn;
  }

  private enter(connId: number): void {
    if (this.inFlight++ === 0) this.onActivity?.(true);
    this.connInFlight.set(connId, (this.connInFlight.get(connId) ?? 0) + 1);
    this.lastActivity.set(connId, Date.now());
  }
  private leave(connId: number): void {
    if (--this.inFlight === 0) this.onActivity?.(false);
    if (this.inFlight < 0) this.inFlight = 0;
    const n = (this.connInFlight.get(connId) ?? 1) - 1;
    if (n <= 0) this.connInFlight.delete(connId);
    else this.connInFlight.set(connId, n);
    this.lastActivity.set(connId, Date.now());
  }

  /** Get a live transport, sharing a single connect across concurrent calls. */
  private getTransport(conn: Connection): Promise<Transport> {
    const existing = this.transports.get(conn.id);
    if (existing && existing.isAlive()) return Promise.resolve(existing);

    const pending = this.connecting.get(conn.id);
    if (pending) return pending;

    const connect = (async () => {
      if (existing) {
        await this.safeDisconnect(existing);
        this.transports.delete(conn.id);
      }
      const transport = createTransport(conn);
      this.onState?.(conn.id, "connecting");
      try {
        await transport.connect();
      } catch (err) {
        this.onState?.(conn.id, "error");
        throw err;
      }
      this.transports.set(conn.id, transport);
      this.onState?.(conn.id, "connected");
      return transport;
    })();
    this.connecting.set(conn.id, connect);
    try {
      return connect;
    } finally {
      // clear the in-flight marker once it settles (success or failure)
      void connect.finally(() => {
        if (this.connecting.get(conn.id) === connect) this.connecting.delete(conn.id);
      });
    }
  }

  /** Run work with a live transport. FTP is serialized; SFTP runs concurrently. */
  async withTransport<T>(
    conn: Connection,
    fn: (t: Transport) => Promise<T>,
  ): Promise<T> {
    this.enter(conn.id);
    const done = () => this.leave(conn.id);
    if (conn.type === "sftp") {
      const p = this.getTransport(conn).then(fn);
      p.then(done, done);
      return p;
    }
    // serialize FTP/FTPS ops on the same connection
    const prev = this.queues.get(conn.id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const transport = await this.getTransport(conn);
      return fn(transport);
    });
    run.then(done, done);
    // keep the chain alive even if this op throws
    this.queues.set(
      conn.id,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /** Force-close a connection (manual disconnect, idle reap, edited config). */
  async close(connId: number): Promise<void> {
    this.connecting.delete(connId);
    this.queues.delete(connId);
    this.lastActivity.delete(connId);
    this.connInFlight.delete(connId);
    const transport = this.transports.get(connId);
    this.transports.delete(connId);
    if (transport) await this.safeDisconnect(transport);
    // Always announce the disconnect so the UI clears a stale "connected".
    this.onState?.(connId, "disconnected");
  }

  /** Close everything (app shutdown). */
  async closeAll(): Promise<void> {
    this.stopIdleSweeper();
    const all = [...this.transports.values()];
    this.transports.clear();
    this.connecting.clear();
    this.queues.clear();
    this.lastActivity.clear();
    this.connInFlight.clear();
    await Promise.all(all.map((t) => this.safeDisconnect(t)));
  }

  /** Configure idle auto-disconnect. ms <= 0 disables it. */
  setIdleTimeout(ms: number): void {
    this.idleMs = ms > 0 ? ms : 0;
    this.stopIdleSweeper();
    if (this.idleMs > 0) {
      // Check often enough to be responsive, but never busier than every 30s.
      const cadence = Math.min(this.idleMs, 30_000);
      this.idleTimer = setInterval(() => this.reapIdle(), cadence);
    }
  }

  private stopIdleSweeper(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Close any live connection idle longer than idleMs and not mid-operation. */
  private reapIdle(): void {
    if (this.idleMs <= 0) return;
    const now = Date.now();
    for (const connId of [...this.transports.keys()]) {
      if ((this.connInFlight.get(connId) ?? 0) > 0) continue;
      const last = this.lastActivity.get(connId) ?? 0;
      if (now - last > this.idleMs) {
        this.onLog?.(`Disconnected idle connection after ${Math.round(this.idleMs / 60_000)} min`);
        void this.close(connId);
      }
    }
  }

  private async safeDisconnect(t: Transport): Promise<void> {
    try {
      await t.disconnect();
    } catch {
      /* ignore disconnect errors */
    }
  }
}
