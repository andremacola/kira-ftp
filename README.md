<div align="center">

# Kira FTP

**A modern, standalone macOS SFTP/FTP/FTPS client** that recreates the full
workflow of the Sublime Text *SFTP* plugin as a native desktop app.

Built with **Electrobun · Bun · React 19 · Tailwind v4** — a hybrid transfer
engine (**ssh2 / basic-ftp** for interactive ops, **rclone** for bulk
transfer & sync) on top of **SQLite**.

</div>

---

## Table of contents

- [What it does](#what-it-does)
- [Features](#features)
- [Concepts](#concepts)
- [Getting started](#getting-started)
- [Using the app](#using-the-app)
  - [Projects](#projects)
  - [Browsing & file operations](#browsing--file-operations)
  - [Transfers](#transfers)
  - [Sync](#sync)
  - [Upload on save (watch)](#upload-on-save-watch)
  - [VCS — upload changed files](#vcs--upload-changed-files)
  - [Remote editing & diff](#remote-editing--diff)
  - [Importing a Sublime `sftp-config.json`](#importing-a-sublime-sftp-configjson)
  - [Menu bar & Dock](#menu-bar--dock)
- [CLI & editor integration](#cli--editor-integration)
- [Global settings](#global-settings)
- [Architecture](#architecture)
- [Development](#development)
- [Building & packaging](#building--packaging)
- [Status & roadmap](#status--roadmap)

---

## What it does

Kira FTP maps a **local folder** to a **remote directory** on a server and lets
you browse both sides, transfer files, keep them in sync, edit remote files,
and auto-upload on save — all from a clean dual-pane UI, a `⌘K` command palette,
or a CLI you can wire into your editor.

It targets **macOS (Apple Silicon)** first.

## Features

- **Protocols:** SFTP (SSH key / password / agent), FTP, and FTPS (TLS).
- **Self-contained projects:** each project owns its own connection — nothing is
  shared or global, so editing one project never affects another.
- **Mapped dual-pane browser:** local ↔ remote panes are mirrored and locked to
  the project roots; navigating one moves the other to the matching subfolder.
- **File operations:** new folder/file, rename, delete, `chmod`, with
  multi-select (⌘/⇧-click) and **drag-and-drop between panes**.
- **Transfers:** single files via the persistent connection; whole folders via
  rclone — with a queue, live progress, speed/ETA, cancel, and a persistent
  history.
- **Sync:** up / down (one-way) with a **dry-run preview**, and two-way
  (`bisync`) — honoring per-project ignore rules.
- **Upload on save:** a filesystem watcher that re-uploads changed files, with
  content-hash de-duplication (no spurious re-uploads from cloud-drive touches).
- **VCS:** upload only the files changed according to git / hg / svn.
- **Remote editing:** open a remote file in an embedded CodeMirror editor;
  **diff** any file against its local/remote counterpart.
- **Ignore rules:** per-project regex patterns, also translated to rclone
  filters for sync.
- **Sublime import:** bring in an existing `sftp-config.json` (JSONC tolerant).
- **Menu bar presence:** a tray icon that animates during activity, native
  completion notifications, and an option to run from the menu bar only
  (hidden from the Dock).
- **CLI + editor integration:** trigger upload/download/sync on the current file
  from VS Code, Cursor, Antigravity IDE, Zed, or Sublime Text.

## Concepts

| Term | Meaning |
|------|---------|
| **Project** | A local folder mapped to a remote path on a server. Self-contained: it owns its connection and settings. |
| **Connection** | The server credentials (protocol, host, port, user, auth, remote path) belonging to a project. |
| **Mapping** | The local root ↔ remote root pair. Every operation derives the counterpart path from the relative path. |
| **Control server** | A loopback HTTP server (token-guarded) the `kira-ftp` CLI talks to. |

---

## Getting started

> Requires macOS 14+ (Apple Silicon), [Bun](https://bun.sh), and `rclone`
> on your `PATH` for folder transfers/sync.

```bash
git clone https://github.com/andremacola/kira-ftp.git
cd kira-ftp
bun install
bun run dev          # builds the React view and launches the app
```

Then create your first project:

1. Click **+** next to *Projects* in the sidebar.
2. Pick the **local folder**, give it a name, and fill in the **connection**
   (protocol, host, user, auth, remote path). Use **Test connection** to verify.
3. **Create** — the project opens with the local/remote panes mapped.

For SFTP, leave the key field blank to use your existing `~/.ssh` keys
(`id_ed25519`, `id_ecdsa`, `id_rsa`), just like Sublime SFTP.

---

## Using the app

### Projects

Projects live in the sidebar. Right-click a project for **Open**, **Settings**,
or **Delete** (deleting a project removes its saved connection but never touches
files). The top bar shows the active project and `user@host`.

### Browsing & file operations

The two panes are **mapped**: entering `tardis/scripts` on the local side moves
the remote side to the same subfolder, and you can't navigate above the project
root. Right-click any item for context actions:

- **Upload / Download** (acts on the whole selection)
- **Sync folder** → / ← (folders)
- **Edit** / **Diff** (files)
- **Rename**, **Permissions** (chmod, remote), **Delete**

Select multiple items with **⌘-click** (toggle) or **⇧-click** (range), and
**drag** them onto the other pane (or onto a folder in it) to transfer.

### Transfers

The bottom dock shows a live queue: progress bar, bytes, speed, and a cancel
button per job. Finished/failed jobs are recorded in history. Single files go
through the low-latency connection pool; folders go through rclone.

### Sync

From a folder's right-click menu (or the command palette): **Sync up**
(local → remote) and **Sync down** (remote → local) show a **preview** of
exactly what will transfer/delete before you confirm. **Sync both** runs
rclone `bisync` with a newest-wins baseline. Per-project options: *skip
deletes*, *same age*, and ignore rules are applied as filters.

### Upload on save (watch)

Toggle the **eye** icon in the top bar. While watching, saving a file in the
project's local folder auto-uploads it to the mapped remote path. Uploads are
de-duplicated by content hash, so editor/cloud-drive metadata touches don't
cause repeated uploads.

### VCS — upload changed files

The **branch** icon uploads only the files reported as changed by your VCS
(git/hg/svn), relative to the project root.

### Remote editing & diff

Double-click a remote file (or *Edit*) to open it in an embedded **CodeMirror**
editor with syntax highlighting; **⌘S** saves it back. **Diff** opens a
side-by-side comparison of a file against its counterpart on the other side
(paths truncate to keep the filename visible; the full path is on hover).

### Importing a Sublime `sftp-config.json`

In the **New project** dialog, click **Import sftp-config.json** and pick the
file (or the folder containing it). Comments and trailing commas are tolerated.
It creates the project, connection, default environment, and ignore rules.

### Menu bar & Dock

Kira FTP shows a **menu bar (tray)** icon that animates while a transfer or
remote operation is in flight, and posts a **native notification** when a
transfer finishes (sound is optional — see settings). You can **hide the Dock
icon** to run from the menu bar only.

---

## CLI & editor integration

`kira-ftp` is a tiny CLI that drives the running app: it figures out which
project owns a path and performs the action, launching the app if needed.

**Install it** from **Settings (gear) → Command-line tool → Install CLI…** and
pick a folder on your `PATH` (e.g. `~/.local/bin`). This writes a ~1 KB shell
script — no build, no sudo.

```bash
kira-ftp upload     <path>      # alias: up
kira-ftp download   <path>      # alias: down
kira-ftp sync-up    <path>      # alias: push   (local → remote)
kira-ftp sync-down  <path>      # alias: pull   (remote → local)
kira-ftp sync       <path>      #               (bidirectional)
```

**Wire it into your editor** from the same settings screen: **Editor
integration** detects installed editors and installs shortcuts that call the
CLI by absolute path (so it works even from apps launched via the Dock).

Supported editors: **VS Code · Cursor · Antigravity IDE · Zed · Sublime Text**.
Default shortcuts: ⌘⌥U upload · ⌘⌥D download · ⌘⌥↑ sync-up · ⌘⌥↓ sync-down ·
⌘⌥S sync. Ready-made config files also live in
[`editor-integration/`](./editor-integration/).

> The installer backs up any existing editor config (`<file>.kira.bak`) before
> writing, and never duplicates bindings.

---

## Global settings

Open with the **gear** in the top bar (project settings are reached by
right-clicking a project, or `⌘K → Project settings`):

- **Show icon in the Dock** — turn off for menu-bar-only.
- **Play sound on notifications.**
- **CLI control server** — status (active/stopped/failed + port), a configurable
  **port**, and **View logs**.
- **Command-line tool** — install/reinstall the `kira-ftp` CLI.
- **Editor integration** — install shortcuts per editor.

---

## Architecture

```
src/
├── bun/                 Electrobun main process
│   ├── index.ts         typed RPC, window, menu, event bridge, control server wiring
│   └── menubar.ts       tray icon, activity animation, notifications, dock toggle
├── shared/              types shared by main & renderer (domain.ts, rpc.ts)
├── cli/kira-ftp.ts      standalone CLI (also shipped as a shell-script installer)
├── core/                framework-agnostic business logic (no Electrobun imports)
│   ├── db/              SQLite (bun:sqlite) schema, migrator, repositories
│   ├── connections/     transport abstraction + ssh2 (SFTP) + basic-ftp (FTP/FTPS) + pool
│   ├── rclone/          rclone rcd daemon client (JSON-RPC) for bulk transfer/sync
│   ├── control/         loopback control server for the CLI
│   ├── services/        connection / file / transfer / sync / watcher / vcs /
│   │                    path-resolver / editor-integration / config-importer
│   ├── fs/ · util/      local fs helpers, ignore matching, JSONC parser
│   ├── events.ts        typed event bus (core → RPC → webview messages)
│   └── app-context.ts   service container wiring everything together
└── mainview/            React renderer (Vite → dist → views/mainview)
    ├── components/       panes, dialogs, transfer dock, command palette, editor
    ├── components/ui/    shadcn-style primitives (Radix + Tailwind v4)
    ├── store.ts          Zustand data store (mapped panes, transfers, logs)
    └── ui-store.ts       Zustand modal/dialog state
```

**Why this shape:** the `core` layer is the only place that touches the network
and never imports Electrobun, so the business logic stays portable (an escape
hatch to Tauri/Electron) and testable. The Electrobun layer is a thin shell:
window, native menu/tray, typed RPC, and process lifecycle.

The two transport backends sit behind one `Transport` interface and a
ref-counted connection pool (SFTP multiplexes; FTP is serialized). Bulk
folder transfers and sync are delegated to a long-lived `rclone rcd` daemon
driven over its JSON-RPC API, with connection strings passed on the fly so no
secrets are written to `rclone.conf`.

---

## Development

```bash
bun install
bun run dev          # vite build + electrobun dev (launch the app)
bun run dev:vite     # just the Vite dev server (HMR for the renderer)
bun run typecheck    # tsc --noEmit
bun run build:cli    # standalone CLI binary -> dist-cli/kira-ftp (alt. to the shell installer)
```

App data (SQLite DB, control token/port) lives in
`~/Library/Application Support/kira-ftp/`.

**Stack docs:** see [`CLAUDE.md`](./CLAUDE.md) for the curated list of official
documentation references used while building this.

---

## Building & packaging

```bash
bun run build           # dev build (.app in build/)
bun run build:stable    # signed + notarized build
```

Code signing / notarization (macOS) reads these env vars:

```bash
export ELECTROBUN_DEVELOPER_ID="My Corp Inc. (TEAMID)"
export ELECTROBUN_TEAMID="…"
export ELECTROBUN_APPLEID="you@example.com"
export ELECTROBUN_APPLEIDPASS="app-specific-password"
```

Bundle a `rclone` (arm64) binary alongside the app's Bun executable for
distribution, or point `KIRA_RCLONE_PATH` at one; dev uses the `rclone` on
`PATH`.

---

## Status & roadmap

**v0.1.0** — macOS (Apple Silicon) first. Verified end-to-end against live SFTP
and FTP servers.

Planned:

- **Secrets in the macOS Keychain** (passwords currently live in SQLite).
- **SSH `known_hosts` verification** (currently trust-on-first-use).
- `rclone` bundled into the signed `.app` + auto-update.
- Dynamic Dock badge during transfers.

---

<div align="center">
<sub>Built with Electrobun + Bun. Not affiliated with Sublime HQ.</sub>
</div>
