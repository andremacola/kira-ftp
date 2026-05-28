/**
 * Local filesystem helpers returning the same FileEntry shape as remote
 * transports, so the UI can render both panes uniformly.
 */
import { readdir, stat, lstat, mkdir, rename, rm, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import type { FileEntry } from "../../shared/domain";

export async function listLocal(dir: string): Promise<FileEntry[]> {
  const names = await readdir(dir);
  const entries: FileEntry[] = [];
  for (const name of names) {
    const full = join(dir, name);
    try {
      const st = await lstat(full);
      const isLink = st.isSymbolicLink();
      let type: FileEntry["type"] = isLink ? "symlink" : st.isDirectory() ? "dir" : "file";
      entries.push({
        name,
        path: full,
        type,
        size: st.size,
        modifiedMs: st.mtimeMs,
        mode: st.mode & 0o777,
      });
    } catch {
      // unreadable entry; skip
    }
  }
  return entries;
}

export async function statLocal(path: string): Promise<FileEntry | null> {
  try {
    const st = await stat(path);
    return {
      name: basename(path),
      path,
      type: st.isDirectory() ? "dir" : "file",
      size: st.size,
      modifiedMs: st.mtimeMs,
      mode: st.mode & 0o777,
    };
  } catch {
    return null;
  }
}

export async function mkdirLocal(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function renameLocal(from: string, to: string): Promise<void> {
  await rename(from, to);
}

export async function deleteLocal(path: string): Promise<void> {
  const st = await lstat(path).catch(() => null);
  if (!st) return;
  if (st.isDirectory()) await rm(path, { recursive: true, force: true });
  else await unlink(path);
}
