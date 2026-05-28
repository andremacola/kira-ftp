/**
 * SFTP transport backed by ssh2. Validated against real servers under Bun.
 * Auth resolution mirrors Sublime SFTP: explicit key path, else the user's
 * existing ~/.ssh keys, else password, else ssh-agent.
 */
import { Client, type SFTPWrapper, type ConnectConfig } from "ssh2";
import { createReadStream, createWriteStream, readFileSync, rmSync } from "node:fs";
import { mkdir as mkdirLocal } from "node:fs/promises";
import { dirname } from "node:path";
import type { Connection, FileEntry } from "../../shared/domain";
import {
  type Transport,
  dirnameRemote,
  joinRemote,
  normalizeRemote,
} from "./transport";
import { resolveKeyPath } from "./keys";

function resolvePrivateKey(conn: Connection): Buffer | undefined {
  const path = resolveKeyPath(conn.sshKeyPath);
  return path ? readFileSync(path) : undefined;
}

function entryType(longname: string, attrs: { mode: number }): FileEntry["type"] {
  if (longname.startsWith("l")) return "symlink";
  // ssh2 exposes isDirectory via attrs.mode bits
  const S_IFMT = 0o170000;
  const S_IFDIR = 0o040000;
  const S_IFLNK = 0o120000;
  const fmt = attrs.mode & S_IFMT;
  if (fmt === S_IFLNK) return "symlink";
  if (fmt === S_IFDIR) return "dir";
  return "file";
}

export class SftpTransport implements Transport {
  readonly type = "sftp" as const;
  private client: Client | null = null;
  private sftp: SFTPWrapper | null = null;
  private alive = false;

  constructor(private conn: Connection) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const cfg: ConnectConfig = {
        host: this.conn.host,
        port: this.conn.port,
        username: this.conn.user,
        readyTimeout: this.conn.timeout * 1000,
        keepaliveInterval: this.conn.keepalive > 0 ? this.conn.keepalive * 1000 : 0,
      };

      if (this.conn.authType === "password" && this.conn.password) {
        cfg.password = this.conn.password;
      } else if (this.conn.authType === "agent") {
        cfg.agent = process.env.SSH_AUTH_SOCK;
      } else {
        const key = resolvePrivateKey(this.conn);
        if (key) cfg.privateKey = key;
        else if (process.env.SSH_AUTH_SOCK) cfg.agent = process.env.SSH_AUTH_SOCK;
        else if (this.conn.password) cfg.password = this.conn.password;
      }

