/**
 * Electrobun main process. Boots the service core (AppContext), exposes it via
 * typed RPC, bridges core events to webview messages, and opens the window.
 * All ssh2/ftp/rclone work happens here; the React view is pure UI.
 */
import { BrowserWindow, BrowserView } from "electrobun/bun";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { readFileSync } from "node:fs";
import { AppContext } from "../core/app-context";
import { joinRemote } from "../core/connections/transport";
import { rulesToRcloneFilters } from "../core/util/ignore";
import { parseSublimeConfig } from "../core/services/config-importer";
import type { Connection } from "../shared/domain";
import type { KiraRPC } from "../shared/rpc";

const ctx = new AppContext();

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
      deleteProject: ({ id }) => {
        ctx.watcher.stop(id);
        ctx.projects.delete(id);
      },

      /* environments */
      listEnvironments: ({ projectId }) => ctx.environments.listForProject(projectId),
      createEnvironment: ({ input }) => ctx.environments.create(input),
      updateEnvironment: ({ id, input }) => ctx.environments.update(id, input),
      deleteEnvironment: ({ id }) => ctx.environments.delete(id),

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
        const text = readFileSync(join(localPath, "sftp-config.json"), "utf-8");
        const result = parseSublimeConfig(text, localPath);
        const conn = ctx.connections.create(result.connection);
        const project = ctx.projects.create({
          ...result.project,
          defaultEnvironmentId: null,
        });
        const env = ctx.environments.create({
          projectId: project.id,
          name: "default",
          connectionId: conn.id,
          remotePath: result.remotePath,
          isDefault: true,
        });
        const updated = ctx.projects.update(project.id, {
          ...result.project,
          defaultEnvironmentId: env.id,
        });
        for (const pattern of result.ignorePatterns) {
          ctx.ignoreRules.create(project.id, pattern);
        }
        return updated;
      },
      recentHistory: () => ctx.history.recent(),
      pickDirectory: () => pickPath(true),
      pickFile: () => pickPath(false),
    },
    messages: {},
  },
});

/** Open a native file/folder picker; returns the first selection or null. */
async function pickPath(directory: boolean): Promise<string | null> {
  try {
    const mod = (await import("electrobun/bun")) as unknown as {
      Utils?: {
        openFileDialog?: (opts: {
          canChooseFiles: boolean;
          canChooseDirectory: boolean;
          allowsMultipleSelection: boolean;
        }) => Promise<string[]>;
      };
    };
    const picked = await mod.Utils?.openFileDialog?.({
      canChooseFiles: !directory,
      canChooseDirectory: directory,
      allowsMultipleSelection: false,
    });
    return picked && picked.length > 0 ? picked[0]! : null;
  } catch {
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

const win = new BrowserWindow({
  title: "Kira FTP",
  url,
  frame: { width: 1280, height: 820, x: 120, y: 80 },
  rpc,
});

/* Bridge core events -> webview messages. */
const channel = win.webview.rpc;
if (channel) {
  ctx.bus.on("transfer:update", (job) => channel.send.transferUpdate(job));
  ctx.bus.on("transfer:done", (job) => channel.send.transferDone(job));
  ctx.bus.on("transfer:error", (e) => channel.send.transferError(e));
  ctx.bus.on("connection:state", (s) => channel.send.connectionState(s));
  ctx.bus.on("watch:event", (e) => channel.send.watchEvent(e));
  ctx.bus.on("log", (l) => channel.send.log(l));
}

process.on("exit", () => {
  void ctx.shutdown();
});

console.log("Kira FTP main process started");
