/**
 * Core domain types shared between the Bun main process and the React view.
 * Pure data shapes only — no runtime dependencies on Electrobun, ssh2, etc.
 * Keep this file framework-agnostic so the business core stays portable.
 */

/** Supported transfer protocols. */
export type ConnectionType = "sftp" | "ftp" | "ftps";

/** How we authenticate against a server. */
export type AuthType = "password" | "key" | "agent";

/** A saved server/credential profile (the "global server" concept). */
export interface Connection {
  id: number;
  name: string;
  type: ConnectionType;
  host: string;
  port: number;
  user: string;
  authType: AuthType;
  /** Absolute path to a private key; null -> auto-discover from ~/.ssh. */
  sshKeyPath: string | null;
  /** Plaintext password (step 1 only; migrates to Keychain later). */
  password: string | null;
  /**
   * Owning project id, or null for a standalone server. Project-owned
   * connections are edited inside the project and hidden from the Servers list.
   */
  ownerProjectId: number | null;
  /** Default remote directory to open. */
  remotePath: string;
  remoteEncoding: string;
  /** Connection timeout in seconds. */
  timeout: number;
  /** Keepalive interval in seconds; 0 disables. */
  keepalive: number;
  /** FTP/FTPS passive mode. */
  ftpPassiveMode: boolean;
  /** Extra raw ssh flags passed to the SFTP backend. */
  sftpFlags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating/updating a connection (no server-managed fields). */
export type ConnectionInput = Omit<Connection, "id" | "createdAt" | "updatedAt">;

/** Connection fields without ownership (ownership is decided by the backend). */
export type ConnectionFields = Omit<ConnectionInput, "ownerProjectId">;

/** A local<->remote mapping (the "project" / sftp-config concept). */
export interface Project {
  id: number;
  name: string;
  localPath: string;
  defaultEnvironmentId: number | null;
  uploadOnSave: boolean;
  saveBeforeUpload: boolean;
  watchEnabled: boolean;
  confirmOverwriteNewer: boolean;
  confirmSync: boolean;
  confirmDownloads: boolean;
  syncDownOnOpen: boolean;
  syncSkipDeletes: boolean;
  syncSameAge: boolean;
  /** Octal string like "644"; null -> leave server default. */
  filePermissions: string | null;
  /** Octal string like "755"; null -> leave server default. */
  dirPermissions: string | null;
  allowConfigUpload: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProjectInput = Omit<Project, "id" | "createdAt" | "updatedAt">;

/** A named environment within a project (staging/prod = alt configs). */
export interface Environment {
  id: number;
  projectId: number;
  name: string;
  connectionId: number;
  remotePath: string;
  isDefault: boolean;
}

export type EnvironmentInput = Omit<Environment, "id">;

/** An ignore pattern (regex) scoped to a project. */
export interface IgnoreRule {
  id: number;
  projectId: number;
  pattern: string;
  enabled: boolean;
}

/** A single entry returned by a directory listing (local or remote). */
export interface FileEntry {
  name: string;
  /** Full path within its filesystem (local absolute or remote absolute). */
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  /** Unix mtime in milliseconds, or null when unknown. */
  modifiedMs: number | null;
  /** POSIX permission bits (e.g. 0o644), or null when unknown. */
  mode: number | null;
  /** Resolved target for symlinks. */
  linkTarget?: string | null;
}

/** Direction of a transfer/sync operation. */
export type TransferDirection = "upload" | "download";

export type TransferKind =
  | "upload"
  | "download"
  | "upload-folder"
  | "download-folder"
  | "sync-up"
  | "sync-down"
  | "sync-both";

export type TransferStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** A unit of work tracked by the TransferManager. */
export interface TransferJob {
  id: string;
  projectId: number | null;
  connectionId: number;
  kind: TransferKind;
  /** Human-readable label, e.g. "Upload src/ -> /var/www". */
  label: string;
  status: TransferStatus;
  /** 0..1 overall progress. */
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  /** Bytes/sec, when available. */
  speed: number;
  filesDone: number;
  filesTotal: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** A persisted history record of a completed/failed operation. */
export interface TransferHistoryEntry {
  id: number;
  projectId: number | null;
  kind: TransferKind;
  path: string;
  status: TransferStatus;
  bytes: number;
  startedAt: string;
  finishedAt: string;
  error: string | null;
}

/** One planned operation produced by a sync dry-run. */
export interface SyncPlanItem {
  action: "upload" | "download" | "delete-local" | "delete-remote";
  path: string;
  size: number;
  reason: "new" | "newer" | "size-diff" | "orphan";
}

export interface SyncPlan {
  items: SyncPlanItem[];
  totalBytes: number;
}

/** Result of testing a connection. */
export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** Round-trip latency in ms when ok. */
  latencyMs?: number;
}

/** A connection's live state, surfaced to the UI. */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** Severity for log lines pushed to the UI output panel. */
export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogLine {
  level: LogLevel;
  message: string;
  /** ISO timestamp. */
  at: string;
  connectionId?: number;
}

/**
 * Last-open UI session, restored on launch when the app was closed to the menu
 * bar (a real Quit/⌘Q clears it). Captures the open project and current folder.
 */
export interface SessionState {
  projectId: number | null;
  /** Mapped-mode relative path under the project roots. */
  relPath: string;
  /** Current local pane path (used when no project is open). */
  localPath: string;
}
