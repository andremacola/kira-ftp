/**
 * Local rmate server: lets `rmate <file>` on a remote host (over an SSH reverse
 * tunnel, `ssh -R 52698:localhost:52698`) open that file in a local editor and
 * sync it back on save. We bundle the `zed-rmate-server` binary (it speaks the
 * rmate protocol) and just manage its lifecycle + the chosen editor — mirroring
 * how RcloneClient wraps the rclone daemon.
 */
import type { Subprocess } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type RmateEditor = "zed" | "vscode" | "antigravity" | "sublime";

export type RmateState = "running" | "stopped" | "failed";

export interface RmateStatus {
  state: RmateState;
  /** Address the server binds (host:port). */
  bind: string;
  editor: RmateEditor;
  error: string | null;
}

const EDITOR_KEY = "rmateEditor";
const ENABLED_KEY = "rmateEnabled";
const BIND = "127.0.0.1:52698";

/** Persistence hook (backed by SettingsRepo in the app). */
export interface RmateStore {
  getEditor(): RmateEditor | null;
  setEditor(e: RmateEditor): void;
  getEnabled(): boolean;
  setEnabled(on: boolean): void;
}

export const RMATE_EDITORS: Array<{ id: RmateEditor; name: string }> = [
  { id: "zed", name: "Zed" },
  { id: "vscode", name: "VS Code" },
  { id: "antigravity", name: "Antigravity IDE" },
  { id: "sublime", name: "Sublime Text" },
];

/** Directory holding the bundled rmate binary + editor wrappers. */
function rmateDir(): string {
  if (process.env.KIRA_RMATE_DIR) return process.env.KIRA_RMATE_DIR;
  try {
    // production: copied next to the bun executable under bin/rmate
    const bundled = join(import.meta.dir, "rmate");
    if (existsSync(bundled)) return bundled;
  } catch {
    /* import.meta.dir unavailable */
  }
  // dev: repo root /bin/rmate
  return join(process.cwd(), "bin", "rmate");
}

export class RmateService {
  private proc: Subprocess | null = null;
  private state: RmateState = "stopped";
  private lastError: string | null = null;

  constructor(private store: RmateStore) {}

  editor(): RmateEditor {
    return this.store.getEditor() ?? "zed";
  }

  status(): RmateStatus {
    return { state: this.state, bind: BIND, editor: this.editor(), error: this.lastError };
  }

  isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /** Editors detected on this machine (for enabling/disabling in the UI). */
  detectedEditors(): Record<RmateEditor, boolean> {
    return {
      zed: existsSync("/usr/local/bin/zed") || existsSync("/Applications/Zed.app"),
      vscode: existsSync("/Applications/Visual Studio Code.app"),
      antigravity:
        existsSync("/Applications/Antigravity IDE.app") ||
        existsSync("/Applications/Antigravity.app"),
      sublime: existsSync("/Applications/Sublime Text.app"),
    };
  }

  /** Resolve the editor's launch command for the rmate server's --zed-bin. */
  private editorBin(editor: RmateEditor): string {
    const dir = rmateDir();
    switch (editor) {
      case "zed":
        return existsSync("/usr/local/bin/zed") ? "/usr/local/bin/zed" : "zed";
      case "vscode":
        return join(dir, "wrappers", "vscode-open.sh");
      case "antigravity":
        return join(dir, "wrappers", "antigravity-open.sh");
      case "sublime":
        return "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl";
    }
  }

  /** Start the rmate server for the current editor. Idempotent. */
  start(): RmateStatus {
    if (this.isRunning()) return this.status();
    const editor = this.editor();
    const bin = join(rmateDir(), "zed-rmate-server");
    try {
      this.proc = Bun.spawn([bin, "--zed-bin", this.editorBin(editor), "--bind", BIND], {
        stdout: "ignore",
        stderr: "pipe",
        onExit: (_p, code) => {
          // unexpected exit (we didn't stop it) -> reflect failure
          if (this.proc && code !== 0 && this.state === "running") {
            this.state = "failed";
            this.lastError = `rmate server exited (code ${code})`;
          }
        },
      });
      this.state = "running";
      this.lastError = null;
      this.store.setEnabled(true);
    } catch (err) {
      this.proc = null;
      this.state = "failed";
      this.lastError = (err as Error).message;
    }
    return this.status();
  }

  /** Stop the server. */
  stop(): RmateStatus {
    this.killProc();
    this.state = "stopped";
    this.lastError = null;
    this.store.setEnabled(false);
    return this.status();
  }

  /** Enable/disable (start/stop) the server. */
  setEnabled(on: boolean): RmateStatus {
    return on ? this.start() : this.stop();
  }

  /** Switch editor; restart the server if it was running (port needs a beat). */
  async setEditor(editor: RmateEditor): Promise<RmateStatus> {
    this.store.setEditor(editor);
    if (this.isRunning()) {
      this.killProc();
      await Bun.sleep(500); // let the port be released
      return this.start();
    }
    return this.status();
  }

  /** Synchronous kill for the bare exit handler. */
  killSync(): void {
    this.killProc();
    this.state = "stopped";
  }

  private killProc(): void {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        /* already gone */
      }
      this.proc = null;
    }
  }
}
