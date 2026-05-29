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

/** Persisted location of the installed `kira` CLI, so editor configs can use
 *  its absolute path (apps launched from the Dock have a minimal PATH). */
export interface CliLocation {
  get(): string | null;
  set(path: string): void;
}

export interface CliStatus {
  installed: boolean;
  path: string | null;
}

export class EditorIntegrationService {
  private home: string;
  private cliLoc: CliLocation;

  /** `home`/`cliLoc` are injectable so tests never touch real config. */
  constructor(home: string = homedir(), cliLoc?: CliLocation) {
    this.home = home;
    this.cliLoc = cliLoc ?? memoryCliLocation();
  }

  /** Absolute path to the installed CLI if known, else the bare name. */
  private kiraBin(): string {
    return this.cliLoc.get() ?? process.env.KIRA_CLI_PATH ?? "kira";
  }

  /* ------------------------------- CLI ---------------------------------- */

  cliStatus(): CliStatus {
    const path = this.cliLoc.get();
    return { installed: path !== null && existsSync(path), path };
  }

  /**
   * Install the `kira` CLI as a tiny shell script (curl-based) into `dir`.
   * No build step, no 63MB binary: it reads the port/token files the app
   * publishes and POSTs to the control server.
   */
  installCli(dir: string): InstallResult {
    const target = join(dir, "kira");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, CLI_SCRIPT.replace("__DATA_DIR__", this.appDataDir()), {
        mode: 0o755,
      });
      this.cliLoc.set(target);
      return {
        ok: true,
        alreadyInstalled: false,
        message: `Installed to ${target}`,
      };
    } catch (e) {
      return { ok: false, alreadyInstalled: false, message: (e as Error).message };
    }
  }

  /** App data dir (where the control-port / control-token files live). */
  private appDataDir(): string {
    if (process.env.KIRA_DATA_DIR) return process.env.KIRA_DATA_DIR;
    return join(this.home, "Library/Application Support/kira-ftp");
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

/** Fallback CLI location store for tests / when no persistent store is given. */
function memoryCliLocation(): CliLocation {
  let value: string | null = null;
  return { get: () => value, set: (p) => void (value = p) };
}

/**
 * The `kira` CLI as a self-contained POSIX shell script (no Bun runtime, no
 * build). Reads the control port/token the app publishes and POSTs the command;
 * launches the app if it isn't running. __DATA_DIR__ is baked in at install.
 */
const CLI_SCRIPT = `#!/bin/sh
# kira — Kira FTP CLI (installed by the app). Triggers upload/download/sync of a
# path; the app resolves which project owns it.
#   kira <upload|download|sync-up|sync-down|sync> <path>
set -eu
DATA_DIR="__DATA_DIR__"
APP_PATH="\${KIRA_APP_PATH:-/Applications/Kira FTP.app}"

action="\${1:-}"; target="\${2:-}"
case "$action" in
  up) action=upload;; down) action=download;;
  push) action=sync-up;; pull) action=sync-down;; sync) action=sync-both;;
  upload|download|sync-up|sync-down|sync-both) ;;
  *) echo "Usage: kira <upload|download|sync-up|sync-down|sync> <path>" >&2; exit 2;;
esac
[ -n "$target" ] || { echo "Missing <path>" >&2; exit 2; }

# absolute path
case "$target" in /*) ;; *) target="$(pwd)/$target";; esac

read_file() { [ -f "$1" ] && cat "$1" || echo ""; }
port() { p="$(read_file "$DATA_DIR/control-port")"; [ -n "$p" ] && echo "$p" || echo 8911; }
token() { read_file "$DATA_DIR/control-token"; }

ping() { curl -fsS --max-time 1 "http://127.0.0.1:$(port)/ping" >/dev/null 2>&1; }

if ! ping; then
  echo "Kira FTP is not running — launching…" >&2
  open -g "$APP_PATH" 2>/dev/null || true
  i=0; while [ $i -lt 40 ]; do ping && break; sleep 0.25; i=$((i+1)); done
  ping || { echo "Could not reach Kira FTP (set KIRA_APP_PATH if needed)" >&2; exit 1; }
fi

TOKEN="$(token)"
[ -n "$TOKEN" ] || { echo "Control token not found; open Kira FTP once." >&2; exit 1; }

# JSON-encode the path (escape backslashes and quotes)
esc=$(printf '%s' "$target" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
resp=$(curl -fsS --max-time 600 -X POST \\
  -H "Content-Type: application/json" -H "x-kira-token: $TOKEN" \\
  -d "{\\"action\\":\\"$action\\",\\"path\\":\\"$esc\\"}" \\
  "http://127.0.0.1:$(port)/command" 2>/dev/null) || {
    echo "Kira FTP request failed" >&2; exit 1; }

case "$resp" in
  *'"ok":true'*) echo "✓ \${resp}";;
  *) echo "✗ \${resp}" >&2; exit 1;;
esac
`;

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