      client
        .on("ready", () => {
          client.sftp((err, sftp) => {
            if (err) {
              client.end();
              reject(err);
              return;
            }
            this.client = client;
            this.sftp = sftp;
            this.alive = true;
            resolve();
          });
        })
        .on("error", (err) => {
          this.alive = false;
          reject(err);
        })
        .on("close", () => {
          this.alive = false;
        })
        .connect(cfg);
    });
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      this.alive = false;
      if (this.client) {
        this.client.once("close", () => resolve());
        this.client.end();
      } else {
        resolve();
      }
    });
  }

  isAlive(): boolean {
    return this.alive;
  }

  private require(): SFTPWrapper {
    if (!this.sftp || !this.alive) throw new Error("SFTP not connected");
    return this.sftp;
  }

  list(remotePath: string): Promise<FileEntry[]> {
    const sftp = this.require();
    const dir = normalizeRemote(remotePath);
    return new Promise((resolve, reject) => {
      sftp.readdir(dir, (err, list) => {
        if (err) return reject(err);
        const entries: FileEntry[] = list.map((e) => ({
          name: e.filename,
          path: joinRemote(dir, e.filename),
          type: entryType(e.longname, e.attrs),
          size: e.attrs.size,
          modifiedMs: e.attrs.mtime ? e.attrs.mtime * 1000 : null,
          mode: e.attrs.mode & 0o777,
        }));
        resolve(entries);
      });
    });
  }

  stat(remotePath: string): Promise<FileEntry | null> {
    const sftp = this.require();
    const p = normalizeRemote(remotePath);
    return new Promise((resolve, reject) => {
      sftp.lstat(p, (err, st) => {
        if (err) {
          // SFTP NO_SUCH_FILE (2) -> null; other errors propagate
          if ((err as { code?: number }).code === 2) return resolve(null);
          return reject(err);
        }
        const isDir = st.isDirectory();
        const isLink = st.isSymbolicLink();
        resolve({
          name: p.split("/").pop() ?? p,
          path: p,
          type: isLink ? "symlink" : isDir ? "dir" : "file",
          size: st.size,
          modifiedMs: st.mtime ? st.mtime * 1000 : null,
          mode: st.mode & 0o777,
        });
      });
    });
  }

  mkdir(remotePath: string, recursive = false): Promise<void> {
    const sftp = this.require();
    const target = normalizeRemote(remotePath);
    if (!recursive) {
      return new Promise((resolve, reject) => {
        sftp.mkdir(target, (err) => (err ? reject(err) : resolve()));
      });
    }
    // recursive: build path segment by segment, ignoring "already exists"
    return this.mkdirRecursive(target);
  }

  private async mkdirRecursive(target: string): Promise<void> {
    const parts = target.split("/").filter(Boolean);
    const absolute = target.startsWith("/");
    let cur = absolute ? "" : ".";
    for (const part of parts) {
      cur = absolute ? `${cur}/${part}` : joinRemote(cur, part);
      const exists = await this.stat(cur);
      if (!exists) {
        await new Promise<void>((resolve, reject) => {
          this.require().mkdir(cur, (err) => {
            // SFTP FAILURE (4) usually means "already exists"; ignore it
            if (err && (err as { code?: number }).code !== 4) reject(err);
            else resolve();
          });
        });
      }
    }
  }

  removeFile(remotePath: string): Promise<void> {
    const sftp = this.require();
    return new Promise((resolve, reject) => {
      sftp.unlink(normalizeRemote(remotePath), (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  removeDir(remotePath: string): Promise<void> {
    const sftp = this.require();
    return new Promise((resolve, reject) => {
      sftp.rmdir(normalizeRemote(remotePath), (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async removeDirRecursive(remotePath: string): Promise<void> {
    const dir = normalizeRemote(remotePath);
    const entries = await this.list(dir);
    for (const e of entries) {
      if (e.type === "dir") await this.removeDirRecursive(e.path);
      else await this.removeFile(e.path);
    }
    await this.removeDir(dir);
  }

  rename(from: string, to: string): Promise<void> {
    const sftp = this.require();
    return new Promise((resolve, reject) => {
      sftp.rename(normalizeRemote(from), normalizeRemote(to), (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  chmod(remotePath: string, mode: number): Promise<void> {
    const sftp = this.require();
    return new Promise((resolve, reject) => {
      sftp.chmod(normalizeRemote(remotePath), mode, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async download(
    remotePath: string,
    localPath: string,
    onProgress?: (bytes: number) => void,
  ): Promise<void> {
    const sftp = this.require();
    await mkdirLocal(dirname(localPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const rs = sftp.createReadStream(normalizeRemote(remotePath));
      const ws = createWriteStream(localPath);
      let bytes = 0;
      const fail = (err: Error) => {
        rs.destroy();
        ws.destroy();
        rmSync(localPath, { force: true }); // drop the partial file
        reject(err);
      };
      rs.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        onProgress?.(bytes);
      });
      rs.on("error", fail);
      ws.on("error", fail);
      ws.on("close", () => resolve());
      rs.pipe(ws);
    });
  }

  async upload(
    localPath: string,
    remotePath: string,
    onProgress?: (bytes: number) => void,
  ): Promise<void> {
    const target = normalizeRemote(remotePath);
    await this.mkdirRecursive(dirnameRemote(target));
    const sftp = this.require();
    return new Promise((resolve, reject) => {
      const rs = createReadStream(localPath);
      const ws = sftp.createWriteStream(target);
      let bytes = 0;
      const fail = (err: Error) => {
        rs.destroy();
        ws.destroy();
        reject(err);
      };
      rs.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        onProgress?.(bytes);
      });
      rs.on("error", fail);
      ws.on("error", fail);
      ws.on("close", () => resolve());
      rs.pipe(ws);
    });
  }

  readFile(remotePath: string): Promise<Buffer> {
    const sftp = this.require();
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const rs = sftp.createReadStream(normalizeRemote(remotePath));
      rs.on("data", (c: Buffer) => chunks.push(c));
      rs.on("error", reject);
      rs.on("end", () => resolve(Buffer.concat(chunks)));
    });
  }

  async writeFile(remotePath: string, data: Buffer): Promise<void> {
    const target = normalizeRemote(remotePath);
    await this.mkdirRecursive(dirnameRemote(target));
    const sftp = this.require();
    return new Promise((resolve, reject) => {
      const ws = sftp.createWriteStream(target);
      ws.on("error", reject);
      ws.on("close", () => resolve());
      ws.end(data);
    });
  }
}
