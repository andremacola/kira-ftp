/**
 * Connection pool keyed by connection id. Reuses one live Transport per
 * server (ref-counted), reconnecting transparently if the link dropped.
 * Fixes the "new connection per operation" mistake of the earlier attempt.
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

interface PoolEntry {
  transport: Transport;
  refs: number;
}

export class ConnectionPool {
  private entries = new Map<number, PoolEntry>();

  /** Acquire a live transport for a connection, connecting if needed. */
  async acquire(conn: Connection): Promise<Transport> {
    let entry = this.entries.get(conn.id);
    if (entry && entry.transport.isAlive()) {
      entry.refs++;
      return entry.transport;
    }
    // stale or missing -> (re)connect
    if (entry) await this.safeDisconnect(entry.transport);
    const transport = createTransport(conn);
    await transport.connect();
    entry = { transport, refs: 1 };
    this.entries.set(conn.id, entry);
    return transport;
  }

  /** Release a previously acquired transport. */
  release(connId: number): void {
    const entry = this.entries.get(connId);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
  }

  /** Run a unit of work with an acquired transport, releasing afterwards. */
  async withTransport<T>(
    conn: Connection,
    fn: (t: Transport) => Promise<T>,
  ): Promise<T> {
    const transport = await this.acquire(conn);
    try {
      return await fn(transport);
    } finally {
      this.release(conn.id);
    }
  }

  /** Force-close a connection (e.g. user edited/removed it). */
  async close(connId: number): Promise<void> {
    const entry = this.entries.get(connId);
    if (!entry) return;
    this.entries.delete(connId);
    await this.safeDisconnect(entry.transport);
  }

  /** Close everything (app shutdown). */
  async closeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(all.map((e) => this.safeDisconnect(e.transport)));
  }

  private async safeDisconnect(t: Transport): Promise<void> {
    try {
      await t.disconnect();
    } catch {
      /* ignore disconnect errors */
    }
  }
}
