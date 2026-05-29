import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, FolderSearch } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { api } from "../lib/rpc";
import type { ConnectionFields as ConnFields, ConnectionType, AuthType } from "@shared/domain";

export const emptyConnection = (): ConnFields => ({
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

/** Reusable connection form (host/auth/remote path) + a Test button. */
export function ConnectionFields({
  value,
  onChange,
}: {
  value: ConnFields;
  onChange: (v: ConnFields) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const set = <K extends keyof ConnFields>(key: K, v: ConnFields[K]) =>
    onChange({ ...value, [key]: v });

  const onTypeChange = (type: ConnectionType) =>
    onChange({
      ...value,
      type,
      port: type === "sftp" ? 22 : 21,
      authType: type === "sftp" ? value.authType : "password",
    });

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await api.testConnection({ input: value });
      setResult({ ok: r.ok, message: r.ok ? `Connected in ${r.latencyMs}ms` : r.message });
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const pickKey = async () => {
    const picked = await api.pickFile({});
    if (picked) set("sshKeyPath", picked);
  };

  const isSftp = value.type === "sftp";

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <Field label="Protocol">
          <Select value={value.type} onValueChange={(v) => onTypeChange(v as ConnectionType)}>
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
          <Input type="number" value={value.port} onChange={(e) => set("port", Number(e.target.value))} />
        </Field>
      </div>

      <Field label="Host">
        <Input value={value.host} onChange={(e) => set("host", e.target.value)} placeholder="example.com" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="User">
          <Input value={value.user} onChange={(e) => set("user", e.target.value)} />
        </Field>
        <Field label="Auth">
          <Select value={value.authType} onValueChange={(v) => set("authType", v as AuthType)} disabled={!isSftp}>
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
      </div>

      {value.authType === "key" && isSftp && (
        <Field label="Private key (blank = ~/.ssh)">
          <div className="flex gap-1.5">
            <Input
              value={value.sshKeyPath ?? ""}
              onChange={(e) => set("sshKeyPath", e.target.value || null)}
              placeholder="~/.ssh/id_ed25519 (auto)"
            />
            <Button variant="outline" size="icon" onClick={pickKey}>
              <FolderSearch />
            </Button>
          </div>
        </Field>
      )}

      {(value.authType === "password" || !isSftp) && (
        <Field label="Password">
          <Input
            type="password"
            value={value.password ?? ""}
            onChange={(e) => set("password", e.target.value || null)}
          />
        </Field>
      )}

      <Field label="Remote path (mapped to the local folder)">
        <Input value={value.remotePath} onChange={(e) => set("remotePath", e.target.value)} placeholder="/var/www/html" />
      </Field>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={test} disabled={testing || !value.host}>
          {testing ? <Loader2 className="animate-spin" /> : null}
          Test connection
        </Button>
        {result && (
          <span
            className={`flex items-center gap-1.5 text-xs ${
              result.ok ? "text-emerald-500" : "text-destructive"
            }`}
          >
            {result.ok ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
            {result.message}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
