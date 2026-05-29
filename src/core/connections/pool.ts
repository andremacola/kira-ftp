/**
 * Connection pool keyed by connection id. Keeps one live Transport per server
 * and reconnects transparently when the link drops. A single in-flight connect
 * is shared so concurrent callers never create duplicate connections.
 *
 * SFTP multiplexes many operations over one ssh2 connection, so those run
 * concurrently. FTP/FTPS cannot share a control connection across simultaneous
 * transfers, so operations on a single FTP connection are serialized.
 */
import type { Connection } from "../../shared/domain";
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

  /** Subscribe to remote-activity changes (true when any op is in flight). */
  setActivityListener(fn: (busy: boolean) => void): void {
    this.onActivity = fn;
  }

  private enter(): void {
    if (this.inFlight++ === 0) this.onActivity?.(true);
  }
  private leave(): void {
    if (--this.inFlight === 0) this.onActivity?.(false);
    if (this.inFlight < 0) this.inFlight = 0;
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
      await transport.connect();
      this.transports.set(conn.id, transport);
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
    this.enter();
    const done = () => this.leave();
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

  /** Force-close a connection (e.g. user edited/removed it). */
  async close(connId: number): Promise<void> {
    this.connecting.delete(connId);
    this.queues.delete(connId);
    const transport = this.transports.get(connId);
    if (!transport) return;
    this.transports.delete(connId);
    await this.safeDisconnect(transport);
  }

  /** Close everything (app shutdown). */
  async closeAll(): Promise<void> {
    const all = [...this.transports.values()];
    this.transports.clear();
    this.connecting.clear();
    this.queues.clear();
    await Promise.all(all.map((t) => this.safeDisconnect(t)));
  }

  private async safeDisconnect(t: Transport): Promise<void> {
    try {
      await t.disconnect();
    } catch {
      /* ignore disconnect errors */
    }
  }
}
