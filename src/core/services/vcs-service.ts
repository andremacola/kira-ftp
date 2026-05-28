/**
 * Detect changed files via the local VCS (git/hg/svn) so the user can upload
 * only what changed, mirroring Sublime SFTP's "upload changed files".
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Vcs = "git" | "hg" | "svn";

async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

export class VcsService {
  /** Detect which VCS (if any) manages a directory. */
  detect(dir: string): Vcs | null {
    if (existsSync(join(dir, ".git"))) return "git";
    if (existsSync(join(dir, ".hg"))) return "hg";
    if (existsSync(join(dir, ".svn"))) return "svn";
    return null;
  }

  /**
   * Return changed/added/modified file paths relative to `dir`.
   * Excludes deletions (upload-only semantics).
   */
  async changedFiles(dir: string): Promise<string[]> {
    const vcs = this.detect(dir);
    if (!vcs) return [];
    if (vcs === "git") return this.gitChanged(dir);
    if (vcs === "hg") return this.hgChanged(dir);
    return this.svnChanged(dir);
  }

  private async gitChanged(dir: string): Promise<string[]> {
    const out = await run(["git", "status", "--porcelain", "--untracked-files=all"], dir);
    const files: string[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2);
      const path = line.slice(3).trim();
      if (status.includes("D")) continue; // skip deletions
      // handle "old -> new" rename form
      const finalPath = path.includes(" -> ") ? path.split(" -> ")[1]! : path;
      files.push(finalPath.replace(/^"|"$/g, ""));
    }
    return files;
  }

  private async hgChanged(dir: string): Promise<string[]> {
    const out = await run(["hg", "status"], dir);
    const files: string[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const code = line[0];
      const path = line.slice(2).trim();
      if (code === "R" || code === "!") continue; // removed/missing
      files.push(path);
    }
    return files;
  }

  private async svnChanged(dir: string): Promise<string[]> {
    const out = await run(["svn", "status"], dir);
    const files: string[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const code = line[0];
      const path = line.slice(8).trim();
      if (code === "D" || code === "!") continue;
      if (code === "A" || code === "M" || code === "R" || code === "?") files.push(path);
    }
    return files;
  }
}
