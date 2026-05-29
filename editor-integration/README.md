# Kira FTP — editor integration

Trigger Kira FTP upload/download/sync from your editor with a keymap. Each
command runs the `kira-ftp` CLI on the current file/dir; Kira FTP resolves which
project owns that path and performs the action (launching the app if needed).

## 1. Install the CLI

Easiest: open **Kira FTP → Settings (gear) → Command-line tool** and click
**Install CLI…**, then pick a folder on your PATH (e.g. `~/.local/bin`). This
writes a tiny `kira-ftp` shell script (no build needed) and the
editor-integration buttons in the same screen wire it up by absolute path.

Manual alternative (standalone binary):

```bash
bun run build:cli          # produces dist-cli/kira-ftp (~63MB, bundles Bun)
cp dist-cli/kira-ftp ~/.local/bin/kira-ftp
```

If Kira FTP is not in `/Applications`, set `KIRA_APP_PATH` to the `.app` so the
CLI can auto-launch it.

## 2. Commands

```
kira-ftp upload     <path>      # alias: up
kira-ftp download   <path>      # alias: down
kira-ftp sync-up    <path>      # alias: push   (local → remote)
kira-ftp sync-down  <path>      # alias: pull   (remote → local)
kira-ftp sync       <path>      #               (bidirectional)
```

`<path>` can be a file or a folder. For a file, sync acts on its parent dir.

## 3. Per-editor setup

- **VS Code** — see `vscode/`: copy the tasks into your project's
  `.vscode/tasks.json` and the keybindings into your global `keybindings.json`.
- **Zed** — see `zed/`: copy the tasks into `.zed/tasks.json` and the bindings
  into `~/.config/zed/keymap.json`.
- **Sublime Text** — see `sublime/`: drop `kira_ftp.py` into
  `Packages/User/` and merge `Default.sublime-keymap`.

Default suggested shortcuts (change as you like):

| Action     | Shortcut          |
|------------|-------------------|
| Upload     | ⌘⌥U / ctrl+alt+u  |
| Download   | ⌘⌥D / ctrl+alt+d  |
| Sync up    | ⌘⌥↑               |
| Sync down  | ⌘⌥↓               |
| Sync both  | ⌘⌥S               |
