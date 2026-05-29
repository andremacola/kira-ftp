/**
 * Electrobun main process. Boots the service core (AppContext), exposes it via
 * typed RPC, bridges core events to webview messages, and opens the window.
 * All ssh2/ftp/rclone work happens here; the React view is pure UI.
 */
import { BrowserWindow, BrowserView, ApplicationMenu, Screen, Utils } from "electrobun/bun";
import { homedir } from "node:os";
import { join, basename, dirname } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { AppContext } from "../core/app-context";
import { RMATE_EDITORS } from "../core/services/rmate-service";
import { ControlServer } from "../core/control/server";
import { MenubarManager } from "./menubar";
import { joinRemote } from "../core/connections/transport";
import { rulesToRcloneFilters } from "../core/util/ignore";
import { parseSublimeConfig } from "../core/services/config-importer";
import type { Connection } from "../shared/domain";
import type { KiraRPC } from "../shared/rpc";

const ctx = new AppContext();

// Local control server for the external `kira` CLI (editor integrations).
const control = new ControlServer(ctx);
control.start();

// Resume the rmate server if the user left it enabled.
ctx.startRmateIfEnabled();

function getConn(id: number): Connection {
  const conn = ctx.connections.get(id);
  if (!conn) throw new Error(`Connection ${id} not found`);
  return conn;
}

function projectFilters(projectId?: number): string[] {
  if (projectId === undefined) return [];
  return rulesToRcloneFilters(ctx.ignoreRules.listForProject(projectId));
}

