/**
 * Resolve an arbitrary local filesystem path to the project that contains it,
 * and map it to the corresponding remote path. Used by the CLI/control server
 * so editors can trigger upload/download/sync on a file or folder by path.
 */
import { resolve, relative, sep } from "node:path";
import type { Connection, Environment, Project } from "../../shared/domain";
import { joinRemote } from "../connections/transport";

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
    const localPath = resolve(inputPath);
    const candidates = this.deps
      .listProjects()
      .filter((p) => isInside(resolve(p.localPath), localPath))
      .sort((a, b) => resolve(b.localPath).length - resolve(a.localPath).length);

    for (const project of candidates) {
      const envs = this.deps.listEnvironments(project.id);
      const env =
        envs.find((e) => e.id === project.defaultEnvironmentId) ??
        envs.find((e) => e.isDefault) ??
        envs[0];
      if (!env) continue;
      const connection = this.deps.getConnection(env.connectionId);
      if (!connection) continue;

      const rootAbs = resolve(project.localPath);
      const rel = relative(rootAbs, localPath).split(sep).join("/");
      const remoteRoot = env.remotePath || connection.remotePath || "/";
      const remotePath = rel ? joinRemote(remoteRoot, rel) : remoteRoot;

      return { project, environment: env, connection, localPath, relPath: rel, remotePath, remoteRoot };
    }
    return null;
  }
}
