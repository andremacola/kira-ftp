import { Command } from "cmdk";
import { Dialog, DialogContent } from "./ui/dialog";
import {
  Server,
  FolderGit2,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  GitBranch,
  Settings,
  FolderOpen,
  FolderSync,
} from "lucide-react";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";

export function CommandPalette() {
  const open = useUi((s) => s.commandPalette);
  const toggle = useUi((s) => s.toggleCommandPalette);
  const ui = useUi();
  const store = useStore();

  const run = (fn: () => void | Promise<void>) => () => {
    toggle(false);
    void fn();
  };

  const hasContext = !!store.activeProject && store.activeConnectionId !== null;

  const previewSync = (direction: "up" | "down") => async () => {
    if (!store.activeProject || store.activeConnectionId === null) return;
    const plan = await api.previewSync({
      connectionId: store.activeConnectionId,
      projectId: store.activeProject.id,
      localDir: store.local.path,
      remoteDir: store.remote.path || store.remoteRoot,
      direction,
    });
    ui.showSyncPreview({
      plan,
      direction,
      onRun: async () => {
        await api.runSync({
          connectionId: store.activeConnectionId!,
          projectId: store.activeProject!.id,
          localDir: store.local.path,
          remoteDir: store.remote.path || store.remoteRoot,
          direction,
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => toggle(o)}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <Command className="[&_[cmdk-input]]:h-11 [&_[cmdk-input]]:w-full [&_[cmdk-input]]:bg-transparent [&_[cmdk-input]]:px-4 [&_[cmdk-input]]:text-sm [&_[cmdk-input]]:outline-none">
          <Command.Input placeholder="Type a command…" autoFocus className="border-b border-border" />
          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="py-6 text-center text-xs text-muted-foreground">
              No commands found.
            </Command.Empty>

            <Group heading="Create">
              <Item onSelect={run(() => ui.openProjectDialog())} icon={<FolderGit2 />}>
                New project
              </Item>
            </Group>

            {hasContext && (
              <Group heading="Sync & transfer">
                <Item onSelect={run(previewSync("up"))} icon={<ArrowUp />}>
                  Sync up (local → remote)
                </Item>
                <Item onSelect={run(previewSync("down"))} icon={<ArrowDown />}>
                  Sync down (remote → local)
                </Item>
                <Item
                  onSelect={run(() => {
                    ui.showConfirm({
                      title: "Sync both (bidirectional)",
                      message:
                        "Run a two-way sync (rclone bisync) between local and remote? Newer files win on each side.",
                      onConfirm: async () => {
                        await api.runSync({
                          connectionId: store.activeConnectionId!,
                          projectId: store.activeProject!.id,
                          localDir: store.local.path,
                          remoteDir: store.remote.path || store.remoteRoot,
                          direction: "both",
                        });
                      },
                    });
                  })}
                  icon={<FolderSync />}
                >
                  Sync both (bidirectional)
                </Item>
                <Item
                  onSelect={run(() => {
                    void api.vcsUploadChanged({
                      connectionId: store.activeConnectionId!,
                      localDir: store.local.path,
                      remoteDir: store.remote.path || store.remoteRoot,
                    });
                  })}
                  icon={<GitBranch />}
                >
                  Upload changed files (VCS)
                </Item>
              </Group>
            )}

            <Group heading="View">
              <Item onSelect={run(() => store.refreshPane("local"))} icon={<RefreshCw />}>
                Refresh local pane
              </Item>
              <Item onSelect={run(() => store.refreshPane("remote"))} icon={<RefreshCw />}>
                Refresh remote pane
              </Item>
              <Item onSelect={run(() => ui.openSettings())} icon={<Settings />}>
                Open settings
              </Item>
            </Group>

            {store.projects.length > 0 && (
              <Group heading="Open project">
                {store.projects.map((p) => (
                  <Item key={p.id} onSelect={run(() => store.openProject(p))} icon={<FolderOpen />}>
                    {p.name}
                  </Item>
                ))}
              </Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  icon,
  onSelect,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-[13px] aria-selected:bg-accent aria-selected:text-accent-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground"
    >
      {icon}
      {children}
    </Command.Item>
  );
}
