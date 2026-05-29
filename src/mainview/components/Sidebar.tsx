import { Plus, Server, FolderGit2, Pencil, Trash2, Plug } from "lucide-react";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import { cn } from "../lib/utils";

export function Sidebar() {
  const connections = useStore((s) => s.connections);
  const projects = useStore((s) => s.projects);
  const activeProject = useStore((s) => s.activeProject);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const openProject = useStore((s) => s.openProject);
  const openConnectionOnly = useStore((s) => s.openConnectionOnly);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const refreshProjects = useStore((s) => s.refreshProjects);

  const ui = useUi();

  const deleteConnection = (id: number) =>
    ui.showConfirm({
      title: "Delete server",
      message: "Remove this server profile? Projects using it will lose their connection.",
      destructive: true,
      onConfirm: async () => {
        await api.deleteConnection({ id });
        await refreshConnections();
      },
    });

  const deleteProject = (id: number) =>
    ui.showConfirm({
      title: "Delete project",
      message: "Remove this project mapping? Local and remote files are not touched.",
      destructive: true,
      onConfirm: async () => {
        await api.deleteProject({ id });
        await refreshProjects();
      },
    });

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <Section
        title="Projects"
        onAdd={ui.openProjectDialog}
        addTip="New project"
      >
        {projects.length === 0 && <Empty label="No projects yet" />}
        {projects.map((p) => (
          <ContextMenu key={p.id}>
            <ContextMenuTrigger asChild>
              <Row
                active={activeProject?.id === p.id}
                icon={<FolderGit2 className="size-4 text-sky-500" />}
                label={p.name}
                onClick={() => openProject(p)}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => openProject(p)}>
                <Plug /> Open
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={async () => {
                  await openProject(p);
                  ui.openSettings();
                }}
              >
                <Pencil /> Settings
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={() => deleteProject(p.id)}>
                <Trash2 /> Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </Section>

      <Section
        title="Servers"
        onAdd={() => ui.openConnectionDialog(null)}
        addTip="New server"
      >
        {connections.length === 0 && <Empty label="No servers yet" />}
        {connections.map((c) => (
          <ContextMenu key={c.id}>
            <ContextMenuTrigger asChild>
              <Row
                active={!activeProject && activeConnectionId === c.id}
                icon={<Server className="size-4 text-violet-500" />}
                label={c.name}
                sub={`${c.type.toUpperCase()} · ${c.host}`}
                onClick={() => openConnectionOnly(c)}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => openConnectionOnly(c)}>
                <Plug /> Browse
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => ui.openConnectionDialog(c)}>
                <Pencil /> Edit
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onSelect={() => deleteConnection(c.id)}
              >
                <Trash2 /> Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </Section>
    </aside>
  );
}

function Section({
  title,
  onAdd,
  addTip,
  children,
}: {
  title: string;
  onAdd: () => void;
  addTip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onAdd} className="size-6">
              <Plus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{addTip}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">{children}</div>
    </div>
  );
}

function Row({
  active,
  icon,
  label,
  sub,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        active ? "bg-sidebar-accent text-foreground" : "hover:bg-sidebar-accent/60",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-2 py-3 text-center text-xs text-muted-foreground">{label}</div>;
}
