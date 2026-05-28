/**
 * FTP / FTPS transport backed by basic-ftp. FTPS uses an implicit/explicit
 * TLS channel; passive mode follows the connection config (default on).
 * chmod is attempted via SITE CHMOD and may be unsupported on some servers.
 */
import { Client, type FileInfo } from "basic-ftp";
import { mkdir as mkdirLocal } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Writable } from "node:stream";
import type { Connection, FileEntry } from "../../shared/domain";
import {
  type Transport,
  dirnameRemote,
  joinRemote,
  normalizeRemote,
} from "./transport";

function mapType(info: FileInfo): FileEntry["type"] {
  // basic-ftp FileType: 0 unknown, 1 file, 2 dir, 3 symlink
  if (info.isDirectory) return "dir";
  if (info.isSymbolicLink) return "symlink";
  return "file";
}

export class FtpTransport implements Transport {
  readonly type: "ftp" | "ftps";
  private client: Client;
  private alive = false;

  constructor(private conn: Connection) {
    this.type = conn.type === "ftps" ? "ftps" : "ftp";
    this.client = new Client(conn.timeout * 1000);
  }

  async connect(): Promise<void> {
    await this.client.access({
      host: this.conn.host,
      port: this.conn.port,
      user: this.conn.user,
      password: this.conn.password ?? "",
      secure: this.conn.type === "ftps",
      secureOptions: { rejectUnauthorized: false },
    });
    // basic-ftp negotiates PASV/EPSV automatically; passive is the default.
    this.alive = true;
  }

  async disconnect(): Promise<void> {
    this.alive = false;
    this.client.close();
  }

  isAlive(): boolean {
    return this.alive && !this.client.closed;
  }

  async list(remotePath: string): Promise<FileEntry[]> {
    const dir = normalizeRemote(remotePath);
    const infos = await this.client.list(dir === "." ? undefined : dir);
    return infos.map((info) => ({
      name: info.name,
      path: joinRemote(dir, info.name),
      type: mapType(info),
      size: info.size,
      modifiedMs: info.modifiedAt ? info.modifiedAt.getTime() : null,
      mode: info.permissions
        ? (info.permissions.user << 6) |
          (info.permissions.group << 3) |
          info.permissions.world
        : null,
      linkTarget: info.link ?? null,
    }));
  }

  async stat(remotePath: string): Promise<FileEntry | null> {
    const p = normalizeRemote(remotePath);
    const parent = dirnameRemote(p);
    const name = p.split("/").pop() ?? p;
    try {
      const infos = await this.client.list(parent === "." ? undefined : parent);
      const info = infos.find((i) => i.name === name);
      if (!info) return null;
      return {
        name: info.name,
        path: p,
        type: mapType(info),
        size: info.size,
        modifiedMs: info.modifiedAt ? info.modifiedAt.getTime() : null,
        mode: info.permissions
          ? (info.permissions.user << 6) |
            (info.permissions.group << 3) |
            info.permissions.world
          : null,
      };
    } catch {
      return null;
    }
  }

  async mkdir(remotePath: string, recursive = false): Promise<void> {
    const target = normalizeRemote(remotePath);
    if (recursive) {
      // ensureDir creates the full chain and leaves cwd there; restore after.
      await this.client.ensureDir(target);
      await this.client.cd("/");
    } else {
      await this.client.send("MKD " + target);
    }
  }

  async removeFile(remotePath: string): Promise<void> {
    await this.client.remove(normalizeRemote(remotePath));
  }

  async removeDir(remotePath: string): Promise<void> {
    await this.client.send("RMD " + normalizeRemote(remotePath));
  }

  async removeDirRecursive(remotePath: string): Promise<void> {
    await this.client.removeDir(normalizeRemote(remotePath));
  }

  async rename(from: string, to: string): Promise<void> {
    await this.client.rename(normalizeRemote(from), normalizeRemote(to));
  }

  async chmod(remotePath: string, mode: number): Promise<void> {
    // Not part of core FTP; many servers accept SITE CHMOD.
    const octal = (mode & 0o777).toString(8).padStart(3, "0");
    await this.client.send(`SITE CHMOD ${octal} ${normalizeRemote(remotePath)}`);
  }

  async download(
    remotePath: string,
    localPath: string,
    onProgress?: (bytes: number) => void,
  ): Promise<void> {
    await mkdirLocal(dirname(localPath), { recursive: true });
    // basic-ftp manages the stream; trackProgress avoids draining it ourselves.
    if (onProgress) this.client.trackProgress((info) => onProgress(info.bytes));
    try {
      await this.client.downloadTo(localPath, normalizeRemote(remotePath));
    } finally {
      if (onProgress) this.client.trackProgress();
    }
  }

  async upload(
    localPath: string,
    remotePath: string,
    onProgress?: (bytes: number) => void,
  ): Promise<void> {
    const target = normalizeRemote(remotePath);
    await this.ensureParent(target);
    if (onProgress) this.client.trackProgress((info) => onProgress(info.bytes));
    try {
      await this.client.uploadFrom(localPath, target);
    } finally {
      if (onProgress) this.client.trackProgress();
    }
  }

  async readFile(remotePath: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    });
    await this.client.downloadTo(sink, normalizeRemote(remotePath));
    return Buffer.concat(chunks);
  }

  async writeFile(remotePath: string, data: Buffer): Promise<void> {
    const target = normalizeRemote(remotePath);
    await this.ensureParent(target);
    await this.client.uploadFrom(Readable.from(data), target);
  }

  /** Create the parent directory chain for a target file path. */
  private async ensureParent(target: string): Promise<void> {
    const parent = dirnameRemote(target);
    if (parent && parent !== "." && parent !== "/") {
      await this.client.ensureDir(parent);
      await this.client.cd("/");
    }
  }
}
