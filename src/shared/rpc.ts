/**
 * Typed RPC contract shared by the Bun main process and the React webview.
 * Method names are flat camelCase identifiers (the RPC proxy resolves them by
 * property access). Bun handles `requests`; the webview receives `messages`.
 */
import type { RPCSchema } from "electrobun/bun";
import type {
  Connection,
  ConnectionFields,
  ConnectionInput,
  ConnectionState,
  ConnectionTestResult,
  Environment,
  EnvironmentInput,
  FileEntry,
  IgnoreRule,
  LogLine,
  Project,
  ProjectInput,
  SessionState,
  SyncPlan,
  TransferHistoryEntry,
  TransferJob,
} from "./domain";

export type SyncDirectionRPC = "up" | "down" | "both";

export type KiraRPC = {
  bun: RPCSchema<{
    requests: {
      /* connections */
      listConnections: { params: Record<string, never>; response: Connection[] };
      getConnection: { params: { id: number }; response: Connection | null };
      createConnection: { params: { input: ConnectionInput }; response: Connection };
      updateConnection: {
        params: { id: number; input: ConnectionInput };
        response: Connection;
      };
      deleteConnection: { params: { id: number }; response: void };
      testConnection: {
        params: { input: ConnectionFields };
        response: ConnectionTestResult;
      };

      /* projects */
      listProjects: { params: Record<string, never>; response: Project[] };
      getProject: { params: { id: number }; response: Project | null };
      createProject: { params: { input: ProjectInput }; response: Project };
      updateProject: { params: { id: number; input: ProjectInput }; response: Project };
      deleteProject: { params: { id: number }; response: void };
      /** Create a self-contained project: project + its own connection + default env. */
      createFullProject: {
        params: {
          name: string;
          localPath: string;
          remotePath: string;
          connection: ConnectionFields;
        };
        response: Project;
      };

      /* environments */
      listEnvironments: { params: { projectId: number }; response: Environment[] };
      createEnvironment: { params: { input: EnvironmentInput }; response: Environment };
      updateEnvironment: {
        params: { id: number; input: EnvironmentInput };
        response: Environment;
      };
      deleteEnvironment: { params: { id: number }; response: void };
      /** Add an environment that owns its own connection. */
      addEnvironment: {
        params: {
          projectId: number;
          name: string;
          isDefault: boolean;
          remotePath: string;
          connection: ConnectionFields;
        };
        response: Environment;
      };
      /** Update an environment and its owned connection together. */
      updateEnvironmentFull: {
        params: {
          environmentId: number;
          name: string;
          isDefault: boolean;
          remotePath: string;
          connection: ConnectionFields;
        };
        response: Environment;
      };
      /** Delete an environment and its owned connection. */
      deleteEnvironmentFull: { params: { id: number }; response: void };

      /* ignore rules */
      listIgnoreRules: { params: { projectId: number }; response: IgnoreRule[] };
      createIgnoreRule: {
        params: { projectId: number; pattern: string };
        response: IgnoreRule;
      };
      deleteIgnoreRule: { params: { id: number }; response: void };

      /* local filesystem */
      listLocal: { params: { dir: string }; response: FileEntry[] };
      statLocal: { params: { path: string }; response: FileEntry | null };
      mkdirLocal: { params: { path: string }; response: void };
      renameLocal: { params: { from: string; to: string }; response: void };
      deleteLocal: { params: { path: string }; response: void };
      homeDir: { params: Record<string, never>; response: string };

      /* remote filesystem (by connection id) */
      listRemote: { params: { connectionId: number; dir: string }; response: FileEntry[] };
      statRemote: {
        params: { connectionId: number; path: string };
        response: FileEntry | null;
      };
      mkdirRemote: { params: { connectionId: number; path: string }; response: void };
      renameRemote: {
        params: { connectionId: number; from: string; to: string };
        response: void;
      };
      deleteRemote: { params: { connectionId: number; path: string }; response: void };
      chmodRemote: {
        params: { connectionId: number; path: string; mode: number };
        response: void;
      };
      newRemoteFile: { params: { connectionId: number; path: string }; response: void };

      /* transfers */
      uploadFile: {
        params: { connectionId: number; localPath: string; remotePath: string };
        response: TransferJob;
      };
      downloadFile: {
        params: { connectionId: number; remotePath: string; localPath: string };
        response: TransferJob;
      };
      uploadFolder: {
        params: { connectionId: number; localDir: string; remoteDir: string; projectId?: number };
        response: TransferJob;
      };
      downloadFolder: {
        params: { connectionId: number; remoteDir: string; localDir: string; projectId?: number };
        response: TransferJob;
      };
      listTransfers: { params: Record<string, never>; response: TransferJob[] };
      cancelTransfer: { params: { jobId: string }; response: void };
      clearFinishedTransfers: { params: Record<string, never>; response: void };

      /* sync */
      previewSync: {
        params: {
          connectionId: number;
          projectId: number;
          localDir: string;
          remoteDir: string;
          direction: "up" | "down";
        };
        response: SyncPlan;
      };
      runSync: {
        params: {
          connectionId: number;
          projectId: number;
          localDir: string;
          remoteDir: string;
          direction: SyncDirectionRPC;
        };
        response: TransferJob;
      };

      /* remote edit / diff */
      readRemoteText: {
        params: { connectionId: number; remotePath: string };
        response: string;
      };
      saveRemoteText: {
        params: { connectionId: number; remotePath: string; text: string };
        response: void;
      };
      readLocalText: { params: { path: string }; response: string };

      /* vcs */
      vcsDetect: { params: { dir: string }; response: string | null };
      vcsChanged: { params: { dir: string }; response: string[] };
      vcsUploadChanged: {
        params: { connectionId: number; localDir: string; remoteDir: string };
        response: TransferJob[];
      };

      /* watch */
      startWatch: { params: { projectId: number }; response: void };
      stopWatch: { params: { projectId: number }; response: void };
      watchStatus: { params: { projectId: number }; response: boolean };

      /* config import + history + dialogs */
      importSublimeConfig: { params: { localPath: string }; response: Project };
      recentHistory: { params: Record<string, never>; response: TransferHistoryEntry[] };

      /* last-open session (restored when closed to the menu bar) */
      getSession: { params: Record<string, never>; response: SessionState | null };
      setSession: { params: { session: SessionState }; response: void };

      /* global app preferences */
      getShowInMenuBar: { params: Record<string, never>; response: boolean };
      setShowInMenuBar: { params: { on: boolean }; response: void };
      getNotifySound: { params: Record<string, never>; response: boolean };
      setNotifySound: { params: { on: boolean }; response: void };
      getControlPort: { params: Record<string, never>; response: number };
      setControlPort: {
        params: { port: number };
        response: { ok: boolean; error?: string };
      };
      getControlStatus: {
        params: Record<string, never>;
        response: {
          state: "active" | "stopped" | "failed";
          port: number;
          error: string | null;
        };
      };
      /* editor integration */
      editorStatus: {
        params: Record<string, never>;
        response: Array<{ id: string; name: string; detected: boolean; installed: boolean }>;
      };
      installEditorIntegration: {
        params: { id: string };
        response: { ok: boolean; alreadyInstalled: boolean; message: string };
      };
      /* kira CLI */
      cliStatus: {
        params: Record<string, never>;
        response: { installed: boolean; path: string | null };
      };
      cliTargets: {
        params: Record<string, never>;
        response: Array<{ id: string; dir: string; label: string; needsSudo: boolean }>;
      };
      installCli: {
        params: { target: string };
        response: { ok: boolean; cancelled?: boolean; message: string };
      };
      /* rmate server (remote editing) */
      rmateStatus: {
        params: Record<string, never>;
        response: {
          state: "running" | "stopped" | "failed";
          bind: string;
          editor: string;
          error: string | null;
        };
      };
      rmateEditors: {
        params: Record<string, never>;
        response: Array<{ id: string; name: string; detected: boolean }>;
      };
      rmateSetEnabled: {
        params: { on: boolean };
        response: { state: "running" | "stopped" | "failed"; bind: string; editor: string; error: string | null };
      };
      rmateSetEditor: {
        params: { editor: string };
        response: { state: "running" | "stopped" | "failed"; bind: string; editor: string; error: string | null };
      };
      pickDirectory: { params: Record<string, never>; response: string | null };
      pickFile: { params: Record<string, never>; response: string | null };
      pickSftpConfig: { params: Record<string, never>; response: string | null };
    };
    messages: Record<string, never>;
  }>;

  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      transferUpdate: TransferJob;
      transferDone: TransferJob;
      transferError: { jobId: string; error: string };
      connectionState: { connectionId: number; state: ConnectionState };
      watchEvent: { projectId: number; path: string; action: "upload" | "skip" };
      log: LogLine;
    };
  }>;
};
