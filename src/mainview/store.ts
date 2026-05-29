/**
 * Central UI state (Zustand). In a project the two panes are *mapped*: they
 * share a relative path from their roots (localRoot <-> remoteRoot), stay
 * locked to those roots, and mirror each other. In connection-only mode the
 * panes navigate freely. Subscribes to main-process messages for live updates.
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

/** Join a root and a relative subpath using POSIX separators. */
export function joinPath(root: string, rel: string): string {
  const base = root.replace(/\/+$/, "");
  if (!rel) return base === "" ? "/" : base;
  return `${base}/${rel}`.replace(/\/{2,}/g, "/");
}
const appendRel = (rel: string, name: string) => (rel ? `${rel}/${name}` : name);
const parentRel = (rel: string) =>
  rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
const parentOf = (p: string) => {
  const t = p.replace(/\/$/, "");
  const i = t.lastIndexOf("/");
  return i <= 0 ? (t.startsWith("/") ? "/" : t) : t.slice(0, i);
};

interface AppState {
  connections: Connection[];
  projects: Project[];
  environments: Environment[];

  activeProject: Project | null;
  activeConnectionId: number | null;
  activeConnection: Connection | null;
  activeEnvironmentId: number | null;

  /** Project mapping. mapped === true means panes are root-locked + mirrored. */
  mapped: boolean;
  localRoot: string;
  remoteRoot: string;
  relPath: string;

  local: PaneState;
  remote: PaneState;

  transfers: TransferJob[];
  logs: LogLine[];

  init: () => Promise<void>;
  refreshConnections: () => Promise<void>;
  refreshProjects: () => Promise<void>;

  openProject: (project: Project) => Promise<void>;
  openConnectionOnly: (connection: Connection, localStart?: string) => Promise<void>;
  switchEnvironment: (envId: number) => Promise<void>;

  /** Enter a directory entry (mapped: mirror both panes; free: that pane). */
  enter: (pane: Pane, entry: FileEntry) => Promise<void>;
  /** Go up one level (clamped to the root in mapped mode). */
  goUp: (pane: Pane) => Promise<void>;
  canGoUp: (pane: Pane) => boolean;
  navigate: (pane: Pane, path: string) => Promise<void>;
  refreshPane: (pane: Pane) => Promise<void>;
  refreshBoth: () => Promise<void>;
  setSelected: (pane: Pane, selected: Set<string>) => void;

  cancelTransfer: (jobId: string) => Promise<void>;
  clearFinished: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  connections: [],
  projects: [],
  environments: [],
  activeProject: null,
  activeConnectionId: null,
  activeConnection: null,
  activeEnvironmentId: null,
  mapped: false,
  localRoot: "",
  remoteRoot: "",
  relPath: "",
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
      set({
        activeProject: project,
        environments,
        activeConnectionId: null,
        activeConnection: null,
        activeEnvironmentId: null,
        mapped: false,
        localRoot: project.localPath,
        relPath: "",
      });
      await get().navigate("local", project.localPath);
      return;
    }
    const connection = await api.getConnection({ id: env.connectionId });
    set({
      activeProject: project,
      environments,
      activeConnectionId: env.connectionId,
      activeConnection: connection,
      activeEnvironmentId: env.id,
      mapped: true,
      localRoot: project.localPath,
      remoteRoot: env.remotePath || "/",
      relPath: "",
    });
    await get().refreshBoth();
  },

  switchEnvironment: async (envId) => {
    const env = get().environments.find((e) => e.id === envId);
    if (!env) return;
    set({
      activeEnvironmentId: env.id,
      activeConnectionId: env.connectionId,
      remoteRoot: env.remotePath || "/",
      relPath: "",
    });
    await get().refreshBoth();
  },

  openConnectionOnly: async (connection, localStart) => {
    set({
      activeProject: null,
      activeConnectionId: connection.id,
      activeConnection: connection,
      activeEnvironmentId: null,
      mapped: false,
      localRoot: "",
      remoteRoot: connection.remotePath,
      relPath: "",
    });
    const home = localStart ?? (await api.homeDir({}));
    await Promise.all([
      get().navigate("local", home),
      get().navigate("remote", connection.remotePath || "."),
    ]);
  },

  enter: async (pane, entry) => {
    if (entry.type !== "dir") return;
    const st = get();
    if (st.mapped) {
      set({ relPath: appendRel(st.relPath, entry.name) });
      await st.refreshBoth();
    } else {
      await st.navigate(pane, entry.path);
    }
  },

  goUp: async (pane) => {
    const st = get();
    if (st.mapped) {
      if (st.relPath === "") return; // locked to root
      set({ relPath: parentRel(st.relPath) });
      await st.refreshBoth();
    } else {
      await st.navigate(pane, parentOf(st[pane].path));
    }
  },

  canGoUp: (pane) => {
    const st = get();
    if (st.mapped) return st.relPath !== "";
    const p = st[pane].path;
    return p !== "/" && p !== "";
  },

  navigate: async (pane, path) => {
    // set the path immediately so the breadcrumb and counterpart-path logic are
    // correct even if the listing fails (e.g. remote dir not created yet)
    set((s) => ({ [pane]: { ...s[pane], path, loading: true, error: null, selected: new Set() } }) as Partial<AppState>);
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
      set((s) => ({ [pane]: { ...s[pane], path, entries, loading: false, error: null } }) as Partial<AppState>);
    } catch (err) {
      set((s) => ({ [pane]: { ...s[pane], entries: [], loading: false, error: (err as Error).message } }) as Partial<AppState>);
    }
  },

  refreshBoth: async () => {
    const { localRoot, remoteRoot, relPath, activeConnectionId } = get();
    await Promise.all([
      get().navigate("local", joinPath(localRoot, relPath)),
      activeConnectionId !== null
        ? get().navigate("remote", joinPath(remoteRoot, relPath))
        : Promise.resolve(),
    ]);
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
