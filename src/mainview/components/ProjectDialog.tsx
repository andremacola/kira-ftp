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
import { ConnectionFields, emptyConnection } from "./ConnectionFields";
import { useStore } from "../store";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";
import type { ConnectionFields as ConnFields } from "@shared/domain";

export function ProjectDialog() {
  const open = useUi((s) => s.projectDialog);
  const close = useUi((s) => s.closeProjectDialog);
  const refreshProjects = useStore((s) => s.refreshProjects);
  const openProject = useStore((s) => s.openProject);

  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [conn, setConn] = useState<ConnFields>(emptyConnection());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setLocalPath("");
      setConn(emptyConnection());
      setError(null);
    }
  }, [open]);

  const pickDir = async () => {
    const picked = await api.pickDirectory({});
    if (picked) {
      setLocalPath(picked);
      if (!name) setName(picked.split("/").pop() ?? "");
    }
  };

  const importConfig = async () => {
    setError(null);
    const target = await api.pickSftpConfig({});
    if (!target) return;
    try {
      const project = await api.importSublimeConfig({ localPath: target });
      await refreshProjects();
      close();
      await openProject(project);
    } catch (e) {
      setError(
        `Could not import: ${(e as Error).message}. Pick the sftp-config.json file or its folder.`,
      );
    }
  };

  const create = async () => {
    if (!name || !localPath || !conn.host) return;
    setSaving(true);
    setError(null);
    try {
      const project = await api.createFullProject({
        name,
        localPath,
        remotePath: conn.remotePath,
        connection: { ...conn, name },
      });
      await refreshProjects();
      close();
      await openProject(project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project maps a local folder to a server. Everything below is stored with
            this project. Or import an existing Sublime{" "}
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
            <Label>Project name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="h-px bg-border" />

          <ConnectionFields value={conn} onChange={setConn} />
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={importConfig}>
            <FileJson /> Import sftp-config.json
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!name || !localPath || !conn.host || saving}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
