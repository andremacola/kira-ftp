/**
 * Install Kira FTP keybindings into supported editors so their shortcuts call
 * the `kira` CLI. Each install is idempotent: a marker keeps us from adding
 * duplicate bindings, and status() reports what's present.
 *
 * Scope per editor:
 * - VS Code / Cursor / Antigravity IDE (VS Code forks): global keybindings that
 *   run tasks named "Kira: <action>"; the matching tasks.json is per-workspace
 *   (we document it). Same format, different config dirs.
 * - Zed: keymap bindings + global tasks — fully wired.
 * - Sublime: a plugin file + keymap in Packages/User.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseJsoncArray } from "../util/jsonc";

export type EditorId = "vscode" | "cursor" | "antigravity" | "zed" | "sublime";

export interface EditorStatus {
  id: EditorId;
  name: string;
  detected: boolean;
  installed: boolean;
}

export interface InstallResult {
  ok: boolean;
  alreadyInstalled: boolean;
  message: string;
}

const MARKER = "kira-ftp";

const BINDINGS: Array<{ key: string; action: string }> = [
  { key: "u", action: "upload" },
  { key: "d", action: "download" },
  { key: "up", action: "sync-up" },
  { key: "down", action: "sync-down" },
  { key: "s", action: "sync" },
];

const VSCODE_KEYS: Record<string, string> = {
  u: "cmd+alt+u",
  d: "cmd+alt+d",
  up: "cmd+alt+up",
  down: "cmd+alt+down",
  s: "cmd+alt+s",
};

/** VS Code-family editors share the same config format; only dirs differ. */
interface VscodeFork {
  id: EditorId;
  name: string;
  appNames: string[]; // possible /Applications/*.app names
  supportDir: string; // ~/Library/Application Support/<dir>
}

export class EditorIntegrationService {
  private home: string;

  /** `home` is injectable so tests never touch the real user config. */
  constructor(home: string = homedir()) {
    this.home = home;
  }

  private kiraBin(): string {
    return process.env.KIRA_CLI_PATH ?? "kira";
  }

  private appSupport(name: string): string {
    return join(this.home, "Library/Application Support", name);
  }

  private vscodeForks(): VscodeFork[] {
    return [
      {
        id: "vscode",
        name: "VS Code",
        appNames: ["Visual Studio Code"],
        supportDir: "Code",
      },
      { id: "cursor", name: "Cursor", appNames: ["Cursor"], supportDir: "Cursor" },
      {
        id: "antigravity",
        name: "Antigravity IDE",
        // The Google IDE was renamed; the active config dir is "Antigravity IDE".
        appNames: ["Antigravity IDE", "Antigravity"],
        supportDir: "Antigravity IDE",
      },
    ];
  }

  private forkKeybindings(fork: VscodeFork): string {
    return join(this.appSupport(fork.supportDir), "User/keybindings.json");
  }

  private zedKeymap(): string {
    return join(this.home, ".config/zed/keymap.json");
  }
  private zedTasks(): string {
    return join(this.home, ".config/zed/tasks.json");
  }
  private sublimeUser(): string {
    return join(this.home, "Library/Application Support/Sublime Text/Packages/User");
  }

  /* ------------------------------ status -------------------------------- */

  status(): EditorStatus[] {
    const forks = this.vscodeForks().map((f) => ({
      id: f.id,
      name: f.name,
      detected:
        f.appNames.some((n) => existsSync(`/Applications/${n}.app`)) ||
        existsSync(this.appSupport(f.supportDir)),
      // installed = all our task-label bindings present
      installed: this.arrayHasAll(this.forkKeybindings(f), (e) =>
        BINDINGS.map((b) => this.vscodeTaskLabel(b.action)).includes(
          String((e as { args?: unknown }).args),
        ),
      ),
    }));
    return [
      ...forks,
      {
        id: "zed",
        name: "Zed",
        detected: existsSync("/Applications/Zed.app") || existsSync(join(this.home, ".config/zed")),
        installed: this.arrayHasAll(this.zedTasks(), (e) =>
          String((e as { label?: unknown }).label).startsWith(`${MARKER}:`),
        ),
      },
      {
        id: "sublime",
        name: "Sublime Text",
        detected:
          existsSync("/Applications/Sublime Text.app") || existsSync(this.sublimeUser()),
        installed: existsSync(join(this.sublimeUser(), "kira_ftp.py")),
      },
    ];
  }

  /** True if the JSONC array file contains at least one entry matching pred
   *  for every binding (i.e. all our entries are present). */
  private arrayHasAll(path: string, pred: (e: unknown) => boolean): boolean {
    const arr = this.readArray(path);
    const matches = arr.filter(
      (e) => e !== null && typeof e === "object" && pred(e),
    ).length;
    return matches >= BINDINGS.length;
  }

  /* ----------------------------- install -------------------------------- */

  install(id: EditorId): InstallResult {
    const fork = this.vscodeForks().find((f) => f.id === id);
    if (fork) return this.installVscodeFork(fork);
    if (id === "zed") return this.installZed();
    return this.installSublime();
  }

  private ensureDir(file: string): void {
    mkdirSync(join(file, ".."), { recursive: true });
  }

  private readArray(path: string): unknown[] {
    try {
      return parseJsoncArray(readFileSync(path, "utf-8"));
    } catch {
      return [];
    }
  }

  /** Write JSON, backing up an existing non-empty file to `<path>.kira.bak`. */
  private writeBackedUp(path: string, data: unknown): void {
    this.ensureDir(path);
    if (existsSync(path)) {
      try {
        copyFileSync(path, `${path}.kira.bak`);
      } catch {
        /* best-effort backup */
      }
    }
    writeFileSync(path, JSON.stringify(data, null, 2));
  }

