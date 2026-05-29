import { useEffect, useState } from "react";
import { Plus, Trash2, FolderSearch } from "lucide-react";
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
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import type { Environment, IgnoreRule, Project } from "@shared/domain";

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
  const connections = useStore((s) => s.connections);
  const refreshProjects = useStore((s) => s.refreshProjects);
  const openProject = useStore((s) => s.openProject);

  const [project, setProject] = useState<Project | null>(null);
  const [rules, setRules] = useState<IgnoreRule[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [newEnvName, setNewEnvName] = useState("");
  const [newEnvConn, setNewEnvConn] = useState<number | null>(null);
  const [newEnvPath, setNewEnvPath] = useState("");

  const reloadEnvs = (projectId: number) =>
    api.listEnvironments({ projectId }).then(setEnvs);

  useEffect(() => {
    if (open && activeProject) {
      setProject(activeProject);
      setNameDraft(activeProject.name);
      void api.listIgnoreRules({ projectId: activeProject.id }).then(setRules);
      void reloadEnvs(activeProject.id);
      setNewEnvConn(connections[0]?.id ?? null);
    }
  }, [open, activeProject, connections]);

  const addEnv = async () => {
    if (!project || !newEnvName.trim() || newEnvConn === null) return;
    await api.createEnvironment({
      input: {
        projectId: project.id,
        name: newEnvName.trim(),
        connectionId: newEnvConn,
        remotePath: newEnvPath,
        isDefault: false,
      },
    });
    setNewEnvName("");
    setNewEnvPath("");
    await reloadEnvs(project.id);
  };

  const removeEnv = async (id: number) => {
    await api.deleteEnvironment({ id });
    if (project) await reloadEnvs(project.id);
  };

  const makeDefault = async (env: Environment) => {
    if (!project) return;
    await api.updateEnvironment({ input: { ...env, isDefault: true }, id: env.id });
    for (const other of envs) {
      if (other.id !== env.id && other.isDefault) {
        await api.updateEnvironment({ input: { ...other, isDefault: false }, id: other.id });
      }
    }
    const updated = await api.updateProject({
      id: project.id,
      input: { ...project, defaultEnvironmentId: env.id },
    });
    setProject(updated);
    await refreshProjects();
    await reloadEnvs(project.id);
    await openProject(updated);
  };

  const save = async (next: Project) => {
    setProject(next);
    const { id, createdAt, updatedAt, ...input } = next;
    await api.updateProject({ id, input });
    await refreshProjects();
  };

  const changeFolder = async () => {
    if (!project) return;
    const picked = await api.pickDirectory({});
    if (!picked) return;
    const { id, createdAt, updatedAt, ...input } = { ...project, localPath: picked };
    const updated = await api.updateProject({ id, input });
    setProject(updated);
    await refreshProjects();
    await openProject(updated); // remap panes to the new local root
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
          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="behavior">Behavior</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="environments">Environments</TabsTrigger>
              <TabsTrigger value="ignore">Ignore rules</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="mt-3 grid gap-3">
              <div className="grid gap-1.5">
                <Label>Project name</Label>
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    const n = nameDraft.trim();
                    if (n && n !== project.name) void save({ ...project, name: n });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Local folder (mapped to the remote root)</Label>
                <div className="flex gap-1.5">
                  <Input readOnly value={project.localPath} />
                  <Button variant="outline" size="icon" onClick={() => void changeFolder()}>
                    <FolderSearch />
                  </Button>
                </div>
              </div>
            </TabsContent>

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

            <TabsContent value="environments" className="mt-3 grid gap-2">
              <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                {envs.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    No environments
                  </div>
                ) : (
                  envs.map((e) => {
                    const c = connections.find((x) => x.id === e.connectionId);
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 text-[12px] last:border-0"
                      >
                        <span className="font-medium">{e.name}</span>
                        {e.isDefault && <Badge variant="secondary">default</Badge>}
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {c?.name ?? "?"} · {e.remotePath || "/"}
                        </span>
                        {!e.isDefault && (
                          <Button variant="ghost" size="sm" onClick={() => void makeDefault(e)}>
                            Set default
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" onClick={() => void removeEnv(e.id)}>
                          <Trash2 />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                <Input
                  value={newEnvName}
                  onChange={(ev) => setNewEnvName(ev.target.value)}
                  placeholder="Name (e.g. staging)"
                />
                <Select
                  value={newEnvConn?.toString() ?? ""}
                  onValueChange={(v) => setNewEnvConn(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Server" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => void addEnv()}>
                  <Plus />
                </Button>
              </div>
              <Input
                value={newEnvPath}
                onChange={(ev) => setNewEnvPath(ev.target.value)}
                placeholder="Remote path for this environment"
              />
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
