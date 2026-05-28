import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, FolderSearch } from "lucide-react";
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
import type { ConnectionInput, ConnectionType, AuthType } from "@shared/domain";

const defaults = (): ConnectionInput => ({
  name: "",
  type: "sftp",
  host: "",
  port: 22,
  user: "",
  authType: "key",
  sshKeyPath: null,
  password: null,
  remotePath: "",
  remoteEncoding: "utf-8",
  timeout: 30,
  keepalive: 0,
  ftpPassiveMode: true,
  sftpFlags: [],
});

export function ConnectionDialog() {
  const { open, editing } = useUi((s) => s.connectionDialog);
  const close = useUi((s) => s.closeConnectionDialog);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const [form, setForm] = useState<ConnectionInput>(defaults());
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    if (editing) {
      const { id, createdAt, updatedAt, ...rest } = editing;
      setForm(rest);
    } else {
      setForm(defaults());
    }
  }, [open, editing]);

  const set = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onTypeChange = (type: ConnectionType) =>
    setForm((f) => ({
      ...f,
      type,
      port: type === "sftp" ? 22 : 21,
      authType: type === "sftp" ? f.authType : "password",
    }));

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await api.testConnection({ input: form });
      setResult({ ok: r.ok, message: r.ok ? `Connected in ${r.latencyMs}ms` : r.message });
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (editing) await api.updateConnection({ id: editing.id, input: form });
    else await api.createConnection({ input: form });
    await refreshConnections();
    close();
  };

  const pickKey = async () => {
    const picked = await api.pickFile({});
    if (picked) set("sshKeyPath", picked);
  };

  const isSftp = form.type === "sftp";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit server" : "New server"}</DialogTitle>
          <DialogDescription>
            Connection details for SFTP, FTP or FTPS. Key auth uses your ~/.ssh keys by default.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="My server" />
          </Field>

          <Field label="Protocol">
            <Select value={form.type} onValueChange={(v) => onTypeChange(v as ConnectionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sftp">SFTP (SSH)</SelectItem>
                <SelectItem value="ftp">FTP</SelectItem>
                <SelectItem value="ftps">FTPS (TLS)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Port">
            <Input
              type="number"
              value={form.port}
              onChange={(e) => set("port", Number(e.target.value))}
            />
          </Field>

          <Field label="Host" className="col-span-2">
            <Input value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="example.com" />
          </Field>

          <Field label="User">
            <Input value={form.user} onChange={(e) => set("user", e.target.value)} />
          </Field>

          <Field label="Auth">
            <Select
              value={form.authType}
              onValueChange={(v) => set("authType", v as AuthType)}
              disabled={!isSftp}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isSftp && <SelectItem value="key">SSH key</SelectItem>}
                <SelectItem value="password">Password</SelectItem>
                {isSftp && <SelectItem value="agent">SSH agent</SelectItem>}
              </SelectContent>
            </Select>
          </Field>

          {form.authType === "key" && isSftp && (
            <Field label="Private key (blank = ~/.ssh)" className="col-span-2">
              <div className="flex gap-1.5">
                <Input
                  value={form.sshKeyPath ?? ""}
                  onChange={(e) => set("sshKeyPath", e.target.value || null)}
                  placeholder="~/.ssh/id_ed25519 (auto)"
                />
                <Button variant="outline" size="icon" onClick={pickKey}>
                  <FolderSearch />
                </Button>
              </div>
            </Field>
          )}

          {(form.authType === "password" || !isSftp) && (
            <Field label="Password" className="col-span-2">
              <Input
                type="password"
                value={form.password ?? ""}
                onChange={(e) => set("password", e.target.value || null)}
              />
            </Field>
          )}

          <Field label="Remote path" className="col-span-2">
            <Input
              value={form.remotePath}
              onChange={(e) => set("remotePath", e.target.value)}
              placeholder="/var/www/html"
            />
          </Field>
        </div>

        {result && (
          <div
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${
              result.ok ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
            }`}
          >
            {result.ok ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
            {result.message}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={test} disabled={testing || !form.host}>
            {testing ? <Loader2 className="animate-spin" /> : null}
            Test
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!form.host || !form.name}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
