/**
 * Typed repositories over bun:sqlite. Each repo maps between snake_case rows
 * and the camelCase domain types in shared/domain.ts.
 */
import type { Database } from "bun:sqlite";
import type {
  Connection,
  ConnectionInput,
  Environment,
  EnvironmentInput,
  IgnoreRule,
  Project,
  ProjectInput,
  TransferHistoryEntry,
} from "../../shared/domain";

const now = (): string => new Date().toISOString();
const bool = (n: number): boolean => n === 1;
const int = (b: boolean): number => (b ? 1 : 0);

/* ----------------------------- connections ------------------------------ */

interface ConnectionRow {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  user: string;
  auth_type: string;
  ssh_key_path: string | null;
  password: string | null;
  owner_project_id: number | null;
  remote_path: string;
  remote_encoding: string;
  timeout: number;
  keepalive: number;
  ftp_passive_mode: number;
  sftp_flags: string;
  created_at: string;
  updated_at: string;
}

function toConnection(r: ConnectionRow): Connection {
  return {
    id: r.id,
    name: r.name,
    type: r.type as Connection["type"],
    host: r.host,
    port: r.port,
    user: r.user,
    authType: r.auth_type as Connection["authType"],
    sshKeyPath: r.ssh_key_path,
    password: r.password,
    ownerProjectId: r.owner_project_id,
    remotePath: r.remote_path,
    remoteEncoding: r.remote_encoding,
    timeout: r.timeout,
    keepalive: r.keepalive,
    ftpPassiveMode: bool(r.ftp_passive_mode),
    sftpFlags: JSON.parse(r.sftp_flags) as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class ConnectionsRepo {
  constructor(private db: Database) {}

  /** Standalone servers only (owner_project_id IS NULL). */
  list(): Connection[] {
    return (
      this.db
        .query("SELECT * FROM connections WHERE owner_project_id IS NULL ORDER BY name")
        .all() as ConnectionRow[]
    ).map(toConnection);
  }

  get(id: number): Connection | null {
    const row = this.db
      .query("SELECT * FROM connections WHERE id = ?")
      .get(id) as ConnectionRow | null;
    return row ? toConnection(row) : null;
  }

  create(input: ConnectionInput): Connection {
    const ts = now();
    const res = this.db
      .query(
        `INSERT INTO connections
         (name, type, host, port, user, auth_type, ssh_key_path, password,
          owner_project_id, remote_path, remote_encoding, timeout, keepalive,
          ftp_passive_mode, sftp_flags, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.name,
        input.type,
        input.host,
        input.port,
        input.user,
        input.authType,
        input.sshKeyPath,
        input.password,
        input.ownerProjectId,
        input.remotePath,
        input.remoteEncoding,
        input.timeout,
        input.keepalive,
        int(input.ftpPassiveMode),
        JSON.stringify(input.sftpFlags),
        ts,
        ts,
      );
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, input: ConnectionInput): Connection {
    this.db
      .query(
        `UPDATE connections SET
          name=?, type=?, host=?, port=?, user=?, auth_type=?, ssh_key_path=?,
          password=?, owner_project_id=?, remote_path=?, remote_encoding=?,
          timeout=?, keepalive=?, ftp_passive_mode=?, sftp_flags=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        input.name,
        input.type,
        input.host,
        input.port,
        input.user,
        input.authType,
        input.sshKeyPath,
        input.password,
        input.ownerProjectId,
        input.remotePath,
        input.remoteEncoding,
        input.timeout,
        input.keepalive,
        int(input.ftpPassiveMode),
        JSON.stringify(input.sftpFlags),
        now(),
        id,
      );
    return this.get(id)!;
  }

  delete(id: number): void {
    this.db.query("DELETE FROM connections WHERE id = ?").run(id);
  }

  /** Delete all connections owned by a project (used on project delete). */
  deleteOwnedByProject(projectId: number): void {
    this.db.query("DELETE FROM connections WHERE owner_project_id = ?").run(projectId);
  }
}

/* ------------------------------- projects ------------------------------- */

interface ProjectRow {
  id: number;
  name: string;
  local_path: string;
  default_environment_id: number | null;
  upload_on_save: number;
  save_before_upload: number;
  watch_enabled: number;
  confirm_overwrite_newer: number;
  confirm_sync: number;
  confirm_downloads: number;
  sync_down_on_open: number;
  sync_skip_deletes: number;
  sync_same_age: number;
  file_permissions: string | null;
  dir_permissions: string | null;
  allow_config_upload: number;
  created_at: string;
  updated_at: string;
}

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    localPath: r.local_path,
    defaultEnvironmentId: r.default_environment_id,
    uploadOnSave: bool(r.upload_on_save),
    saveBeforeUpload: bool(r.save_before_upload),
    watchEnabled: bool(r.watch_enabled),
    confirmOverwriteNewer: bool(r.confirm_overwrite_newer),
    confirmSync: bool(r.confirm_sync),
    confirmDownloads: bool(r.confirm_downloads),
    syncDownOnOpen: bool(r.sync_down_on_open),
    syncSkipDeletes: bool(r.sync_skip_deletes),
    syncSameAge: bool(r.sync_same_age),
    filePermissions: r.file_permissions,
    dirPermissions: r.dir_permissions,
    allowConfigUpload: bool(r.allow_config_upload),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class ProjectsRepo {
  constructor(private db: Database) {}

  list(): Project[] {
    return (
      this.db.query("SELECT * FROM projects ORDER BY name").all() as ProjectRow[]
    ).map(toProject);
  }

  get(id: number): Project | null {
    const row = this.db
      .query("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | null;
    return row ? toProject(row) : null;
  }

  create(input: ProjectInput): Project {
    const ts = now();
    const res = this.db
      .query(
        `INSERT INTO projects
         (name, local_path, default_environment_id, upload_on_save,
          save_before_upload, watch_enabled, confirm_overwrite_newer,
          confirm_sync, confirm_downloads, sync_down_on_open, sync_skip_deletes,
          sync_same_age, file_permissions, dir_permissions, allow_config_upload,
          created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.name,
        input.localPath,
        input.defaultEnvironmentId,
        int(input.uploadOnSave),
        int(input.saveBeforeUpload),
        int(input.watchEnabled),
        int(input.confirmOverwriteNewer),
        int(input.confirmSync),
        int(input.confirmDownloads),
        int(input.syncDownOnOpen),
        int(input.syncSkipDeletes),
        int(input.syncSameAge),
        input.filePermissions,
        input.dirPermissions,
        int(input.allowConfigUpload),
        ts,
        ts,
      );
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, input: ProjectInput): Project {
    this.db
      .query(
        `UPDATE projects SET
          name=?, local_path=?, default_environment_id=?, upload_on_save=?,
          save_before_upload=?, watch_enabled=?, confirm_overwrite_newer=?,
          confirm_sync=?, confirm_downloads=?, sync_down_on_open=?,
          sync_skip_deletes=?, sync_same_age=?, file_permissions=?,
          dir_permissions=?, allow_config_upload=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        input.name,
        input.localPath,
        input.defaultEnvironmentId,
        int(input.uploadOnSave),
        int(input.saveBeforeUpload),
        int(input.watchEnabled),
        int(input.confirmOverwriteNewer),
        int(input.confirmSync),
        int(input.confirmDownloads),
        int(input.syncDownOnOpen),
        int(input.syncSkipDeletes),
        int(input.syncSameAge),
        input.filePermissions,
        input.dirPermissions,
        int(input.allowConfigUpload),
        now(),
        id,
      );
    return this.get(id)!;
  }

  delete(id: number): void {
    this.db.query("DELETE FROM projects WHERE id = ?").run(id);
  }
}

/* ----------------------------- environments ----------------------------- */

interface EnvironmentRow {
  id: number;
  project_id: number;
  name: string;
  connection_id: number;
  remote_path: string;
  is_default: number;
}

function toEnvironment(r: EnvironmentRow): Environment {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    connectionId: r.connection_id,
    remotePath: r.remote_path,
    isDefault: bool(r.is_default),
  };
}

export class EnvironmentsRepo {
  constructor(private db: Database) {}

  listForProject(projectId: number): Environment[] {
    return (
      this.db
        .query("SELECT * FROM environments WHERE project_id = ? ORDER BY name")
        .all(projectId) as EnvironmentRow[]
    ).map(toEnvironment);
  }

  get(id: number): Environment | null {
    const row = this.db
      .query("SELECT * FROM environments WHERE id = ?")
      .get(id) as EnvironmentRow | null;
    return row ? toEnvironment(row) : null;
  }

  create(input: EnvironmentInput): Environment {
    const res = this.db
      .query(
        `INSERT INTO environments (project_id, name, connection_id, remote_path, is_default)
         VALUES (?,?,?,?,?)`,
      )
      .run(
        input.projectId,
        input.name,
        input.connectionId,
        input.remotePath,
        int(input.isDefault),
      );
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, input: EnvironmentInput): Environment {
    this.db
      .query(
        `UPDATE environments SET project_id=?, name=?, connection_id=?, remote_path=?, is_default=? WHERE id=?`,
      )
      .run(
        input.projectId,
        input.name,
        input.connectionId,
        input.remotePath,
        int(input.isDefault),
        id,
      );
    return this.get(id)!;
  }

  delete(id: number): void {
    this.db.query("DELETE FROM environments WHERE id = ?").run(id);
  }
}

/* ----------------------------- ignore rules ----------------------------- */

interface IgnoreRow {
  id: number;
  project_id: number;
  pattern: string;
  enabled: number;
}

export class IgnoreRulesRepo {
  constructor(private db: Database) {}

  listForProject(projectId: number): IgnoreRule[] {
    return (
      this.db
        .query("SELECT * FROM ignore_rules WHERE project_id = ?")
        .all(projectId) as IgnoreRow[]
    ).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      pattern: r.pattern,
      enabled: bool(r.enabled),
    }));
  }

  create(projectId: number, pattern: string, enabled = true): IgnoreRule {
    const res = this.db
      .query(
        "INSERT INTO ignore_rules (project_id, pattern, enabled) VALUES (?,?,?)",
      )
      .run(projectId, pattern, int(enabled));
    return {
      id: Number(res.lastInsertRowid),
      projectId,
      pattern,
      enabled,
    };
  }

  delete(id: number): void {
    this.db.query("DELETE FROM ignore_rules WHERE id = ?").run(id);
  }
}

/* --------------------------- transfer history --------------------------- */

interface HistoryRow {
  id: number;
  project_id: number | null;
  kind: string;
  path: string;
  status: string;
  bytes: number;
  started_at: string;
  finished_at: string;
  error: string | null;
}

export class HistoryRepo {
  constructor(private db: Database) {}

  add(entry: Omit<TransferHistoryEntry, "id">): TransferHistoryEntry {
    const res = this.db
      .query(
        `INSERT INTO transfer_history
         (project_id, kind, path, status, bytes, started_at, finished_at, error)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        entry.projectId,
        entry.kind,
        entry.path,
        entry.status,
        entry.bytes,
        entry.startedAt,
        entry.finishedAt,
        entry.error,
      );
    return { id: Number(res.lastInsertRowid), ...entry };
  }

  recent(limit = 200): TransferHistoryEntry[] {
    return (
      this.db
        .query(
          "SELECT * FROM transfer_history ORDER BY finished_at DESC LIMIT ?",
        )
        .all(limit) as HistoryRow[]
    ).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      kind: r.kind as TransferHistoryEntry["kind"],
      path: r.path,
      status: r.status as TransferHistoryEntry["status"],
      bytes: r.bytes,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      error: r.error,
    }));
  }
}