const rpc = BrowserView.defineRPC<KiraRPC>({
  maxRequestTime: 600000, // network ops can be slow; default 1s is far too low
  handlers: {
    requests: {
      /* connections */
      listConnections: () => ctx.connectionService.list(),
      getConnection: ({ id }) => ctx.connectionService.get(id),
      createConnection: ({ input }) => ctx.connectionService.create(input),
      updateConnection: ({ id, input }) => ctx.connectionService.update(id, input),
      deleteConnection: ({ id }) => ctx.connectionService.delete(id),
      testConnection: ({ input }) => ctx.connectionService.test(input),

      /* projects */
      listProjects: () => ctx.projects.list(),
      getProject: ({ id }) => ctx.projects.get(id),
      createProject: ({ input }) => ctx.projects.create(input),
      updateProject: ({ id, input }) => ctx.projects.update(id, input),
      deleteProject: ({ id }) => ctx.deleteProjectFull(id),
      createFullProject: ({ name, localPath, remotePath, connection }) =>
        ctx.createFullProject({ name, localPath, remotePath, connection }),

      /* environments */
      listEnvironments: ({ projectId }) => ctx.environments.listForProject(projectId),
      createEnvironment: ({ input }) => ctx.environments.create(input),
      updateEnvironment: ({ id, input }) => ctx.environments.update(id, input),
      deleteEnvironment: ({ id }) => ctx.environments.delete(id),
      addEnvironment: ({ projectId, name, isDefault, remotePath, connection }) =>
        ctx.addEnvironment({ projectId, name, isDefault, remotePath, connection }),
      updateEnvironmentFull: ({ environmentId, name, isDefault, remotePath, connection }) =>
        ctx.updateEnvironmentFull({ environmentId, name, isDefault, remotePath, connection }),
      deleteEnvironmentFull: ({ id }) => ctx.deleteEnvironmentFull(id),

      /* ignore rules */
      listIgnoreRules: ({ projectId }) => ctx.ignoreRules.listForProject(projectId),
      createIgnoreRule: ({ projectId, pattern }) =>
        ctx.ignoreRules.create(projectId, pattern),
      deleteIgnoreRule: ({ id }) => ctx.ignoreRules.delete(id),

      /* local filesystem */
      listLocal: ({ dir }) => ctx.fileService.listLocal(dir),
      statLocal: ({ path }) => ctx.fileService.statLocal(path),
      mkdirLocal: ({ path }) => ctx.fileService.mkdirLocal(path),
      renameLocal: ({ from, to }) => ctx.fileService.renameLocal(from, to),
      deleteLocal: ({ path }) => ctx.fileService.deleteLocal(path),
      homeDir: () => homedir(),

      /* remote filesystem */
      listRemote: ({ connectionId, dir }) =>
        ctx.fileService.listRemote(getConn(connectionId), dir),
      statRemote: ({ connectionId, path }) =>
        ctx.fileService.statRemote(getConn(connectionId), path),
      mkdirRemote: ({ connectionId, path }) =>
        ctx.fileService.mkdirRemote(getConn(connectionId), path),
      renameRemote: ({ connectionId, from, to }) =>
        ctx.fileService.renameRemote(getConn(connectionId), from, to),
      deleteRemote: ({ connectionId, path }) =>
        ctx.fileService.deleteRemote(getConn(connectionId), path),
      chmodRemote: ({ connectionId, path, mode }) =>
        ctx.fileService.chmodRemote(getConn(connectionId), path, mode),
      newRemoteFile: ({ connectionId, path }) =>
        ctx.fileService.newRemoteFile(getConn(connectionId), path),

      /* transfers */
      uploadFile: ({ connectionId, localPath, remotePath }) =>
        ctx.transfers.enqueueUpload(getConn(connectionId), localPath, remotePath),
      downloadFile: ({ connectionId, remotePath, localPath }) =>
        ctx.transfers.enqueueDownload(getConn(connectionId), remotePath, localPath),
      uploadFolder: ({ connectionId, localDir, remoteDir, projectId }) =>
        ctx.transfers.enqueueUploadFolder(
          getConn(connectionId),
          localDir,
          remoteDir,
          projectFilters(projectId),
        ),
      downloadFolder: ({ connectionId, remoteDir, localDir, projectId }) =>
        ctx.transfers.enqueueDownloadFolder(
          getConn(connectionId),
          remoteDir,
          localDir,
          projectFilters(projectId),
        ),
      listTransfers: () => ctx.transfers.list(),
      cancelTransfer: ({ jobId }) => ctx.transfers.cancel(jobId),
      clearFinishedTransfers: () => ctx.transfers.clearFinished(),

      /* sync */
      previewSync: ({ connectionId, projectId, localDir, remoteDir, direction }) => {
        const project = ctx.projects.get(projectId);
        return ctx.sync.preview(getConn(connectionId), localDir, remoteDir, direction, {
          skipDeletes: project?.syncSkipDeletes ?? false,
          sameAge: project?.syncSameAge ?? false,
          filters: projectFilters(projectId),
        });
      },
      runSync: ({ connectionId, projectId, localDir, remoteDir, direction }) => {
        const conn = getConn(connectionId);
        const project = ctx.projects.get(projectId);
        const opts = {
          skipDeletes: project?.syncSkipDeletes ?? false,
          sameAge: project?.syncSameAge ?? false,
          filters: projectFilters(projectId),
        };
        const label = `Sync ${direction} ${basename(localDir)}`;
        if (direction === "both") {
          return ctx.transfers.enqueueSync(
            conn,
            "both",
            label,
            () => ctx.sync.runBoth(conn, localDir, remoteDir, opts),
            projectId,
          );
        }
        return ctx.transfers.enqueueSync(
          conn,
          direction,
          label,
          () => ctx.sync.runOneWay(conn, localDir, remoteDir, direction, opts),
          projectId,
        );
      },

      /* remote edit / diff */
      readRemoteText: ({ connectionId, remotePath }) =>
        ctx.fileService.readRemoteText(getConn(connectionId), remotePath),
      saveRemoteText: ({ connectionId, remotePath, text }) =>
        ctx.fileService.saveRemoteText(getConn(connectionId), remotePath, text),
      readLocalText: ({ path }) => ctx.fileService.readLocalText(path),

      /* vcs */
      vcsDetect: ({ dir }) => ctx.vcs.detect(dir),
      vcsChanged: ({ dir }) => ctx.vcs.changedFiles(dir),
      vcsUploadChanged: async ({ connectionId, localDir, remoteDir }) => {
        const conn = getConn(connectionId);
        const changed = await ctx.vcs.changedFiles(localDir);
        return changed.map((rel) =>
          ctx.transfers.enqueueUpload(
            conn,
            join(localDir, rel),
            joinRemote(remoteDir, rel.split(/[\\/]/).join("/")),
          ),
        );
      },

      /* watch */
      startWatch: ({ projectId }) => {
        const project = ctx.projects.get(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);
        const resolved = ctx.resolveEnvironment(project);
        if (!resolved) throw new Error("Project has no environment/connection");
        ctx.watcher.start(
          project,
          resolved.conn,
          resolved.env.remotePath || resolved.conn.remotePath,
          ctx.ignoreRegexesFor(projectId),
        );
      },
      stopWatch: ({ projectId }) => ctx.watcher.stop(projectId),
      watchStatus: ({ projectId }) => ctx.watcher.isWatching(projectId),

      /* config import + history + dialogs */
      importSublimeConfig: ({ localPath }) => {
        // Accept either the project folder or the sftp-config.json file itself.
        let dir = localPath;
        let file = join(localPath, "sftp-config.json");
        try {
          if (statSync(localPath).isFile()) {
            file = localPath;
            dir = dirname(localPath);
          }
        } catch {
          // leave defaults; readFileSync will throw a clear error if missing
        }
        const text = readFileSync(file, "utf-8");
        const result = parseSublimeConfig(text, dir);
        // self-contained project (its own owned connection + default env)
        const project = ctx.createFullProject({
          name: result.project.name,
          localPath: dir,
          remotePath: result.remotePath,
          connection: result.connection,
          seedIgnores: false,
        });
        // apply the imported project settings and ignore patterns
        ctx.projects.update(project.id, {
          ...result.project,
          defaultEnvironmentId: project.defaultEnvironmentId,
        });
        for (const pattern of result.ignorePatterns) {
          ctx.ignoreRules.create(project.id, pattern);
        }
        return ctx.projects.get(project.id)!;
      },
      recentHistory: () => ctx.history.recent(),
      getShowInMenuBar: () => showInMenuBar(),
      setShowInMenuBar: ({ on }) => {
        ctx.settings.setBool("showInMenuBar", on);
        // Apply immediately: add/remove the tray, and make sure a Dock-only app
        // keeps its Dock icon.
        menubar.setVisible(on);
        if (!on) setDock(true);
      },
      getNotifySound: () => menubar.isNotifySound(),
      setNotifySound: ({ on }) => menubar.setNotifySound(on),
      getControlPort: () => control.port(),
      getControlStatus: () => control.status(),
      editorStatus: () => ctx.editors.status(),
      installEditorIntegration: ({ id }) =>
        ctx.editors.install(id as Parameters<typeof ctx.editors.install>[0]),
      cliStatus: () => ctx.editors.cliStatus(),
      cliTargets: () => ctx.editors.cliTargets(),
      installCli: async ({ target }) => {
        const r = await ctx.editors.installCli(
          target as Parameters<typeof ctx.editors.installCli>[0],
        );
        const cancelled = !r.ok && /cancel/i.test(r.message);
        return { ok: r.ok, cancelled, message: r.message };
      },
      rmateStatus: () => ctx.rmate.status(),
      rmateEditors: () => {
        const detected = ctx.rmate.detectedEditors();
        return RMATE_EDITORS.map((e) => ({ ...e, detected: detected[e.id] }));
      },
      rmateSetEnabled: ({ on }) => ctx.rmate.setEnabled(on),
      rmateSetEditor: ({ editor }) =>
        ctx.rmate.setEditor(editor as Parameters<typeof ctx.rmate.setEditor>[0]),
      setControlPort: ({ port }) => {
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          return { ok: false, error: "Port must be between 1024 and 65535" };
        }
        try {
          control.setPort(port);
          // start() doesn't throw on a busy port; reflect the real bind result.
          const s = control.status();
          return s.state === "active"
            ? { ok: true }
            : { ok: false, error: s.error ?? `Could not bind port ${port}` };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
      pickDirectory: () => pickPath({ directory: true }),
      pickFile: () => pickPath({ file: true }),
      // import accepts the .json file OR the folder that contains it
      pickSftpConfig: () => pickPath({ file: true, directory: true }),
    },
    messages: {},
  },
});

/** Open a native file/folder picker; returns the first selection or null. */
async function pickPath(opts: {
  file?: boolean;
  directory?: boolean;
  types?: string[];
}): Promise<string | null> {
  try {
    const mod = (await import("electrobun/bun")) as unknown as {
      Utils?: {
        openFileDialog?: (o: {
          canChooseFiles: boolean;
          canChooseDirectory: boolean;
          allowsMultipleSelection: boolean;
          allowedFileTypes?: string[];
        }) => Promise<string[]>;
      };
    };
    // Only set allowedFileTypes when we actually have a filter — passing
    // `undefined` makes the native dialog call fail (and silently not open).
    const dialogOpts: {
      canChooseFiles: boolean;
      canChooseDirectory: boolean;
      allowsMultipleSelection: boolean;
      allowedFileTypes?: string[];
    } = {
      canChooseFiles: !!opts.file,
      canChooseDirectory: !!opts.directory,
      allowsMultipleSelection: false,
    };
    if (opts.types && opts.types.length > 0) dialogOpts.allowedFileTypes = opts.types;

    const picked = await mod.Utils?.openFileDialog?.(dialogOpts);
    return picked && picked.length > 0 ? picked[0]! : null;
  } catch (err) {
    console.error("openFileDialog failed:", err);
    return null;
  }
}

async function getMainViewUrl(): Promise<string> {
  const devUrl = "http://localhost:5173";
  try {
    await fetch(devUrl, { method: "HEAD", signal: AbortSignal.timeout(300) });
    return devUrl;
  } catch {
    return "views://mainview/index.html";
  }
}

const url = await getMainViewUrl();

const WIN_W = 1280;
const WIN_H = 820;
type Frame = { x: number; y: number; width: number; height: number };

/** Centered frame on the primary display's work area (excludes dock/menubar). */
function centeredFrame(): Frame {
  try {
    const primary = Screen.getPrimaryDisplay() as {
      workArea?: Frame;
      bounds?: Frame;
    };
    const area = primary.workArea ?? primary.bounds;
    if (area) {
      return {
        width: WIN_W,
        height: WIN_H,
        x: Math.round((area.width - WIN_W) / 2) + area.x,
        y: Math.round((area.height - WIN_H) / 2) + area.y,
      };
    }
  } catch {
    /* Screen unavailable -> fall back */
  }
  return { width: WIN_W, height: WIN_H, x: 120, y: 80 };
}

/** Restore the last saved window frame, else center on screen. */
function initialFrame(): Frame {
  const saved = ctx.settings.get("windowFrame");
  if (saved) {
    try {
      const f = JSON.parse(saved) as Frame;
      if ([f.x, f.y, f.width, f.height].every((n) => typeof n === "number")) return f;
    } catch {
      /* fall through to centered */
    }
  }
  return centeredFrame();
}

/**
 * Native traffic lights (titleBarStyle "hiddenInset"). The red button is the
 * real macOS close — it destroys the window and can't be intercepted — so the
 * window is recreated by "Open Kira FTP" when needed. "Show in menu bar"
 * (default on) decides what closing means:
 *   on  -> app stays in the menu bar (Dock icon hidden, Accessory mode)
 *   off -> a normal Dock app; closing the last window quits
 * The Dock icon follows window visibility (OrbStack-style): a live window is
 * Regular (so minimize goes to the app icon), and once closed in menu-bar mode
 * the app drops to Accessory. exitOnLastWindowClosed is off so the native close
 * never quits us behind our back.
 */
let win: BrowserWindow | null = null;

/** True = live in the menu bar; false = behave as a normal Dock-only app. */
function showInMenuBar(): boolean {
  return ctx.settings.getBool("showInMenuBar", true);
}

function setDock(visible: boolean): void {
  try {
    Utils.setDockIconVisible(visible);
  } catch {
    /* not supported */
  }
}

function createMainWindow(): void {
  win = new BrowserWindow({
    title: "Kira FTP",
    url,
    frame: initialFrame(),
    // hiddenInset: native traffic lights over a full-size content view (the top
    // bar draws under them and is left-padded to clear the buttons).
    titleBarStyle: "hiddenInset",
    rpc,
  });
  setDock(true); // window visible -> Regular (Dock icon, native minimize)

  const channel = win.webview.rpc as typeof rpc | undefined;
  if (channel) {
    ctx.bus.on("transfer:update", (job) => channel.send.transferUpdate(job));
    ctx.bus.on("transfer:done", (job) => channel.send.transferDone(job));
    ctx.bus.on("transfer:error", (e) => channel.send.transferError(e));
    ctx.bus.on("connection:state", (s) => channel.send.connectionState(s));
    ctx.bus.on("watch:event", (e) => channel.send.watchEvent(e));
    ctx.bus.on("log", (l) => channel.send.log(l));
  }

  // Persist the frame as the user moves/resizes so we restore it next time.
  const remember = () => {
    const f = win?.getFrame?.();
    if (f) ctx.settings.set("windowFrame", JSON.stringify(f));
  };
  win.on("move", remember);
  win.on("resize", remember);

  // Native close fires this (per-window, before the global handler). The window
  // is gone; either quit or drop to the menu bar.
  win.on("close", () => {
    win = null;
    if (!showInMenuBar()) {
      void gracefulShutdown().finally(() => process.exit(0));
      return;
    }
    setDock(false); // no window -> Accessory (menu-bar only)
  });
}

/** Show (and focus) the window, recreating it if it was closed. */
function showWindow(): void {
  if (!win) {
    createMainWindow();
  } else {
    win.show();
  }
  win?.activate();
  setDock(true);
}

// Menubar presence: tray icon that pulses during transfers, notifies on
// completion, and toggles remote editing.
const menubar = new MenubarManager(
  ctx,
  () => showWindow(), // "Open Kira FTP" — show (and restore) the window
  // Quit from the tray: close pooled connections / rclone gracefully first.
  () => void gracefulShutdown().finally(() => process.exit(0)),
);
menubar.init();
if (showInMenuBar()) menubar.setVisible(true);
showWindow();

// Graceful shutdown: signals can await async cleanup; the bare exit handler
// can only run sync work, so it just kills the rclone daemon to avoid orphans.
let shuttingDown = false;
async function gracefulShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await ctx.shutdown();
}
process.on("SIGINT", () => void gracefulShutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void gracefulShutdown().finally(() => process.exit(0)));
process.on("exit", () => {
  control.stop();
  menubar.dispose();
  ctx.watcher.stopAll();
  ctx.rmate.killSync();
  ctx.rclone.killSync();
});

// A native menu is required for the standard edit shortcuts (⌘C/⌘V/⌘A/…) to
// reach the webview on macOS.
ApplicationMenu.setApplicationMenu([
  {
    label: "Kira FTP",
    submenu: [
      { role: "about" },
      { type: "divider" },
      { role: "hide", accelerator: "CommandOrControl+H" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "divider" },
      { role: "quit", accelerator: "CommandOrControl+Q" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo", accelerator: "CommandOrControl+Z" },
      { role: "redo", accelerator: "CommandOrControl+Shift+Z" },
      { type: "divider" },
      { role: "cut", accelerator: "CommandOrControl+X" },
      { role: "copy", accelerator: "CommandOrControl+C" },
      { role: "paste", accelerator: "CommandOrControl+V" },
      { role: "selectAll", accelerator: "CommandOrControl+A" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { role: "minimize", accelerator: "CommandOrControl+M" },
      { role: "zoom" },
      { role: "close", accelerator: "CommandOrControl+W" },
    ],
  },
]);

console.log("Kira FTP main process started");
