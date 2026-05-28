/**
 * Interactive file operations over the connection pool. Single-file transfers
 * and metadata ops live here (low latency); folder/bulk work goes to rclone.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { readFile as readLocalFile, writeFile as writeLocalFile } from "node:fs/promises";
import type { Connection, FileEntry } from "../../shared/domain";
import type { ConnectionPool } from "../connections/pool";
import {
  listLocal,
  statLocal,
  mkdirLocal,
  renameLocal,
  deleteLocal,
} from "../fs/local";

export class FileService {
  constructor(private pool: ConnectionPool) {}

  /* ------------------------------- local -------------------------------- */

  listLocal(dir: string): Promise<FileEntry[]> {
    return listLocal(dir);
  }
  statLocal(path: string): Promise<FileEntry | null> {
    return statLocal(path);
  }
  mkdirLocal(path: string): Promise<void> {
    return mkdirLocal(path);
  }
  renameLocal(from: string, to: string): Promise<void> {
    return renameLocal(from, to);
  }
  deleteLocal(path: string): Promise<void> {
    return deleteLocal(path);
  }

  /* ------------------------------ remote -------------------------------- */

  listRemote(conn: Connection, dir: string): Promise<FileEntry[]> {
    return this.pool.withTransport(conn, (t) => t.list(dir));
  }

  statRemote(conn: Connection, path: string): Promise<FileEntry | null> {
    return this.pool.withTransport(conn, (t) => t.stat(path));
  }

  mkdirRemote(conn: Connection, path: string): Promise<void> {
    return this.pool.withTransport(conn, (t) => t.mkdir(path, true));
  }

  renameRemote(conn: Connection, from: string, to: string): Promise<void> {
    return this.pool.withTransport(conn, (t) => t.rename(from, to));
  }

  async deleteRemote(conn: Connection, path: string): Promise<void> {
    return this.pool.withTransport(conn, async (t) => {
      const st = await t.stat(path);
      if (st?.type === "dir") await t.removeDirRecursive(path);
      else await t.removeFile(path);
    });
  }

  chmodRemote(conn: Connection, path: string, mode: number): Promise<void> {
    return this.pool.withTransport(conn, (t) => t.chmod(path, mode));
  }

  /** Create an empty remote file (touch). */
  newRemoteFile(conn: Connection, path: string): Promise<void> {
    return this.pool.withTransport(conn, (t) => t.writeFile(path, Buffer.alloc(0)));
  }

  /* --------------------------- remote editing --------------------------- */

  /** Download a remote file into a temp dir; returns the local temp path. */
  async openRemoteForEdit(
    conn: Connection,
    remotePath: string,
  ): Promise<{ tmpPath: string; content: string }> {
    const buf = await this.pool.withTransport(conn, (t) => t.readFile(remotePath));
    const dir = mkdtempSync(join(tmpdir(), "kira-edit-"));
    const name = remotePath.split("/").pop() ?? "file";
    const tmpPath = join(dir, name);
    await writeLocalFile(tmpPath, buf);
    return { tmpPath, content: buf.toString("utf-8") };
  }

  /** Read a remote file's text content directly. */
  async readRemoteText(conn: Connection, remotePath: string): Promise<string> {
    const buf = await this.pool.withTransport(conn, (t) => t.readFile(remotePath));
    return buf.toString("utf-8");
  }

  /** Save text back to a remote file (remote edit save). */
  saveRemoteText(conn: Connection, remotePath: string, text: string): Promise<void> {
    return this.pool.withTransport(conn, (t) =>
      t.writeFile(remotePath, Buffer.from(text, "utf-8")),
    );
  }

  /** Read a local file's text content. */
  async readLocalText(path: string): Promise<string> {
    return (await readLocalFile(path)).toString("utf-8");
  }
}
