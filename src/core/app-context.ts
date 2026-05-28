/**
 * Service container. Owns the DB, connection pool, rclone daemon, event bus,
 * and all services. The RPC layer (src/bun) talks only to this object, keeping
 * Electrobun decoupled from the business core.
 */
import type { Database } from "bun:sqlite";
import { openDatabase } from "./db/database";
import { databasePath } from "./paths";
import {
  ConnectionsRepo,
  ProjectsRepo,
  EnvironmentsRepo,
  IgnoreRulesRepo,
  HistoryRepo,
} from "./db/repositories";
import { ConnectionPool } from "./connections/pool";
import { RcloneClient } from "./rclone/client";
import { EventBus } from "./events";
import { ConnectionService } from "./services/connection-service";
import { FileService } from "./services/file-service";
import { TransferManager } from "./services/transfer-manager";
import { SyncService } from "./services/sync-service";
import { WatcherService } from "./services/watcher-service";
import { VcsService } from "./services/vcs-service";
import { compileRules } from "./util/ignore";
import type { Connection, Environment, Project } from "../shared/domain";

export class AppContext {
  readonly db: Database;
  readonly bus = new EventBus();
  readonly pool = new ConnectionPool();
  readonly rclone = new RcloneClient();

  readonly connections: ConnectionsRepo;
  readonly projects: ProjectsRepo;
  readonly environments: EnvironmentsRepo;
  readonly ignoreRules: IgnoreRulesRepo;
  readonly history: HistoryRepo;

  readonly connectionService: ConnectionService;
  readonly fileService: FileService;
  readonly transfers: TransferManager;
  readonly sync: SyncService;
  readonly watcher: WatcherService;
  readonly vcs: VcsService;

  constructor(dbPath = databasePath()) {
    this.db = openDatabase(dbPath);

    this.connections = new ConnectionsRepo(this.db);
    this.projects = new ProjectsRepo(this.db);
    this.environments = new EnvironmentsRepo(this.db);
    this.ignoreRules = new IgnoreRulesRepo(this.db);
    this.history = new HistoryRepo(this.db);

    this.connectionService = new ConnectionService(this.connections, this.pool);
    this.fileService = new FileService(this.pool);
    this.transfers = new TransferManager(this.pool, this.rclone, this.history, this.bus);
    this.sync = new SyncService(this.rclone);
    this.vcs = new VcsService();
    this.watcher = new WatcherService({
      upload: (conn, localPath, remotePath) =>
        this.transfers.enqueueUpload(conn, localPath, remotePath),
      onEvent: (projectId, path, action) =>
        this.bus.emit("watch:event", { projectId, path, action }),
    });
  }

  /** Resolve the active connection + remote path for a project's environment. */
  resolveEnvironment(project: Project): { conn: Connection; env: Environment } | null {
    const envs = this.environments.listForProject(project.id);
    const env =
      envs.find((e) => e.id === project.defaultEnvironmentId) ??
      envs.find((e) => e.isDefault) ??
      envs[0];
    if (!env) return null;
    const conn = this.connections.get(env.connectionId);
    if (!conn) return null;
    return { conn, env };
  }

  /** Compiled ignore regexes for a project. */
  ignoreRegexesFor(projectId: number): RegExp[] {
    return compileRules(this.ignoreRules.listForProject(projectId));
  }

  /** Graceful shutdown: stop watchers, rclone, and pooled connections. */
  async shutdown(): Promise<void> {
    this.watcher.stopAll();
    await this.pool.closeAll();
    await this.rclone.stop();
  }
}
