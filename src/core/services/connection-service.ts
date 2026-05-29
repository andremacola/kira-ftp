/**
 * Connection profile CRUD plus a non-destructive "test connection" that
 * connects, lists the remote path, and reports latency.
 */
import type {
  Connection,
  ConnectionFields,
  ConnectionInput,
  ConnectionTestResult,
} from "../../shared/domain";
import type { ConnectionsRepo } from "../db/repositories";
import type { ConnectionPool } from "../connections/pool";
import { createTransport } from "../connections/pool";

export class ConnectionService {
  constructor(
    private repo: ConnectionsRepo,
    private pool: ConnectionPool,
  ) {}

  list(): Connection[] {
    return this.repo.list();
  }

  get(id: number): Connection | null {
    return this.repo.get(id);
  }

  create(input: ConnectionInput): Connection {
    return this.repo.create(input);
  }

  async update(id: number, input: ConnectionInput): Promise<Connection> {
    const updated = this.repo.update(id, input);
    // drop any pooled link so new settings take effect
    await this.pool.close(id);
    return updated;
  }

  async delete(id: number): Promise<void> {
    await this.pool.close(id);
    this.repo.delete(id);
  }

  /** Connect with the given (possibly unsaved) config and verify access. */
  async test(input: ConnectionFields): Promise<ConnectionTestResult> {
    const conn: Connection = {
      ...input,
      id: -1,
      ownerProjectId: null,
      createdAt: "",
      updatedAt: "",
    };
    const transport = createTransport(conn);
    const start = Date.now();
    try {
      await transport.connect();
      await transport.list(conn.remotePath || ".");
      const latencyMs = Date.now() - start;
      await transport.disconnect();
      return { ok: true, message: "Connection successful", latencyMs };
    } catch (err) {
      await transport.disconnect().catch(() => {});
      return { ok: false, message: (err as Error).message };
    }
  }
}
