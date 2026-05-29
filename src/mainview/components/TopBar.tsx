import { Command, Settings, GitBranch, Eye, EyeOff, PlugZap, Plug } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import { cn } from "../lib/utils";
import { useEffect, useState } from "react";
import type { ConnectionState } from "@shared/domain";

const STATE_META: Record<ConnectionState, { dot: string; label: string }> = {
  connected: { dot: "bg-emerald-500", label: "Connected" },
  connecting: { dot: "bg-amber-500 animate-pulse", label: "Connecting…" },
  disconnected: { dot: "bg-muted-foreground", label: "Disconnected" },
  error: { dot: "bg-destructive", label: "Connection error" },
};

export function TopBar() {
  const activeProject = useStore((s) => s.activeProject);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const conn = useStore((s) => s.activeConnection);
  const localRoot = useStore((s) => s.localRoot);
  const remoteRoot = useStore((s) => s.remoteRoot);
  const connectionStates = useStore((s) => s.connectionStates);
  const disconnect = useStore((s) => s.disconnect);
  const refreshBoth = useStore((s) => s.refreshBoth);
  const toggleCommandPalette = useUi((s) => s.toggleCommandPalette);
  const openGlobalSettings = useUi((s) => s.openGlobalSettings);
  const [watching, setWatching] = useState(false);

  const connState: ConnectionState | null =
    activeConnectionId !== null
      ? connectionStates[activeConnectionId] ?? "connecting"
      : null;
  const connected = connState === "connected" || connState === "connecting";

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
    <header className="electrobun-webkit-app-region-drag relative flex h-11 shrink-0 items-center gap-2 border-b border-border bg-sidebar pl-20 pr-3">
      {/* centered, de-emphasized app title */}
      <div className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium tracking-tight text-muted-foreground">
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
          {connState && (
            <span
              className={cn("size-2 rounded-full", STATE_META[connState].dot)}
              title={STATE_META[connState].label}
            />
          )}
        </div>
      )}

      <div className="electrobun-webkit-app-region-no-drag ml-auto flex items-center gap-1">
        {activeProject && activeConnectionId !== null && (
          <>
            <ToolbarButton
              tip={connected ? "Disconnect" : "Reconnect"}
              onClick={connected ? () => void disconnect() : () => void refreshBoth()}
            >
              {connected ? <PlugZap /> : <Plug />}
            </ToolbarButton>
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
        <ToolbarButton tip="Settings" onClick={openGlobalSettings}>
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
