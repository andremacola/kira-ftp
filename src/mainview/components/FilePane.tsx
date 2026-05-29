import { useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Folder,
  File as FileIcon,
  Link2,
  Upload,
  Download,
  Pencil,
  Trash2,
  KeyRound,
  FileEdit,
  FileDiff,
  FolderSync,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { useStore, type Pane } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import { cn, formatBytes, formatMode, formatTime } from "../lib/utils";
import type { FileEntry } from "@shared/domain";

const joinLocal = (dir: string, name: string) => `${dir.replace(/\/$/, "")}/${name}`;
const joinRemote = (dir: string, name: string) =>
  `${dir.replace(/\/$/, "")}/${name}`.replace(/\/{2,}/g, "/");
const parentOf = (p: string) => {
  const t = p.replace(/\/$/, "");
  const i = t.lastIndexOf("/");
  return i <= 0 ? (t.startsWith("/") ? "/" : t) : t.slice(0, i);
};

export function FilePane({ pane }: { pane: Pane }) {
  const state = useStore((s) => s[pane]);
  const navigate = useStore((s) => s.navigate);
  const refreshPane = useStore((s) => s.refreshPane);
  const setSelected = useStore((s) => s.setSelected);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const other = useStore((s) => (pane === "local" ? s.remote : s.local));
  const enter = useStore((s) => s.enter);
  const goUp = useStore((s) => s.goUp);
  const canGoUp = useStore((s) => s.canGoUp);
  const activeProject = useStore((s) => s.activeProject);
  const ui = useUi();
  const [filter, setFilter] = useState("");
  /** path of the folder row currently hovered during a drag (drop highlight). */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** true while a drag from the other pane hovers the pane background. */
  const [paneDropActive, setPaneDropActive] = useState(false);

  const DRAG_MIME = "application/x-kira-paths";

  const isRemote = pane === "remote";
  const canRemote = activeConnectionId !== null;

  const entries = useMemo(() => {
    if (!filter) return state.entries;
    const f = filter.toLowerCase();
    return state.entries.filter((e) => e.name.toLowerCase().includes(f));
  }, [state.entries, filter]);

  const lastClicked = useRef<string | null>(null);

  const open = (entry: FileEntry) => {
    if (entry.type === "dir") void enter(pane, entry);
    else if (isRemote && activeConnectionId !== null)
      ui.openEditor({ connectionId: activeConnectionId, remotePath: entry.path, name: entry.name });
  };

  /** Click selection with ⌘ (toggle), ⇧ (range), or plain (single). */
  const onRowClick = (entry: FileEntry, e: React.MouseEvent) => {
    const next = new Set(state.selected);
    if (e.metaKey || e.ctrlKey) {
      next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path);
      lastClicked.current = entry.path;
    } else if (e.shiftKey && lastClicked.current) {
      const from = entries.findIndex((x) => x.path === lastClicked.current);
      const to = entries.findIndex((x) => x.path === entry.path);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i++) next.add(entries[i]!.path);
      }
    } else {
      next.clear();
      next.add(entry.path);
      lastClicked.current = entry.path;
    }
    setSelected(pane, next);
  };

  /** Entries the user is acting on: the full selection, or just `entry`.
   *  Resolved against the unfiltered list so a search filter never silently
   *  drops selected-but-hidden items from a batch action. */
  const actionTargets = (entry: FileEntry): FileEntry[] => {
    if (state.selected.has(entry.path) && state.selected.size > 1) {
      return state.entries.filter((x) => state.selected.has(x.path));
    }
    return [entry];
  };

  const newFolder = () =>
    ui.showPrompt({
      title: "New folder",
      label: "Folder name",
      defaultValue: "",
      onSubmit: async (name) => {
        if (!name) return;
        if (isRemote) await api.mkdirRemote({ connectionId: activeConnectionId!, path: joinRemote(state.path, name) });
        else await api.mkdirLocal({ path: joinLocal(state.path, name) });
        await refreshPane(pane);
      },
    });

  const rename = (entry: FileEntry) =>
    ui.showPrompt({
      title: `Rename ${entry.name}`,
      label: "New name",
      defaultValue: entry.name,
      onSubmit: async (name) => {
        if (!name || name === entry.name) return;
        const target = isRemote ? joinRemote(state.path, name) : joinLocal(state.path, name);
        if (isRemote) await api.renameRemote({ connectionId: activeConnectionId!, from: entry.path, to: target });
        else await api.renameLocal({ from: entry.path, to: target });
        await refreshPane(pane);
      },
    });

  const remove = (entry: FileEntry) => {
    const targets = actionTargets(entry);
    const label = targets.length > 1 ? `${targets.length} items` : entry.name;
    ui.showConfirm({
      title: `Delete ${label}`,
      message: isRemote
        ? `Delete ${label} on the remote server?`
        : `Delete ${label} from your local disk?`,
      destructive: true,
      onConfirm: async () => {
        for (const t of targets) {
          if (isRemote) await api.deleteRemote({ connectionId: activeConnectionId!, path: t.path });
          else await api.deleteLocal({ path: t.path });
        }
        setSelected(pane, new Set());
        await refreshPane(pane);
      },
    });
  };

  const chmod = (entry: FileEntry) =>
    ui.showPrompt({
      title: `Permissions for ${entry.name}`,
      label: "Octal mode (e.g. 644)",
      defaultValue: formatMode(entry.mode) || "644",
      onSubmit: async (mode) => {
        const parsed = parseInt(mode, 8);
        if (Number.isNaN(parsed)) return;
        await api.chmodRemote({ connectionId: activeConnectionId!, path: entry.path, mode: parsed });
        await refreshPane(pane);
      },
    });

  const diff = async (entry: FileEntry) => {
    if (entry.type !== "file" || !canRemote) return;
    if (isRemote) {
      const localCounterpart = joinLocal(other.path, entry.name);
      const [leftText, rightText] = await Promise.all([
        api.readRemoteText({ connectionId: activeConnectionId!, remotePath: entry.path }),
        api.readLocalText({ path: localCounterpart }).catch(() => ""),
      ]);
      ui.showDiff({
        title: entry.name,
        filename: entry.name,
        leftLabel: `remote: ${entry.path}`,
        leftText,
        rightLabel: `local: ${localCounterpart}`,
        rightText,
      });
    } else {
      const remoteCounterpart = joinRemote(other.path, entry.name);
      const [leftText, rightText] = await Promise.all([
        api.readLocalText({ path: entry.path }),
        api
          .readRemoteText({ connectionId: activeConnectionId!, remotePath: remoteCounterpart })
          .catch(() => ""),
      ]);
      ui.showDiff({
        title: entry.name,
        filename: entry.name,
        leftLabel: `local: ${entry.path}`,
        leftText,
        rightLabel: `remote: ${remoteCounterpart}`,
        rightText,
      });
    }
  };

  // Sync a folder against its mapped counterpart (right-click on a directory).
  const syncFolder = async (entry: FileEntry) => {
    if (entry.type !== "dir" || !canRemote || activeConnectionId === null || !activeProject)
      return;
    const direction = isRemote ? "down" : "up";
    const localDir = isRemote ? joinLocal(other.path, entry.name) : entry.path;
    const remoteDir = isRemote ? entry.path : joinRemote(other.path, entry.name);
    const plan = await api.previewSync({
      connectionId: activeConnectionId,
      projectId: activeProject.id,
      localDir,
      remoteDir,
      direction,
    });
    ui.showSyncPreview({
      plan,
      direction,
      onRun: async () => {
        await api.runSync({
          connectionId: activeConnectionId,
          projectId: activeProject.id,
          localDir,
          remoteDir,
          direction,
        });
      },
    });
  };

  /** Transfer one entry to the given destination dir on the other side. */
  const transferOne = (entry: FileEntry, destDir: string) => {
    if (activeConnectionId === null) return;
    if (isRemote) {
      const localTarget = joinLocal(destDir, entry.name);
      if (entry.type === "dir")
        void api.downloadFolder({ connectionId: activeConnectionId, remoteDir: entry.path, localDir: localTarget });
      else void api.downloadFile({ connectionId: activeConnectionId, remotePath: entry.path, localPath: localTarget });
    } else {
      const remoteTarget = joinRemote(destDir, entry.name);
      if (entry.type === "dir")
        void api.uploadFolder({ connectionId: activeConnectionId, localDir: entry.path, remoteDir: remoteTarget });
      else void api.uploadFile({ connectionId: activeConnectionId, localPath: entry.path, remotePath: remoteTarget });
    }
  };

  /** Context-menu transfer: all selected (or just this) into the other pane's dir. */
  const transfer = (entry: FileEntry) => {
    if (!canRemote) return;
    for (const t of actionTargets(entry)) transferOne(t, other.path);
  };

  /** Handle a drop of `payload` (from some pane) into destDir on THIS pane. */
  const onDropPayload = (payload: { pane: Pane; paths: string[] }, destDir: string) => {
    if (!canRemote) return;
    // Only cross-pane drops transfer; dropping back on the source pane is a no-op.
    if (payload.pane === pane) return;
    // The dragged entries live in the OTHER pane (the source). Resolve them there.
    const sourceEntries = other.entries.filter((e) => payload.paths.includes(e.path));
    for (const e of sourceEntries) {
      if (activeConnectionId === null) continue;
      if (isRemote) {
        const remoteTarget = joinRemote(destDir, e.name); // local -> remote: upload
        if (e.type === "dir")
          void api.uploadFolder({ connectionId: activeConnectionId, localDir: e.path, remoteDir: remoteTarget });
        else void api.uploadFile({ connectionId: activeConnectionId, localPath: e.path, remotePath: remoteTarget });
      } else {
        const localTarget = joinLocal(destDir, e.name); // remote -> local: download
        if (e.type === "dir")
          void api.downloadFolder({ connectionId: activeConnectionId, remoteDir: e.path, localDir: localTarget });
        else void api.downloadFile({ connectionId: activeConnectionId, remotePath: e.path, localPath: localTarget });
      }
    }
  };

  /** Parse a drag payload, tolerating malformed data. */
  const parsePayload = (raw: string): { pane: Pane; paths: string[] } | null => {
    try {
      const p = JSON.parse(raw);
      if (p && (p.pane === "local" || p.pane === "remote") && Array.isArray(p.paths)) return p;
    } catch {
      /* ignore */
    }
    return null;
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-1 border-b border-border bg-card/40 px-2 py-1.5">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {isRemote ? "Remote" : "Local"}
          {state.selected.size > 1 && (
            <span className="ml-1 normal-case text-primary">· {state.selected.size} selected</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void goUp(pane)}
          disabled={!canGoUp(pane)}
        >
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => refreshPane(pane)}>
          <RefreshCw className={cn(state.loading && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={newFolder}
          disabled={isRemote && !canRemote}
        >
          <FolderPlus />
        </Button>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="ml-1 h-7"
        />
      </div>

      {/* breadcrumb path */}
      <div className="truncate border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
        {state.path || (isRemote ? "(not connected)" : "")}
      </div>

      {/* list (drop zone: dropping here transfers into the current dir) */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          paneDropActive && "bg-primary/5 ring-1 ring-inset ring-primary/40",
        )}
        onDragOver={(e) => {
          if (canRemote && e.dataTransfer.types.includes(DRAG_MIME)) {
            e.preventDefault();
            setPaneDropActive(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setPaneDropActive(false);
        }}
        onDrop={(e) => {
          setPaneDropActive(false);
          const payload = parsePayload(e.dataTransfer.getData(DRAG_MIME));
          if (!payload) return;
          e.preventDefault();
          onDropPayload(payload, state.path);
        }}
      >
        {isRemote && !canRemote && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Open a project or server to browse remote files.
          </div>
        )}
        {state.error && (
          <div className="m-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {state.error}
          </div>
        )}
        {entries.map((entry) => (
          <ContextMenu key={entry.path}>
            <ContextMenuTrigger asChild>
              <div
                draggable
                onDragStart={(e) => {
                  // drag the selection if this row is part of it, else just this row
                  const paths = state.selected.has(entry.path)
                    ? [...state.selected]
                    : [entry.path];
                  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ pane, paths }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDragOver={(e) => {
                  // a folder row is a drop target for items from the other pane
                  if (entry.type === "dir" && canRemote && e.dataTransfer.types.includes(DRAG_MIME)) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropTarget(entry.path);
                  }
                }}
                onDragLeave={() => setDropTarget((p) => (p === entry.path ? null : p))}
                onDrop={(e) => {
                  if (entry.type !== "dir") return;
                  const payload = parsePayload(e.dataTransfer.getData(DRAG_MIME));
                  if (!payload) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setDropTarget(null);
                  setPaneDropActive(false);
                  onDropPayload(payload, entry.path);
                }}
                onDoubleClick={() => open(entry)}
                onClick={(e) => onRowClick(entry, e)}
                className={cn(
                  "group flex cursor-default select-none items-center gap-2 px-3 py-1 text-[13px]",
                  state.selected.has(entry.path) ? "bg-accent" : "hover:bg-accent/50",
                  dropTarget === entry.path && "ring-1 ring-inset ring-primary/60 bg-primary/10",
                )}
              >
                <EntryIcon entry={entry} />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">
                  {entry.type === "file" ? formatBytes(entry.size) : ""}
                </span>
                <span className="hidden w-28 text-right text-[11px] text-muted-foreground lg:inline">
                  {formatTime(entry.modifiedMs)}
                </span>
                <span className="hidden w-10 text-right text-[11px] tabular-nums text-muted-foreground xl:inline">
                  {formatMode(entry.mode)}
                </span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => transfer(entry)} disabled={!canRemote}>
                {isRemote ? <Download /> : <Upload />}
                {(() => {
                  const n = actionTargets(entry).length;
                  const verb = isRemote ? "Download" : "Upload";
                  return n > 1 ? `${verb} ${n} items` : verb;
                })()}
              </ContextMenuItem>
              {entry.type === "dir" && canRemote && activeProject && (
                <ContextMenuItem onSelect={() => void syncFolder(entry)}>
                  <FolderSync /> {isRemote ? "Sync folder ← remote" : "Sync folder → remote"}
                </ContextMenuItem>
              )}
              {isRemote && entry.type === "file" && (
                <ContextMenuItem onSelect={() => open(entry)}>
                  <FileEdit /> Edit
                </ContextMenuItem>
              )}
              {entry.type === "file" && canRemote && (
                <ContextMenuItem onSelect={() => void diff(entry)}>
                  <FileDiff /> Diff {isRemote ? "with local" : "with remote"}
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => rename(entry)}>
                <Pencil /> Rename
              </ContextMenuItem>
              {isRemote && (
                <ContextMenuItem onSelect={() => chmod(entry)}>
                  <KeyRound /> Permissions
                </ContextMenuItem>
              )}
              <ContextMenuItem variant="destructive" onSelect={() => remove(entry)}>
                <Trash2 /> Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        {!state.loading && entries.length === 0 && (canRemote || !isRemote) && !state.error && (
          <div className="p-6 text-center text-xs text-muted-foreground">Empty folder</div>
        )}
      </div>
    </div>
  );
}

function EntryIcon({ entry }: { entry: FileEntry }) {
  if (entry.type === "dir") return <Folder className="size-4 shrink-0 text-sky-500" />;
  if (entry.type === "symlink") return <Link2 className="size-4 shrink-0 text-teal-500" />;
  return <FileIcon className="size-4 shrink-0 text-muted-foreground" />;
}
