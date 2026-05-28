import { Command, Settings, FolderSync, GitBranch, Eye, EyeOff } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import { useEffect, useState } from "react";

export function TopBar() {
  const activeProject = useStore((s) => s.activeProject);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const connections = useStore((s) => s.connections);
  const remoteRoot = useStore((s) => s.remoteRoot);
  const local = useStore((s) => s.local);
  const remote = useStore((s) => s.remote);
  const toggleCommandPalette = useUi((s) => s.toggleCommandPalette);
  const openSettings = useUi((s) => s.openSettings);
  const showSyncPreview = useUi((s) => s.showSyncPreview);
  const [watching, setWatching] = useState(false);

  const conn = connections.find((c) => c.id === activeConnectionId) ?? null;

  useEffect(() => {
    if (activeProject) {
      void api.watchStatus({ projectId: activeProject.id }).then(setWatching);
    } else {
      setWatching(false);
    }
  }, [activeProject]);

  const toggleWatch = async () => {
    if (!activeProject) return;
    if (watching) {
      await api.stopWatch({ projectId: activeProject.id });
      setWatching(false);
    } else {
      await api.startWatch({ projectId: activeProject.id });
      setWatching(true);
    }
  };

  const previewSync = async (direction: "up" | "down") => {
    if (!activeProject || !activeConnectionId) return;
    const plan = await api.previewSync({
      connectionId: activeConnectionId,
      projectId: activeProject.id,
      localDir: local.path,
      remoteDir: remote.path || remoteRoot,
      direction,
    });
    showSyncPreview({
      plan,
      direction,
      onRun: async () => {
        await api.runSync({
          connectionId: activeConnectionId,
          projectId: activeProject.id,
          localDir: local.path,
          remoteDir: remote.path || remoteRoot,
          direction,
        });
      },
    });
  };

  const uploadChanged = async () => {
    if (!activeProject || !activeConnectionId) return;
    await api.vcsUploadChanged({
      connectionId: activeConnectionId,
      localDir: local.path,
      remoteDir: remote.path || remoteRoot,
    });
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3">
      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <div className="grid size-5 place-items-center rounded bg-primary text-primary-foreground text-[10px] font-bold">
          K
        </div>
        Kira FTP
      </div>

      {activeProject && (
        <div className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
          <span className="text-foreground">{activeProject.name}</span>
          {conn && (
            <span className="text-muted-foreground">
              · {conn.user}@{conn.host}
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        {activeProject && activeConnectionId && (
          <>
            <ToolbarButton tip="Sync Up (local → remote)" onClick={() => previewSync("up")}>
              <FolderSync className="rotate-0" />
            </ToolbarButton>
            <ToolbarButton tip="Sync Down (remote → local)" onClick={() => previewSync("down")}>
              <FolderSync className="-scale-x-100" />
            </ToolbarButton>
            <ToolbarButton tip="Upload changed (VCS)" onClick={uploadChanged}>
              <GitBranch />
            </ToolbarButton>
            <ToolbarButton
              tip={watching ? "Stop watching" : "Watch & upload on save"}
              onClick={toggleWatch}
              active={watching}
            >
              {watching ? <Eye /> : <EyeOff />}
            </ToolbarButton>
            <div className="mx-1 h-5 w-px bg-border" />
          </>
        )}
        <ToolbarButton tip="Command palette (⌘K)" onClick={() => toggleCommandPalette(true)}>
          <Command />
        </ToolbarButton>
        <ToolbarButton tip="Settings" onClick={openSettings}>
          <Settings />
        </ToolbarButton>
      </div>
    </header>
  );
}

function ToolbarButton({
  children,
  tip,
  onClick,
  active,
}: {
  children: React.ReactNode;
  tip: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
