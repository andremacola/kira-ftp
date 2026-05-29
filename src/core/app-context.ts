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
  SettingsRepo,
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
import { EditorIntegrationService } from "./services/editor-integration";
import { RmateService, type RmateEditor } from "./services/rmate-service";
import { compileRules, DEFAULT_IGNORE_PATTERNS } from "./util/ignore";
import type {
  Connection,
  ConnectionInput,
  Environment,
  EnvironmentInput,
  Project,
  ProjectInput,
} from "../shared/domain";

/** Connection fields for a project environment (ownership is set by us). */
export type EnvConnectionInput = Omit<ConnectionInput, "ownerProjectId">;

const DEFAULT_PROJECT: Omit<ProjectInput, "name" | "localPath" | "defaultEnvironmentId"> = {
  uploadOnSave: true,
  saveBeforeUpload: true,
  watchEnabled: false,
  confirmOverwriteNewer: false,
  confirmSync: true,
  confirmDownloads: false,
  syncDownOnOpen: false,
  syncSkipDeletes: false,
  syncSameAge: false,
  filePermissions: null,
  dirPermissions: null,
  allowConfigUpload: false,
};

const projectInput = (p: Project): ProjectInput => {
  const { id, createdAt, updatedAt, ...rest } = p;
  return rest;
};
const envInput = (e: Environment): EnvironmentInput => {
  const { id, ...rest } = e;
  return rest;
};

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
  readonly settings: SettingsRepo;

  readonly connectionService: ConnectionService;
  readonly fileService: FileService;
  readonly transfers: TransferManager;
  readonly sync: SyncService;
  readonly watcher: WatcherService;
  readonly vcs: VcsService;
  readonly editors: EditorIntegrationService;
  readonly rmate: RmateService;

  constructor(dbPath = databasePath()) {
    this.db = openDatabase(dbPath);

    this.connections = new ConnectionsRepo(this.db);
    this.projects = new ProjectsRepo(this.db);
    this.environments = new EnvironmentsRepo(this.db);
    this.ignoreRules = new IgnoreRulesRepo(this.db);
    this.history = new HistoryRepo(this.db);
    this.settings = new SettingsRepo(this.db);

    this.connectionService = new ConnectionService(this.connections, this.pool);
    this.fileService = new FileService(this.pool);
    this.transfers = new TransferManager(this.pool, this.rclone, this.history, this.bus);
    this.sync = new SyncService(this.rclone);
    this.vcs = new VcsService();
    // Editor integration persists the installed CLI path in app settings, so
    // editor configs can reference it by absolute path.
    this.editors = new EditorIntegrationService(undefined, {
      get: () => this.settings.get("cliPath"),
      set: (p) => this.settings.set("cliPath", p),
    });
    this.rmate = new RmateService({
      getEditor: () => (this.settings.get("rmateEditor") as RmateEditor | null) ?? null,
      setEditor: (e) => this.settings.set("rmateEditor", e),
      getEnabled: () => this.settings.getBool("rmateEnabled", false),
      setEnabled: (on) => this.settings.setBool("rmateEnabled", on),
    });
    this.watcher = new WatcherService({
      upload: (conn, localPath, remotePath) =>
        this.transfers.enqueueUpload(conn, localPath, remotePath),
      onEvent: (projectId, path, action) =>
        this.bus.emit("watch:event", { projectId, path, action }),
    });

    // Surface interactive remote activity (list/stat/mkdir/rename/…) so the
    // menubar shows the spinner during browsing/edits, not only transfers.
    this.pool.setActivityListener((busy) => this.bus.emit("remote:activity", { busy }));
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

  /* ----------------- self-contained project orchestration ---------------- */

  /** Make one environment the project's default (unsets the others). */
  private setDefaultEnv(projectId: number, envId: number): void {
    for (const e of this.environments.listForProject(projectId)) {
      if (e.isDefault && e.id !== envId) {
        this.environments.update(e.id, { ...envInput(e), isDefault: false });
      }
    }
    const target = this.environments.get(envId)!;
    this.environments.update(envId, { ...envInput(target), isDefault: true });
    const proj = this.projects.get(projectId)!;
    this.projects.update(projectId, { ...projectInput(proj), defaultEnvironmentId: envId });
  }

  /** Create a self-contained project: project + its own connection + default env. */
  createFullProject(input: {
    name: string;
    localPath: string;
    remotePath: string;
    connection: EnvConnectionInput;
    seedIgnores?: boolean;
  }): Project {
    return this.db.transaction(() => {
      const project = this.projects.create({
        ...DEFAULT_PROJECT,
        name: input.name,
        localPath: input.localPath,
        defaultEnvironmentId: null,
      });
      const conn = this.connections.create({
        ...input.connection,
        ownerProjectId: project.id,
      });
      const env = this.environments.create({
        projectId: project.id,
        name: "default",
        connectionId: conn.id,
        remotePath: input.remotePath,
        isDefault: true,
      });
      const updated = this.projects.update(project.id, {
        ...projectInput(project),
        defaultEnvironmentId: env.id,
      });
      if (input.seedIgnores !== false) {
        for (const p of DEFAULT_IGNORE_PATTERNS) this.ignoreRules.create(project.id, p);
      }
      return updated;
    })();
  }

  /** Add an environment (with its own owned connection) to a project. */
  addEnvironment(input: {
    projectId: number;
    name: string;
    isDefault: boolean;
    remotePath: string;
    connection: EnvConnectionInput;
  }): Environment {
    return this.db.transaction(() => {
      const conn = this.connections.create({
        ...input.connection,
        ownerProjectId: input.projectId,
      });
      const env = this.environments.create({
        projectId: input.projectId,
        name: input.name,
        connectionId: conn.id,
        remotePath: input.remotePath,
        isDefault: false,
      });
      if (input.isDefault) this.setDefaultEnv(input.projectId, env.id);
      return this.environments.get(env.id)!;
    })();
  }

  /** Update an environment and its owned connection together. */
  updateEnvironmentFull(input: {
    environmentId: number;
    name: string;
    isDefault: boolean;
    remotePath: string;
    connection: EnvConnectionInput;
  }): Environment {
    return this.db.transaction(() => {
      const env = this.environments.get(input.environmentId);
      if (!env) throw new Error(`Environment ${input.environmentId} not found`);
      this.connections.update(env.connectionId, {
        ...input.connection,
        ownerProjectId: env.projectId,
      });
      this.environments.update(env.id, {
        projectId: env.projectId,
        name: input.name,
        connectionId: env.connectionId,
        remotePath: input.remotePath,
        isDefault: env.isDefault,
      });
      if (input.isDefault) this.setDefaultEnv(env.projectId, env.id);
      void this.pool.close(env.connectionId); // drop stale pooled link
      return this.environments.get(env.id)!;
    })();
  }

  /** Delete an environment and its owned connection; reassign default if needed. */
  deleteEnvironmentFull(environmentId: number): void {
    const env = this.environments.get(environmentId);
    if (!env) return;
    void this.pool.close(env.connectionId);
    this.db.transaction(() => {
      this.environments.delete(environmentId);
      this.connections.delete(env.connectionId);
      const proj = this.projects.get(env.projectId);
      if (proj && proj.defaultEnvironmentId === environmentId) {
        const next = this.environments.listForProject(env.projectId)[0] ?? null;
        if (next) this.setDefaultEnv(env.projectId, next.id);
        else this.projects.update(env.projectId, { ...projectInput(proj), defaultEnvironmentId: null });
      }
    })();
  }

  /** Delete a project plus its environments and owned connections. */
  deleteProjectFull(projectId: number): void {
    this.watcher.stop(projectId);
    const envs = this.environments.listForProject(projectId);
    for (const e of envs) void this.pool.close(e.connectionId);
    this.db.transaction(() => {
      for (const e of envs) this.environments.delete(e.id);
      this.connections.deleteOwnedByProject(projectId);
      this.projects.delete(projectId);
    })();
  }

  /** Start the rmate server on boot if the user left it enabled. */
  startRmateIfEnabled(): void {
    if (this.settings.getBool("rmateEnabled", false)) this.rmate.start();
  }

  /** Graceful shutdown: stop watchers, rmate, rclone, and pooled connections. */
  async shutdown(): Promise<void> {
    this.watcher.stopAll();
    this.rmate.killSync();
    await this.pool.closeAll();
    await this.rclone.stop();
  }
}
