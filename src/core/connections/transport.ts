/**
 * Transport abstraction shared by the SFTP (ssh2) and FTP/FTPS (basic-ftp)
 * backends. Interactive, low-latency operations go through here; bulk
 * transfers/sync are delegated to rclone elsewhere.
 */
import type { Connection, FileEntry } from "../../shared/domain";

/** A live, reusable connection to one server. */
export interface Transport {
  readonly type: Connection["type"];

  /** Establish the underlying connection. */
  connect(): Promise<void>;

  /** Close and release resources. */
  disconnect(): Promise<void>;

  /** True while the underlying connection is usable. */
  isAlive(): boolean;

  /** List a remote directory (non-recursive). */
  list(remotePath: string): Promise<FileEntry[]>;

  /** Stat a single remote path; null if it does not exist. */
  stat(remotePath: string): Promise<FileEntry | null>;

  /** Create a directory (optionally recursive). */
  mkdir(remotePath: string, recursive?: boolean): Promise<void>;

  /** Remove a file. */
  removeFile(remotePath: string): Promise<void>;

  /** Remove an empty directory. */
  removeDir(remotePath: string): Promise<void>;

  /** Recursively remove a directory and its contents. */
  removeDirRecursive(remotePath: string): Promise<void>;

  /** Rename/move a remote path. */
  rename(from: string, to: string): Promise<void>;

  /** Change POSIX permissions (octal mode). Throws if unsupported. */
  chmod(remotePath: string, mode: number): Promise<void>;

  /**
   * Download a remote file to a local path.
   * @param onProgress receives cumulative bytes transferred.
   */
  download(
    remotePath: string,
    localPath: string,
    onProgress?: (bytes: number) => void,
  ): Promise<void>;

  /**
   * Upload a local file to a remote path. Creates parent dirs as needed.
   * @param onProgress receives cumulative bytes transferred.
   */
  upload(
    localPath: string,
    remotePath: string,
    onProgress?: (bytes: number) => void,
  ): Promise<void>;

  /** Read a small remote file fully into memory (for editing/diff). */
  readFile(remotePath: string): Promise<Buffer>;

  /** Write a buffer to a remote file (for remote edit save). */
  writeFile(remotePath: string, data: Buffer): Promise<void>;
}

/** Normalize a remote path to POSIX form with no trailing slash (except root). */
export function normalizeRemote(path: string): string {
  if (!path || path === "") return ".";
  let p = path.replace(/\\/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/** Join remote path segments using POSIX separators. */
export function joinRemote(...parts: string[]): string {
  const joined = parts
    .filter((p) => p !== "" && p !== undefined && p !== null)
    .join("/")
    .replace(/\/{2,}/g, "/");
  return joined;
}

/** Parent directory of a remote path. */
export function dirnameRemote(path: string): string {
  const p = normalizeRemote(path);
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return p.startsWith("/") ? "/" : ".";
  return p.slice(0, idx);
}
