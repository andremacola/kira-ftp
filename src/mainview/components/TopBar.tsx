import { Command, Settings, GitBranch, Eye, EyeOff } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import { useEffect, useState } from "react";
import logo from "../logo.png";

export function TopBar() {
  const activeProject = useStore((s) => s.activeProject);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const conn = useStore((s) => s.activeConnection);
  const localRoot = useStore((s) => s.localRoot);
  const remoteRoot = useStore((s) => s.remoteRoot);
  const toggleCommandPalette = useUi((s) => s.toggleCommandPalette);
  const openSettings = useUi((s) => s.openSettings);
  const [watching, setWatching] = useState(false);

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

  // VCS changed-files are relative to the project root, so map root -> root.
  const uploadChanged = async () => {
    if (!activeProject || !activeConnectionId) return;
    await api.vcsUploadChanged({
      connectionId: activeConnectionId,
      localDir: localRoot,
      remoteDir: remoteRoot,
    });
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3">
      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <img src={logo} alt="" className="size-5 rounded-[5px]" />
        Kira FTP
      </div>

      {activeProject && (
        <div className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
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
            <ToolbarButton tip="Upload changed files (VCS)" onClick={uploadChanged}>
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
