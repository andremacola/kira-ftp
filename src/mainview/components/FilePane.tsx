import { useMemo, useState } from "react";
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
  const ui = useUi();
  const [filter, setFilter] = useState("");

  const isRemote = pane === "remote";
  const canRemote = activeConnectionId !== null;

  const entries = useMemo(() => {
    if (!filter) return state.entries;
    const f = filter.toLowerCase();
    return state.entries.filter((e) => e.name.toLowerCase().includes(f));
  }, [state.entries, filter]);

  const open = (entry: FileEntry) => {
    if (entry.type === "dir") void navigate(pane, entry.path);
    else if (isRemote && activeConnectionId !== null)
      ui.openEditor({ connectionId: activeConnectionId, remotePath: entry.path, name: entry.name });
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

  const remove = (entry: FileEntry) =>
    ui.showConfirm({
      title: `Delete ${entry.name}`,
      message: isRemote
        ? "Delete this item on the remote server?"
        : "Delete this item from your local disk?",
      destructive: true,
      onConfirm: async () => {
        if (isRemote) await api.deleteRemote({ connectionId: activeConnectionId!, path: entry.path });
        else await api.deleteLocal({ path: entry.path });
        await refreshPane(pane);
      },
    });

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

  const transfer = (entry: FileEntry) => {
    if (!canRemote) return;
    if (isRemote) {
      const localTarget = joinLocal(other.path, entry.name);
      if (entry.type === "dir")
        void api.downloadFolder({ connectionId: activeConnectionId!, remoteDir: entry.path, localDir: localTarget });
      else void api.downloadFile({ connectionId: activeConnectionId!, remotePath: entry.path, localPath: localTarget });
    } else {
      const remoteTarget = joinRemote(other.path, entry.name);
      if (entry.type === "dir")
        void api.uploadFolder({ connectionId: activeConnectionId!, localDir: entry.path, remoteDir: remoteTarget });
      else void api.uploadFile({ connectionId: activeConnectionId!, localPath: entry.path, remotePath: remoteTarget });
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-1 border-b border-border bg-card/40 px-2 py-1.5">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {isRemote ? "Remote" : "Local"}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={() => navigate(pane, parentOf(state.path))}>
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

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
                onDoubleClick={() => open(entry)}
                onClick={() => setSelected(pane, new Set([entry.path]))}
                className={cn(
                  "group flex cursor-default select-none items-center gap-2 px-3 py-1 text-[13px]",
                  state.selected.has(entry.path) ? "bg-accent" : "hover:bg-accent/50",
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
                {isRemote ? "Download" : "Upload"}
              </ContextMenuItem>
              {isRemote && entry.type === "file" && (
                <ContextMenuItem onSelect={() => open(entry)}>
                  <FileEdit /> Edit
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
