import { useEffect, useState } from "react";
import { FolderSearch, FileJson } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";

export function ProjectDialog() {
  const open = useUi((s) => s.projectDialog);
  const close = useUi((s) => s.closeProjectDialog);
  const openConnectionDialog = useUi((s) => s.openConnectionDialog);
  const connections = useStore((s) => s.connections);
  const refreshProjects = useStore((s) => s.refreshProjects);
  const openProject = useStore((s) => s.openProject);

  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [remotePath, setRemotePath] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setLocalPath("");
      setConnectionId(connections[0]?.id ?? null);
      setRemotePath(connections[0]?.remotePath ?? "");
    }
  }, [open, connections]);

  const pickDir = async () => {
    const picked = await api.pickDirectory({});
    if (picked) {
      setLocalPath(picked);
      if (!name) setName(picked.split("/").pop() ?? "");
    }
  };

  const importConfig = async () => {
    const dir = await api.pickDirectory({});
    if (!dir) return;
    const project = await api.importSublimeConfig({ localPath: dir });
    await Promise.all([refreshProjects(), useStore.getState().refreshConnections()]);
    close();
    await openProject(project);
  };

  const create = async () => {
    if (!name || !localPath || connectionId === null) return;
    const project = await api.createProject({
      input: {
        name,
        localPath,
        defaultEnvironmentId: null,
        uploadOnSave: true,
        saveBeforeUpload: true,
        watchEnabled: false,
        confirmOverwriteNewer: false,
        confirmSync: true,
        confirmDownloads: false,
        syncDownOnOpen: false,
        syncSkipDeletes: false,
        syncSameAge: false,
        filePermissions: null,
        dirPermissions: null,
        allowConfigUpload: false,
      },
    });
    const env = await api.createEnvironment({
      input: {
        projectId: project.id,
        name: "default",
        connectionId,
        remotePath,
        isDefault: true,
      },
    });
    const updated = await api.updateProject({
      id: project.id,
      input: { ...project, defaultEnvironmentId: env.id },
    });
    await refreshProjects();
    close();
    await openProject(updated);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Map a local folder to a server. Or import an existing Sublime{" "}
            <code className="text-foreground">sftp-config.json</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Local folder</Label>
            <div className="flex gap-1.5">
              <Input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/Users/you/site" />
              <Button variant="outline" size="icon" onClick={pickDir}>
                <FolderSearch />
              </Button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label>Server</Label>
            {connections.length === 0 ? (
              <Button variant="outline" onClick={() => openConnectionDialog(null)}>
                Create a server first…
              </Button>
            ) : (
              <Select
                value={connectionId?.toString() ?? ""}
                onValueChange={(v) => {
                  const id = Number(v);
                  setConnectionId(id);
                  const c = connections.find((x) => x.id === id);
                  if (c) setRemotePath(c.remotePath);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select server" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name} ({c.host})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Remote path</Label>
            <Input value={remotePath} onChange={(e) => setRemotePath(e.target.value)} placeholder="/var/www/html" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={importConfig}>
            <FileJson /> Import sftp-config.json
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!name || !localPath || connectionId === null}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
