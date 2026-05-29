import { Plus, FolderGit2, Pencil, Trash2, Plug } from "lucide-react";
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
  const projects = useStore((s) => s.projects);
  const activeProject = useStore((s) => s.activeProject);
  const openProject = useStore((s) => s.openProject);
  const refreshProjects = useStore((s) => s.refreshProjects);
  const ui = useUi();

  const deleteProject = (id: number) =>
    ui.showConfirm({
      title: "Delete project",
      message: "Remove this project and its saved connection? Local and remote files are not touched.",
      destructive: true,
      onConfirm: async () => {
        await api.deleteProject({ id });
        await refreshProjects();
      },
    });

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Projects
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={ui.openProjectDialog} className="size-6">
              <Plus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New project</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No projects yet
          </div>
        )}
        {projects.map((p) => (
          <ContextMenu key={p.id}>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => openProject(p)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                  activeProject?.id === p.id
                    ? "bg-sidebar-accent text-foreground"
                    : "hover:bg-sidebar-accent/60",
                )}
              >
                <FolderGit2 className="size-4 text-sky-500" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
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
      </div>
    </aside>
  );
}
