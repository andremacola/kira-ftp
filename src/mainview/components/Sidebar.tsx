import { useState } from "react";
import {
  Plus,
  FolderGit2,
  FolderPlus,
  Pencil,
  Trash2,
  Plug,
  PlugZap,
  FolderInput,
  ChevronRight,
  ChevronDown,
  Check,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import { cn } from "../lib/utils";
import type { Project } from "@shared/domain";

export function Sidebar() {
  const projects = useStore((s) => s.projects);
  const groups = useStore((s) => s.groups);
  const activeProject = useStore((s) => s.activeProject);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const openProject = useStore((s) => s.openProject);
  const refreshProjects = useStore((s) => s.refreshProjects);
  const refreshGroups = useStore((s) => s.refreshGroups);
  const createGroup = useStore((s) => s.createGroup);
  const renameGroup = useStore((s) => s.renameGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const setProjectGroup = useStore((s) => s.setProjectGroup);
  const disconnect = useStore((s) => s.disconnect);
  const ui = useUi();

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const toggleCollapsed = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteProject = (id: number) =>
    ui.showConfirm({
      title: "Delete project",
      message:
        "Remove this project and its saved connection? Local and remote files are not touched.",
      destructive: true,
      onConfirm: async () => {
        await api.deleteProject({ id });
        await refreshProjects();
      },
    });

  const newGroup = () =>
    ui.showPrompt({
      title: "New group",
      label: "Group name",
      defaultValue: "",
      confirmText: "Create",
      onSubmit: (name) => {
        const n = name.trim();
        if (n) void createGroup(n);
      },
    });

  // Create a group and immediately move the project into it.
  const newGroupForProject = (project: Project) =>
    ui.showPrompt({
      title: "New group",
      label: "Group name",
      defaultValue: "",
      confirmText: "Create",
      onSubmit: async (name) => {
        const n = name.trim();
        if (!n) return;
        const group = await api.createGroup({ name: n });
        await api.setProjectGroup({ projectId: project.id, groupId: group.id });
        await Promise.all([refreshGroups(), refreshProjects()]);
      },
    });

  const renameGroupPrompt = (id: number, current: string) =>
    ui.showPrompt({
      title: "Rename group",
      label: "Group name",
      defaultValue: current,
      confirmText: "Save",
      onSubmit: (name) => {
        const n = name.trim();
        if (n && n !== current) void renameGroup(id, n);
      },
    });

  const deleteGroupPrompt = (id: number) =>
    ui.showConfirm({
      title: "Delete group",
      message: "Remove this group? Its projects move back to ungrouped.",
      destructive: true,
      onConfirm: () => deleteGroup(id),
    });

  const ungrouped = projects.filter((p) => p.groupId == null);

  const renderProject = (p: Project) => {
    const isActive = activeProject?.id === p.id;
    return (
      <ContextMenu key={p.id}>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => openProject(p)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
              isActive
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
              ui.openProjectSettings();
            }}
          >
            <Pencil /> Settings
          </ContextMenuItem>
          {isActive && activeConnectionId !== null && (
            <ContextMenuItem onSelect={() => void disconnect()}>
              <PlugZap /> Disconnect
            </ContextMenuItem>
          )}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput /> Move to group
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onSelect={() => void setProjectGroup(p.id, null)}>
                {p.groupId == null && <Check />} No group
              </ContextMenuItem>
              {groups.length > 0 && <ContextMenuSeparator />}
              {groups.map((g) => (
                <ContextMenuItem
                  key={g.id}
                  onSelect={() => void setProjectGroup(p.id, g.id)}
                >
                  {p.groupId === g.id && <Check />} {g.name}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => newGroupForProject(p)}>
                <Plus /> New group…
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem variant="destructive" onSelect={() => deleteProject(p.id)}>
            <Trash2 /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Projects
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={newGroup} className="size-6">
                <FolderPlus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New group</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={ui.openProjectDialog} className="size-6">
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New project</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {projects.length === 0 && groups.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No projects yet
          </div>
        )}

        {ungrouped.map(renderProject)}

        {groups.map((g) => {
          const members = projects.filter((p) => p.groupId === g.id);
          const isCollapsed = collapsed.has(g.id);
          return (
            <div key={g.id} className="mt-1">
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={() => toggleCollapsed(g.id)}
                    className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <span className="text-[10px] tabular-nums">{members.length}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => renameGroupPrompt(g.id, g.name)}>
                    <Pencil /> Rename
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => deleteGroupPrompt(g.id)}
                  >
                    <Trash2 /> Delete group
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {!isCollapsed && (
                <div className="pl-1.5">
                  {members.length === 0 ? (
                    <div className="px-2 py-1 text-[11px] text-muted-foreground/70">
                      Empty
                    </div>
                  ) : (
                    members.map(renderProject)
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
