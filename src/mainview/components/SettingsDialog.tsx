import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Switch } from "./ui/switch";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import type { IgnoreRule, Project } from "@shared/domain";

const TOGGLES: Array<{ key: keyof Project; label: string; hint: string }> = [
  { key: "uploadOnSave", label: "Upload on save", hint: "Auto-upload watched files when they change" },
  { key: "confirmOverwriteNewer", label: "Confirm overwrite newer", hint: "Warn before overwriting a newer remote file" },
  { key: "confirmSync", label: "Confirm sync", hint: "Preview operations before running a sync" },
  { key: "confirmDownloads", label: "Confirm downloads", hint: "Ask before downloading" },
  { key: "syncDownOnOpen", label: "Sync down on open", hint: "Pull the remote copy when opening a file" },
  { key: "syncSkipDeletes", label: "Skip deletes on sync", hint: "Never delete orphaned files during sync" },
  { key: "syncSameAge", label: "Sync same age", hint: "Transfer even when timestamps match" },
];

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const close = useUi((s) => s.closeSettings);
  const activeProject = useStore((s) => s.activeProject);
  const refreshProjects = useStore((s) => s.refreshProjects);

  const [project, setProject] = useState<Project | null>(null);
  const [rules, setRules] = useState<IgnoreRule[]>([]);
  const [newPattern, setNewPattern] = useState("");

  useEffect(() => {
    if (open && activeProject) {
      setProject(activeProject);
      void api.listIgnoreRules({ projectId: activeProject.id }).then(setRules);
    }
  }, [open, activeProject]);

  const save = async (next: Project) => {
    setProject(next);
    const { id, createdAt, updatedAt, ...input } = next;
    await api.updateProject({ id, input });
    await refreshProjects();
  };

  const addRule = async () => {
    if (!project || !newPattern.trim()) return;
    const rule = await api.createIgnoreRule({ projectId: project.id, pattern: newPattern.trim() });
    setRules((r) => [...r, rule]);
    setNewPattern("");
  };

  const removeRule = async (id: number) => {
    await api.deleteIgnoreRule({ id });
    setRules((r) => r.filter((x) => x.id !== id));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {project ? `Project: ${project.name}` : "Open a project to edit its settings."}
          </DialogDescription>
        </DialogHeader>

        {project && (
          <Tabs defaultValue="behavior">
            <TabsList>
              <TabsTrigger value="behavior">Behavior</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="ignore">Ignore rules</TabsTrigger>
            </TabsList>

            <TabsContent value="behavior" className="mt-3 grid gap-3">
              {TOGGLES.map((t) => (
                <div key={t.key} className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13px]">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground">{t.hint}</div>
                  </div>
                  <Switch
                    checked={Boolean(project[t.key])}
                    onCheckedChange={(v) => save({ ...project, [t.key]: v })}
                  />
                </div>
              ))}
            </TabsContent>

            <TabsContent value="permissions" className="mt-3 grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>File permissions (octal)</Label>
                <Input
                  value={project.filePermissions ?? ""}
                  placeholder="644"
                  onChange={(e) => save({ ...project, filePermissions: e.target.value || null })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Directory permissions (octal)</Label>
                <Input
                  value={project.dirPermissions ?? ""}
                  placeholder="755"
                  onChange={(e) => save({ ...project, dirPermissions: e.target.value || null })}
                />
              </div>
            </TabsContent>

            <TabsContent value="ignore" className="mt-3 grid gap-2">
              <div className="flex gap-1.5">
                <Input
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  placeholder="Regex, e.g. \\.git(/|$)"
                  onKeyDown={(e) => e.key === "Enter" && void addRule()}
                />
                <Button variant="outline" size="icon" onClick={() => void addRule()}>
                  <Plus />
                </Button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                {rules.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">No ignore rules</div>
                ) : (
                  rules.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[12px] last:border-0"
                    >
                      <code className="min-w-0 flex-1 truncate">{r.pattern}</code>
                      <Button variant="ghost" size="icon-sm" onClick={() => void removeRule(r.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
