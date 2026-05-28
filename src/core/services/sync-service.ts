/**
 * Sync engine on top of rclone. Previews are computed locally from recursive
 * listings of both sides (full control over the diff shown to the user);
 * execution is delegated to rclone sync/copy (one-way) or bisync (two-way).
 */
import type {
  Connection,
  SyncPlan,
  SyncPlanItem,
} from "../../shared/domain";
import type { RcloneClient } from "../rclone/client";

export type SyncDirection = "up" | "down" | "both";

interface SyncOptions {
  skipDeletes: boolean;
  sameAge: boolean;
  filters: string[];
}

interface Entry {
  path: string;
  size: number;
  modMs: number;
  isDir: boolean;
}

const MTIME_TOLERANCE_MS = 2000;

function toEntries(
  list: Array<{ Path: string; Size: number; ModTime: string; IsDir: boolean }>,
): Map<string, Entry> {
  const map = new Map<string, Entry>();
  for (const e of list) {
    if (e.IsDir) continue;
    map.set(e.Path, {
      path: e.Path,
      size: e.Size,
      modMs: Date.parse(e.ModTime) || 0,
      isDir: false,
    });
  }
  return map;
}

export class SyncService {
  constructor(private rclone: RcloneClient) {}

  /** Build src/dst rclone fs strings for a direction. */
  private async endpoints(
    conn: Connection,
    localDir: string,
    remoteDir: string,
    direction: Exclude<SyncDirection, "both">,
  ): Promise<{ srcFs: string; dstFs: string }> {
    const remoteFs = await this.rclone.buildFs(conn, remoteDir);
    return direction === "up"
      ? { srcFs: localDir, dstFs: remoteFs }
      : { srcFs: remoteFs, dstFs: localDir };
  }

  /** Compute a preview of what a one-way sync would do. */
  async preview(
    conn: Connection,
    localDir: string,
    remoteDir: string,
    direction: Exclude<SyncDirection, "both">,
    opts: SyncOptions,
  ): Promise<SyncPlan> {
    await this.rclone.ensureDaemon();
    const { srcFs, dstFs } = await this.endpoints(conn, localDir, remoteDir, direction);
    const [srcList, dstList] = await Promise.all([
      this.rclone.listFs(srcFs, true),
      this.rclone.listFs(dstFs, true),
    ]);
    const src = toEntries(srcList);
    const dst = toEntries(dstList);

    const items: SyncPlanItem[] = [];
    let totalBytes = 0;
    const action: SyncPlanItem["action"] = direction === "up" ? "upload" : "download";

    for (const [path, s] of src) {
      const d = dst.get(path);
      if (!d) {
        items.push({ action, path, size: s.size, reason: "new" });
        totalBytes += s.size;
      } else if (s.size !== d.size) {
        items.push({ action, path, size: s.size, reason: "size-diff" });
        totalBytes += s.size;
      } else if (s.modMs - d.modMs > MTIME_TOLERANCE_MS) {
        items.push({ action, path, size: s.size, reason: "newer" });
        totalBytes += s.size;
      } else if (opts.sameAge && s.modMs !== d.modMs) {
        items.push({ action, path, size: s.size, reason: "newer" });
        totalBytes += s.size;
      }
    }

    if (!opts.skipDeletes) {
      const deleteAction: SyncPlanItem["action"] =
        direction === "up" ? "delete-remote" : "delete-local";
      for (const [path, d] of dst) {
        if (!src.has(path)) {
          items.push({ action: deleteAction, path, size: d.size, reason: "orphan" });
        }
      }
    }

    return { items, totalBytes };
  }

  /** Start a one-way sync job; returns the rclone job id. */
  async runOneWay(
    conn: Connection,
    localDir: string,
    remoteDir: string,
    direction: Exclude<SyncDirection, "both">,
    opts: SyncOptions,
  ): Promise<number> {
    await this.rclone.ensureDaemon();
    const { srcFs, dstFs } = await this.endpoints(conn, localDir, remoteDir, direction);
    // skipDeletes -> copy (additive); otherwise sync (mirror, deletes orphans)
    return this.rclone.startSync({
      srcFs,
      dstFs,
      mode: opts.skipDeletes ? "copy" : "sync",
      filters: opts.filters,
      extra: { createEmptySrcDirs: true },
    });
  }

  /**
   * Start a two-way bisync job. Defaults to resync (newest-wins baseline) so it
   * works on first run without a prior listing; this favours safety (no
   * surprise deletions) over strict delete propagation.
   */
  async runBoth(
    conn: Connection,
    localDir: string,
    remoteDir: string,
    opts: SyncOptions,
    resync = true,
  ): Promise<number> {
    await this.rclone.ensureDaemon();
    const remoteFs = await this.rclone.buildFs(conn, remoteDir);
    return this.rclone.startBisync({
      path1: localDir,
      path2: remoteFs,
      resync,
      filters: opts.filters,
    });
  }
}
