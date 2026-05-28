/**
 * SQLite schema as plain DDL applied via a tiny version-based migrator.
 * We use bun:sqlite directly (no ORM) to keep the data layer simple and
 * dependency-light, per project guidance.
 */

/** Bump when adding a migration. Each index in MIGRATIONS is one version. */
export const SCHEMA_VERSION = 1;

/**
 * Ordered list of migrations. Index 0 -> version 1, etc.
 * Never edit a shipped migration; append a new one instead.
 */
export const MIGRATIONS: string[] = [
  // v1: initial schema
  `
  CREATE TABLE connections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    type            TEXT    NOT NULL DEFAULT 'sftp',
    host            TEXT    NOT NULL,
    port            INTEGER NOT NULL DEFAULT 22,
    user            TEXT    NOT NULL,
    auth_type       TEXT    NOT NULL DEFAULT 'key',
    ssh_key_path    TEXT,
    password        TEXT,
    remote_path     TEXT    NOT NULL DEFAULT '',
    remote_encoding TEXT    NOT NULL DEFAULT 'utf-8',
    timeout         INTEGER NOT NULL DEFAULT 30,
    keepalive       INTEGER NOT NULL DEFAULT 0,
    ftp_passive_mode INTEGER NOT NULL DEFAULT 1,
    sftp_flags      TEXT    NOT NULL DEFAULT '[]',
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
  );

  CREATE TABLE projects (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT    NOT NULL,
    local_path              TEXT    NOT NULL,
    default_environment_id  INTEGER,
    upload_on_save          INTEGER NOT NULL DEFAULT 1,
    save_before_upload      INTEGER NOT NULL DEFAULT 1,
    watch_enabled           INTEGER NOT NULL DEFAULT 0,
    confirm_overwrite_newer INTEGER NOT NULL DEFAULT 0,
    confirm_sync            INTEGER NOT NULL DEFAULT 1,
    confirm_downloads       INTEGER NOT NULL DEFAULT 0,
    sync_down_on_open       INTEGER NOT NULL DEFAULT 0,
    sync_skip_deletes       INTEGER NOT NULL DEFAULT 0,
    sync_same_age           INTEGER NOT NULL DEFAULT 0,
    file_permissions        TEXT,
    dir_permissions         TEXT,
    allow_config_upload     INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT    NOT NULL,
    updated_at              TEXT    NOT NULL
  );

  CREATE TABLE environments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
    remote_path   TEXT    NOT NULL DEFAULT '',
    is_default    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE ignore_rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pattern    TEXT    NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE transfer_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER,
    kind        TEXT    NOT NULL,
    path        TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    bytes       INTEGER NOT NULL DEFAULT 0,
    started_at  TEXT    NOT NULL,
    finished_at TEXT    NOT NULL,
    error       TEXT
  );

  CREATE INDEX idx_env_project ON environments(project_id);
  CREATE INDEX idx_ignore_project ON ignore_rules(project_id);
  CREATE INDEX idx_history_project ON transfer_history(project_id);
  `,
];
