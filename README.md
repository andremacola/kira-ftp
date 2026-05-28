# Kira FTP

A standalone macOS SFTP/FTP/FTPS client that recreates the full feature set of
the Sublime Text SFTP plugin as a modern desktop app.

Built with **Electrobun + Bun + React 19 + shadcn-style UI**, a hybrid transfer
engine (**ssh2 / basic-ftp** for interactive ops, **rclone** for bulk
transfer/sync), and **SQLite** for persistence.

## Architecture

```
src/
├── bun/index.ts        Electrobun main process: typed RPC + window + event bridge
├── shared/             Types shared by main & renderer (domain.ts, rpc.ts)
├── core/               Framework-agnostic business logic (no Electrobun imports)
│   ├── db/             SQLite (bun:sqlite) schema, migrator, repositories
│   ├── connections/    Transport abstraction + ssh2 (SFTP) + basic-ftp (FTP/FTPS) + pool
│   ├── rclone/         rclone rcd daemon client (JSON-RPC) for bulk transfer/sync
│   ├── services/       connection / file / transfer / sync / watcher / vcs / import
│   ├── fs/             local filesystem helpers
│   ├── util/           ignore-pattern matching
│   ├── events.ts       typed event bus (core -> RPC -> webview messages)
│   └── app-context.ts  service container wiring everything together
└── mainview/           React renderer (Vite build -> dist -> views/mainview)
    ├── components/      panes, dialogs, transfer dock, command palette, editor
    ├── components/ui/   shadcn-style primitives (Radix + Tailwind v4)
    ├── store.ts         Zustand data store
    └── ui-store.ts      Zustand modal/dialog state
```

The **core** never imports Electrobun, so the business logic stays portable
(escape hatch to Tauri/Electron) and is the only layer that touches the network.

## Feature parity with Sublime SFTP

- SFTP (SSH key / password / agent), FTP, FTPS
- Connection profiles + projects (local↔remote mappings) + environments (alt configs)
- Dual-pane browser: navigate, mkdir, rename, delete, chmod, new file
- Single-file & recursive folder upload/download (folders via rclone)
- Sync up / down / both with a dry-run preview (rclone copy/sync/bisync)
- Upload-on-save via a filesystem watcher; VCS "upload changed files" (git/hg/svn)
- Remote editing with an embedded CodeMirror editor
- Ignore patterns (regex), file/dir permissions
- Import an existing Sublime `sftp-config.json`
- Command palette (⌘K), transfer queue with progress/cancel, persistent history

## Development

```bash
bun install
bun run build:view   # vite build -> dist/
bun run build        # electrobun build -> packaged app
bun run dev          # electrobun dev (run by you in a separate terminal)
bun run typecheck    # tsc --noEmit
```

`rclone` must be on PATH for dev (it is bundled for production builds via
`KIRA_RCLONE_PATH`). SQLite data lives in
`~/Library/Application Support/kira-ftp/kira.sqlite`.

## Packaging (production)

- `bun run build:stable` builds a signed/notarized app when these env vars are
  set: `ELECTROBUN_DEVELOPER_ID`, `ELECTROBUN_TEAMID`, `ELECTROBUN_APPLEID`,
  `ELECTROBUN_APPLEIDPASS` (or the App Store Connect API key variants).
- Bundle `rclone` for distribution: place an `rclone` arm64 binary next to the
  packaged Bun executable (the app resolves it via `import.meta.dir`), or point
  `KIRA_RCLONE_PATH` at it. Dev uses the `rclone` on `PATH`.

## Status & known follow-ups

macOS (Apple Silicon) first. Verified end-to-end against live SFTP (key auth)
and FTP servers. Follow-ups:

- **Secrets**: passwords currently live in SQLite; migrate to the macOS Keychain.
- **Sync Both**: uses rclone `bisync` with a newest-wins resync baseline (safe,
  no surprise deletions). True delete-propagating bisync state is not persisted.
- **UI**: multi-select and drag-and-drop between panes are not yet implemented
  (operations are per-item via context menu + command palette).
- **Host keys**: SFTP currently does not pin known_hosts (TOFU). Add
  known_hosts verification before shipping widely.
