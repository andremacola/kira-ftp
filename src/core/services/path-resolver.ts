/**
 * Resolve an arbitrary local filesystem path to the project that contains it,
 * and map it to the corresponding remote path. Used by the CLI/control server
 * so editors can trigger upload/download/sync on a file or folder by path.
 */
import { resolve, relative, sep } from "node:path";
import { realpathSync } from "node:fs";
import type { Connection, Environment, Project } from "../../shared/domain";
import { joinRemote } from "../connections/transport";

/**
 * Canonicalize a path: resolve symlinks so a path reached through a symlink
 * (e.g. ~/Google Drive -> ~/Library/CloudStorage/GoogleDrive-…) matches a
 * project root stored as the real path. Falls back to a partial resolve when
 * the path (or a parent) doesn't exist yet.
 */
export function canonical(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    // Path may not exist (e.g. a download target). Resolve the deepest existing
    // ancestor and re-append the missing tail, so symlinked roots still match.
    let dir = resolve(p);
    const tail: string[] = [];
    while (true) {
      const parent = resolve(dir, "..");
      if (parent === dir) return resolve(p); // reached FS root; give up
      try {
        const real = realpathSync(parent);
        tail.push(dir.slice(parent.length + 1));
        return resolve(real, ...tail.reverse());
      } catch {
        tail.push(dir.slice(parent.length + 1));
        dir = parent;
      }
    }
  }
}

export interface ResolvedTarget {
  project: Project;
  environment: Environment;
  connection: Connection;
  /** Absolute, normalized local path. */
  localPath: string;
  /** Path relative to the project root, POSIX separators ("" if root). */
  relPath: string;
  /** Mapped remote path (remoteRoot + relPath). */
  remotePath: string;
  /** The project's remote root. */
  remoteRoot: string;
}

/** True if `child` is inside (or equal to) `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:/.test(p);
}

export interface ResolverDeps {
  listProjects: () => Project[];
  listEnvironments: (projectId: number) => Environment[];
  getConnection: (id: number) => Connection | null;
}

export class PathResolver {
  constructor(private deps: ResolverDeps) {}

  /**
   * Find the project whose localPath contains `inputPath`. When several match
   * (nested projects), the deepest (longest localPath) wins.
   */
  resolve(inputPath: string): ResolvedTarget | null {
    // Canonicalize through symlinks so paths via ~/Google Drive (a symlink)
    // match a project root stored as ~/Library/CloudStorage/… and vice versa.
    const localPath = canonical(inputPath);
    const candidates = this.deps
      .listProjects()
      .map((p) => ({ p, root: canonical(p.localPath) }))
      .filter(({ root }) => isInside(root, localPath))
      .sort((a, b) => b.root.length - a.root.length);

    for (const { p: project, root: rootAbs } of candidates) {
      const envs = this.deps.listEnvironments(project.id);
      const env =
        envs.find((e) => e.id === project.defaultEnvironmentId) ??
        envs.find((e) => e.isDefault) ??
        envs[0];
      if (!env) continue;
      const connection = this.deps.getConnection(env.connectionId);
      if (!connection) continue;

      const rel = relative(rootAbs, localPath).split(sep).join("/");
      const remoteRoot = env.remotePath || connection.remotePath || "/";
      const remotePath = rel ? joinRemote(remoteRoot, rel) : remoteRoot;

      return { project, environment: env, connection, localPath, relPath: rel, remotePath, remoteRoot };
    }
    return null;
  }
}
