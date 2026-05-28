/**
 * Filesystem watcher that replicates Sublime SFTP's "upload on save" for a
 * standalone app: watch a project's local dir and auto-upload changed files.
 * Uses node:fs recursive watch (native on macOS) — no extra dependency.
 */
import { watch, type FSWatcher } from "node:fs";
import { relative, join, sep } from "node:path";
import { statSync } from "node:fs";
import type { Connection, Project } from "../../shared/domain";
import { isIgnored } from "../util/ignore";
import { joinRemote } from "../connections/transport";

interface WatchHandle {
  watcher: FSWatcher;
  timers: Map<string, ReturnType<typeof setTimeout>>;
}

export interface WatcherDeps {
  /** Upload one file; resolves when queued. */
  upload: (conn: Connection, localPath: string, remotePath: string) => void;
  /** Emit a watch activity event for the UI. */
  onEvent: (projectId: number, path: string, action: "upload" | "skip") => void;
}

const DEBOUNCE_MS = 250;

export class WatcherService {
  private handles = new Map<number, WatchHandle>();

  constructor(private deps: WatcherDeps) {}

  isWatching(projectId: number): boolean {
    return this.handles.has(projectId);
  }

  /** Start watching a project's local dir, uploading changes to remoteRoot. */
  start(
    project: Project,
    conn: Connection,
    remoteRoot: string,
    ignoreRegexes: RegExp[],
  ): void {
    if (this.handles.has(project.id)) return;

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const watcher = watch(
      project.localPath,
      { recursive: true },
      (_event, filename) => {
        if (!filename) return;
        const rel = filename.toString();
        const localPath = join(project.localPath, rel);

        if (isIgnored(rel, ignoreRegexes)) {
          this.deps.onEvent(project.id, localPath, "skip");
          return;
        }

        // debounce rapid successive events for the same file
        const existing = timers.get(rel);
        if (existing) clearTimeout(existing);
        timers.set(
          rel,
          setTimeout(() => {
            timers.delete(rel);
            this.handleChange(project, conn, remoteRoot, rel, localPath);
          }, DEBOUNCE_MS),
        );
      },
    );

    this.handles.set(project.id, { watcher, timers });
  }

  private handleChange(
    project: Project,
    conn: Connection,
    remoteRoot: string,
    rel: string,
    localPath: string,
  ): void {
    let isFile = false;
    try {
      isFile = statSync(localPath).isFile();
    } catch {
      // deleted/moved — upload-on-save only mirrors writes, not deletes
      this.deps.onEvent(project.id, localPath, "skip");
      return;
    }
    if (!isFile) return;

    const remotePath = joinRemote(remoteRoot, rel.split(sep).join("/"));
    this.deps.upload(conn, localPath, remotePath);
    this.deps.onEvent(project.id, localPath, "upload");
  }

  stop(projectId: number): void {
    const handle = this.handles.get(projectId);
    if (!handle) return;
    for (const t of handle.timers.values()) clearTimeout(t);
    handle.watcher.close();
    this.handles.delete(projectId);
  }

  stopAll(): void {
    for (const id of [...this.handles.keys()]) this.stop(id);
  }
}
