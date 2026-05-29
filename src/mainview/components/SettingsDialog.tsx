import { useEffect, useState } from "react";
import { Plus, Trash2, FolderSearch, Loader2 } from "lucide-react";
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
import { ConnectionFields, emptyConnection } from "./ConnectionFields";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import type { ConnectionFields as ConnFields, IgnoreRule, Project } from "@shared/domain";

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
  const openProject = useStore((s) => s.openProject);

  const [project, setProject] = useState<Project | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [rules, setRules] = useState<IgnoreRule[]>([]);
  const [newPattern, setNewPattern] = useState("");

  const [envId, setEnvId] = useState<number | null>(null);
  const [conn, setConn] = useState<ConnFields>(emptyConnection());
  const [savingConn, setSavingConn] = useState(false);
  const [dockVisible, setDockVisible] = useState(true);

  useEffect(() => {
    if (!open) return;
    void api.getDockVisible({}).then(setDockVisible);
  }, [open]);

  useEffect(() => {
    if (!open || !activeProject) return;
    setProject(activeProject);
    setNameDraft(activeProject.name);
    void api.listIgnoreRules({ projectId: activeProject.id }).then(setRules);
    void (async () => {
      const envs = await api.listEnvironments({ projectId: activeProject.id });
      const env =
        envs.find((e) => e.id === activeProject.defaultEnvironmentId) ??
        envs.find((e) => e.isDefault) ??
        envs[0];
      if (!env) return;
      setEnvId(env.id);
      const c = await api.getConnection({ id: env.connectionId });
      if (c) {
        const { id, ownerProjectId, createdAt, updatedAt, ...fields } = c;
        // the project's remote root lives on the environment
        setConn({ ...fields, remotePath: env.remotePath });
      }
    })();
  }, [open, activeProject]);

  const saveProject = async (next: Project) => {
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
    await openProject(updated);
  };

  const saveConnection = async () => {
    if (!project || envId === null) return;
    setSavingConn(true);
    try {
      await api.updateEnvironmentFull({
        environmentId: envId,
        name: "default",
        isDefault: true,
        remotePath: conn.remotePath,
        connection: { ...conn, name: nameDraft || project.name },
      });
      await refreshProjects();
      const fresh = await api.getProject({ id: project.id });
      if (fresh) await openProject(fresh); // remap panes to the new remote root
    } finally {
      setSavingConn(false);
    }
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
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            {project ? project.name : "Open a project to edit its settings."}
          </DialogDescription>
        </DialogHeader>

        {project && (
          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="connection">Connection</TabsTrigger>
              <TabsTrigger value="behavior">Behavior</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
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
                    if (n && n !== project.name) void saveProject({ ...project, name: n });
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Local folder (mapped to the remote path)</Label>
                <div className="flex gap-1.5">
                  <Input readOnly value={project.localPath} />
                  <Button variant="outline" size="icon" onClick={() => void changeFolder()}>
                    <FolderSearch />
                  </Button>
                </div>
              </div>

              <div className="mt-1 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13px]">Show icon in the Dock</div>
                    <div className="text-[11px] text-muted-foreground">
                      Turn off to run from the menu bar only (app-wide).
                    </div>
                  </div>
                  <Switch
                    checked={dockVisible}
                    onCheckedChange={(v) => {
                      setDockVisible(v);
                      void api.setDockVisible({ visible: v });
                    }}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="connection" className="mt-3 grid gap-3">
              <ConnectionFields value={conn} onChange={setConn} />
              <div className="flex justify-end">
                <Button onClick={() => void saveConnection()} disabled={savingConn || !conn.host}>
                  {savingConn ? <Loader2 className="animate-spin" /> : null}
                  Save connection
                </Button>
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
                    onCheckedChange={(v) => void saveProject({ ...project, [t.key]: v })}
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
                  onChange={(e) => void saveProject({ ...project, filePermissions: e.target.value || null })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Directory permissions (octal)</Label>
                <Input
                  value={project.dirPermissions ?? ""}
                  placeholder="755"
                  onChange={(e) => void saveProject({ ...project, dirPermissions: e.target.value || null })}
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
