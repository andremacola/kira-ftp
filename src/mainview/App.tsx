import { useEffect } from "react";
import { TooltipProvider } from "./components/ui/tooltip";
import { Sidebar } from "./components/Sidebar";
import { DualPane } from "./components/DualPane";
import { TransferDock } from "./components/TransferDock";
import { TopBar } from "./components/TopBar";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { PromptDialog } from "./components/PromptDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SyncPreviewDialog } from "./components/SyncPreviewDialog";
import { CommandPalette } from "./components/CommandPalette";
import { RemoteEditor } from "./components/RemoteEditor";
import { SettingsDialog } from "./components/SettingsDialog";
import { useUi } from "./ui-store";

export default function App() {
  const toggleCommandPalette = useUi((s) => s.toggleCommandPalette);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleCommandPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCommandPalette]);

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <DualPane />
        </div>
        <TransferDock />
      </div>

      <ConnectionDialog />
      <ProjectDialog />
      <PromptDialog />
      <ConfirmDialog />
      <SyncPreviewDialog />
      <CommandPalette />
      <RemoteEditor />
      <SettingsDialog />
    </TooltipProvider>
  );
}
