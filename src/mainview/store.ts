/**
 * Central UI state (Zustand). Mirrors backend data and the two file panes,
 * and subscribes to main-process messages for live transfer/log updates.
 */
import { create } from "zustand";
import { api, onMessage } from "./lib/rpc";
import type {
  Connection,
  Environment,
  FileEntry,
  LogLine,
  Project,
  TransferJob,
} from "@shared/domain";

export type Pane = "local" | "remote";

interface PaneState {
  path: string;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  selected: Set<string>;
}

const emptyPane = (): PaneState => ({
  path: "",
  entries: [],
  loading: false,
  error: null,
  selected: new Set(),
});

interface AppState {
  connections: Connection[];
  projects: Project[];
  environments: Environment[];

  activeProject: Project | null;
  activeConnectionId: number | null;
  activeEnvironmentId: number | null;
  remoteRoot: string;

  local: PaneState;
  remote: PaneState;

  transfers: TransferJob[];
  logs: LogLine[];

  /* bootstrap */
  init: () => Promise<void>;
  refreshConnections: () => Promise<void>;
  refreshProjects: () => Promise<void>;

  /* project activation */
  openProject: (project: Project) => Promise<void>;
  openConnectionOnly: (connection: Connection, localStart?: string) => Promise<void>;
  switchEnvironment: (envId: number) => Promise<void>;

  /* navigation */
  navigate: (pane: Pane, path: string) => Promise<void>;
  refreshPane: (pane: Pane) => Promise<void>;
  setSelected: (pane: Pane, selected: Set<string>) => void;

  /* transfers */
  cancelTransfer: (jobId: string) => Promise<void>;
  clearFinished: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  connections: [],
  projects: [],
  environments: [],
  activeProject: null,
  activeConnectionId: null,
  activeEnvironmentId: null,
  remoteRoot: "",
  local: emptyPane(),
  remote: emptyPane(),
  transfers: [],
  logs: [],

  init: async () => {
    onMessage("transferUpdate", (job) => {
      set((s) => {
        const idx = s.transfers.findIndex((t) => t.id === job.id);
        const transfers =
          idx === -1
            ? [job, ...s.transfers]
            : s.transfers.map((t) => (t.id === job.id ? job : t));
        return { transfers };
      });
    });
    const pushLog = (level: LogLine["level"], message: string) =>
      set((s) => ({
        logs: [...s.logs.slice(-499), { level, message, at: new Date().toISOString() }],
      }));

    onMessage("transferDone", (job) => {
      if (job.status !== "done") return;
      const st = get();
      const down = ["download", "download-folder", "sync-down", "sync-both"];
      const up = ["upload", "upload-folder", "sync-up", "sync-both"];
      if (down.includes(job.kind)) void st.refreshPane("local");
      if (st.activeConnectionId && up.includes(job.kind)) void st.refreshPane("remote");
    });
    onMessage("transferError", (e) => pushLog("error", `Transfer failed: ${e.error}`));
    onMessage("watchEvent", (e) => {
      if (e.action === "upload") pushLog("info", `Watch: uploading ${e.path}`);
    });
    onMessage("log", (line: LogLine) => {
      set((s) => ({ logs: [...s.logs.slice(-499), line] }));
    });

    await Promise.all([get().refreshConnections(), get().refreshProjects()]);
    const transfers = await api.listTransfers({});
    const home = await api.homeDir({});
    set({ transfers });
    await get().navigate("local", home);
  },

  refreshConnections: async () => {
    set({ connections: await api.listConnections({}) });
  },
  refreshProjects: async () => {
    set({ projects: await api.listProjects({}) });
  },

  openProject: async (project) => {
    const environments = await api.listEnvironments({ projectId: project.id });
    const env =
      environments.find((e) => e.id === project.defaultEnvironmentId) ??
      environments.find((e) => e.isDefault) ??
      environments[0];
    if (!env) {
      set({ activeProject: project, environments, activeEnvironmentId: null });
      await get().navigate("local", project.localPath);
      return;
    }
    set({
      activeProject: project,
      environments,
      activeConnectionId: env.connectionId,
      activeEnvironmentId: env.id,
      remoteRoot: env.remotePath,
    });
    await Promise.all([
      get().navigate("local", project.localPath),
      get().navigate("remote", env.remotePath || "."),
    ]);
  },

  switchEnvironment: async (envId) => {
    const env = get().environments.find((e) => e.id === envId);
    if (!env) return;
    set({
      activeEnvironmentId: env.id,
      activeConnectionId: env.connectionId,
      remoteRoot: env.remotePath,
    });
    await get().navigate("remote", env.remotePath || ".");
  },

  openConnectionOnly: async (connection, localStart) => {
    set({
      activeProject: null,
      activeConnectionId: connection.id,
      activeEnvironmentId: null,
      remoteRoot: connection.remotePath,
    });
    const home = localStart ?? (await api.homeDir({}));
    await Promise.all([
      get().navigate("local", home),
      get().navigate("remote", connection.remotePath || "."),
    ]);
  },

  navigate: async (pane, path) => {
    set((s) => ({ [pane]: { ...s[pane], loading: true, error: null } }) as Partial<AppState>);
    try {
      const entries =
        pane === "local"
          ? await api.listLocal({ dir: path })
          : await api.listRemote({ connectionId: get().activeConnectionId!, dir: path });
      entries.sort((a, b) => {
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        return a.name.localeCompare(b.name);
      });
      set(
        (s) =>
          ({
            [pane]: { path, entries, loading: false, error: null, selected: new Set() },
          }) as Partial<AppState>,
      );
    } catch (err) {
      set(
        (s) =>
          ({
            [pane]: {
              ...s[pane],
              loading: false,
              error: (err as Error).message,
            },
          }) as Partial<AppState>,
      );
    }
  },

  refreshPane: async (pane) => {
    await get().navigate(pane, get()[pane].path);
  },

  setSelected: (pane, selected) => {
    set((s) => ({ [pane]: { ...s[pane], selected } }) as Partial<AppState>);
  },

  cancelTransfer: async (jobId) => {
    await api.cancelTransfer({ jobId });
  },
  clearFinished: async () => {
    await api.clearFinishedTransfers({});
    set((s) => ({
      transfers: s.transfers.filter(
        (t) => t.status === "running" || t.status === "queued",
      ),
    }));
  },
}));