  /** Our VS Code task label for an action (also the idempotency marker). */
  private vscodeTaskLabel(action: string): string {
    return `Kira: ${action}`;
  }

  private installVscodeFork(fork: VscodeFork): InstallResult {
    const path = this.forkKeybindings(fork);
    const arr = this.readArray(path);
    const has = (label: string) =>
      arr.some(
        (e) =>
          e !== null &&
          typeof e === "object" &&
          (e as { args?: unknown }).args === label,
      );
    if (BINDINGS.every((b) => has(this.vscodeTaskLabel(b.action)))) {
      return { ok: true, alreadyInstalled: true, message: `${fork.name} already configured` };
    }
    for (const b of BINDINGS) {
      const label = this.vscodeTaskLabel(b.action);
      if (has(label)) continue; // don't duplicate an existing binding
      // No `when` clause: the binding is always active. (A `when` with a JS
      // comment is invalid context-key syntax and would disable the binding.)
      arr.push({ key: VSCODE_KEYS[b.key], command: "workbench.action.tasks.runTask", args: label });
    }
    this.writeBackedUp(path, arr);
    return {
      ok: true,
      alreadyInstalled: false,
      message:
        `${fork.name} keybindings installed. Add the matching tasks.json to your ` +
        "workspace (editor-integration/vscode/tasks.json) so the shortcuts can run.",
    };
  }

  private installZed(): InstallResult {
    const keymapPath = this.zedKeymap();
    const tasksPath = this.zedTasks();
    const tasks = this.readArray(tasksPath);
    const taskLabel = (action: string) => `${MARKER}: ${action}`;
    const hasTask = (label: string) =>
      tasks.some((t) => t !== null && typeof t === "object" && (t as { label?: unknown }).label === label);

    if (BINDINGS.every((b) => hasTask(taskLabel(b.action)))) {
      return { ok: true, alreadyInstalled: true, message: "Zed already configured" };
    }
    const bin = this.kiraBin();
    for (const b of BINDINGS) {
      if (hasTask(taskLabel(b.action))) continue;
      tasks.push({
        label: taskLabel(b.action),
        command: `${bin} ${b.action} "$ZED_FILE"`,
        use_new_terminal: false,
        reveal: "never", // valid Zed values: always | no_focus | never
      });
    }
    this.writeBackedUp(tasksPath, tasks);

    const keymap = this.readArray(keymapPath);
    const keyName: Record<string, string> = {
      u: "cmd-alt-u",
      d: "cmd-alt-d",
      up: "cmd-alt-up",
      down: "cmd-alt-down",
      s: "cmd-alt-s",
    };
    const bindings: Record<string, unknown> = {};
    for (const b of BINDINGS) {
      bindings[keyName[b.key]!] = ["task::Spawn", { task_name: taskLabel(b.action) }];
    }
    keymap.push({ context: "Workspace", bindings });
    this.writeBackedUp(keymapPath, keymap);
    return { ok: true, alreadyInstalled: false, message: "Zed tasks + keybindings installed" };
  }

  private installSublime(): InstallResult {
    const dir = this.sublimeUser();
    const pluginPath = join(dir, "kira_ftp.py");
    if (existsSync(pluginPath)) {
      return { ok: true, alreadyInstalled: true, message: "Sublime Text already configured" };
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(pluginPath, SUBLIME_PLUGIN.replace("__KIRA_BIN__", this.kiraBin()));

    const keymapPath = join(dir, "Default (OSX).sublime-keymap");
    const keymap = this.readArray(keymapPath);
    const keyName: Record<string, string> = {
      u: "super+alt+u",
      d: "super+alt+d",
      up: "super+alt+up",
      down: "super+alt+down",
      s: "super+alt+s",
    };
    const has = (action: string) =>
      keymap.some(
        (e) =>
          e !== null &&
          typeof e === "object" &&
          (e as { command?: unknown; args?: { action?: unknown } }).command === "kira_ftp" &&
          (e as { args?: { action?: unknown } }).args?.action === action,
      );
    for (const b of BINDINGS) {
      if (has(b.action)) continue;
      keymap.push({ keys: [keyName[b.key]], command: "kira_ftp", args: { action: b.action } });
    }
    this.writeBackedUp(keymapPath, keymap);
    return { ok: true, alreadyInstalled: false, message: "Sublime plugin + keybindings installed" };
  }
}

const SUBLIME_PLUGIN = `# kira-ftp integration for Sublime Text (installed by Kira FTP).
import os, subprocess, sublime, sublime_plugin
KIRA_BIN = "__KIRA_BIN__"

class KiraFtpCommand(sublime_plugin.TextCommand):
    def run(self, edit, action="upload"):
        path = self.view.file_name()
        if not path:
            sublime.status_message("Kira FTP: save the file first"); return
        if action in ("upload", "sync-up", "sync"):
            self.view.run_command("save")
        def worker():
            try:
                p = subprocess.run([KIRA_BIN, action, path], capture_output=True,
                                   text=True, timeout=120, env=dict(os.environ))
                out = (p.stdout or p.stderr or "").strip().splitlines()
                msg = out[-1] if out else ("ok" if p.returncode == 0 else "failed")
                sublime.set_timeout(lambda: sublime.status_message("Kira FTP: " + msg), 0)
            except Exception as e:
                sublime.set_timeout(lambda: sublime.status_message("Kira FTP error: " + str(e)), 0)
        sublime.set_timeout_async(worker, 0)
`;
