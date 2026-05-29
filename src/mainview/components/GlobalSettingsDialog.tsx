import { useEffect, useState } from "react";
import { ScrollText, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Switch } from "./ui/switch";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";

/** App-wide settings (not tied to any project). */
export function GlobalSettingsDialog() {
  const open = useUi((s) => s.globalSettingsOpen);
  const close = useUi((s) => s.closeGlobalSettings);

  const focusLog = useUi((s) => s.focusLog);
  const closeGlobal = useUi((s) => s.closeGlobalSettings);

  const [menuBar, setMenuBar] = useState(true);
  const [notifySound, setNotifySound] = useState(true);
  const [port, setPort] = useState("8911");
  const [portError, setPortError] = useState<string | null>(null);
  const [portSaved, setPortSaved] = useState(false);
  const [status, setStatus] = useState<
    { state: "active" | "stopped" | "failed"; port: number; error: string | null } | null
  >(null);
  const [editors, setEditors] = useState<
    Array<{ id: string; name: string; detected: boolean; installed: boolean }>
  >([]);
  const [editorMsg, setEditorMsg] = useState<Record<string, string>>({});
  const [cli, setCli] = useState<{ installed: boolean; path: string | null }>({
    installed: false,
    path: null,
  });
  const [cliTargets, setCliTargets] = useState<
    Array<{ id: string; dir: string; label: string; needsSudo: boolean }>
  >([]);
  const [cliTarget, setCliTarget] = useState("local");
  const [cliMsg, setCliMsg] = useState<string | null>(null);
  const [rmate, setRmate] = useState<{
    state: "running" | "stopped" | "failed";
    bind: string;
    editor: string;
    error: string | null;
  } | null>(null);
  const [rmateEditors, setRmateEditors] = useState<
    Array<{ id: string; name: string; detected: boolean }>
  >([]);

  const refreshStatus = () => api.getControlStatus({}).then(setStatus);
  const refreshEditors = () => api.editorStatus({}).then(setEditors);
  const refreshCli = () => api.cliStatus({}).then(setCli);
  const refreshRmate = () => api.rmateStatus({}).then(setRmate);

  useEffect(() => {
    if (!open) return;
    void api.getShowInMenuBar({}).then(setMenuBar);
    void api.getNotifySound({}).then(setNotifySound);
    void api.getControlPort({}).then((p) => setPort(String(p)));
    void refreshStatus();
    void refreshEditors();
    void refreshCli();
    void api.cliTargets({}).then(setCliTargets);
    void refreshRmate();
    void api.rmateEditors({}).then(setRmateEditors);
    setEditorMsg({});
    setCliMsg(null);
    setPortError(null);
    setPortSaved(false);
  }, [open]);

  const installCli = async () => {
    setCliMsg(null);
    try {
      const res = await api.installCli({ target: cliTarget });
      if (res.cancelled) {
        setCliMsg("Cancelled");
        return;
      }
      setCliMsg(res.message);
      await Promise.all([refreshCli(), refreshEditors()]);
    } catch (e) {
      setCliMsg(`Failed: ${(e as Error).message}`);
    }
  };

  const toggleRmate = async (on: boolean) => {
    const s = await api.rmateSetEnabled({ on });
    setRmate(s);
  };
  const changeRmateEditor = async (editor: string) => {
    const s = await api.rmateSetEditor({ editor });
    setRmate(s);
  };

  const installEditor = async (id: string) => {
    try {
      const res = await api.installEditorIntegration({ id });
      setEditorMsg((m) => ({ ...m, [id]: res.message }));
    } catch (e) {
      setEditorMsg((m) => ({ ...m, [id]: `Failed: ${(e as Error).message}` }));
    }
    await refreshEditors();
  };

  const savePort = async () => {
    setPortError(null);
    setPortSaved(false);
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      setPortError("Port must be between 1024 and 65535");
      return;
    }
    const res = await api.setControlPort({ port: n });
    if (res.ok) {
      setPortSaved(true);
      void refreshStatus();
    } else setPortError(res.error ?? "Invalid port");
  };

  const STATUS_META = {
    active: { label: "Active", dot: "bg-emerald-500", text: "text-emerald-500" },
    stopped: { label: "Stopped", dot: "bg-muted-foreground", text: "text-muted-foreground" },
    failed: { label: "Failed", dot: "bg-destructive", text: "text-destructive" },
  } as const;
  const statusMeta = (s: string) =>
    STATUS_META[s as keyof typeof STATUS_META] ?? STATUS_META.stopped;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Application-wide preferences.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4">
          <Row
            title="Show in menu bar"
            hint="On: closing the window keeps Kira FTP in the menu bar. Off: closing the window quits the app."
          >
            <Switch
              checked={menuBar}
              onCheckedChange={(v) => {
                setMenuBar(v);
                void api.setShowInMenuBar({ on: v });
              }}
            />
          </Row>

          <Row title="Play sound on notifications" hint="Sound when a transfer finishes or fails.">
            <Switch
              checked={notifySound}
              onCheckedChange={(v) => {
                setNotifySound(v);
                void api.setNotifySound({ on: v });
              }}
            />
          </Row>

          <div className="border-t border-border pt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <Label>CLI control server</Label>
              {status && (
                <span className={`flex items-center gap-1.5 text-xs ${statusMeta(status.state).text}`}>
                  <span className={`size-2 rounded-full ${statusMeta(status.state).dot}`} />
                  {statusMeta(status.state).label}
                  {status.state === "active" && (
                    <span className="text-muted-foreground">· 127.0.0.1:{status.port}</span>
                  )}
                </span>
              )}
            </div>
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              Local server the <code>kira-ftp</code> CLI talks to (editor integrations).
              Changing the port restarts it.
            </p>
            {status?.state === "failed" && status.error && (
              <p className="mb-1.5 rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                {status.error}
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <Input
                value={port}
                onChange={(e) => {
                  setPort(e.target.value.replace(/[^0-9]/g, ""));
                  setPortSaved(false);
                }}
                className="w-28"
                inputMode="numeric"
              />
              <Button variant="outline" size="sm" onClick={() => void savePort()}>
                Apply
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  focusLog();
                  closeGlobal();
                }}
              >
                <ScrollText className="size-3.5" /> View logs
              </Button>
              {portSaved && <span className="text-xs text-emerald-500">Saved</span>}
              {portError && <span className="text-xs text-destructive">{portError}</span>}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label>Command-line tool (kira-ftp)</Label>
              {cli.installed && (
                <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-500">
                  <Check className="size-3.5" /> Installed
                </span>
              )}
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              A small <code>kira-ftp</code> script editors call to upload/download/sync the
              current file. Choose where to install it (both are on your PATH).
            </p>
            {cli.installed && cli.path && (
              <p className="mb-1.5 truncate font-mono text-[11px] text-muted-foreground" title={cli.path}>
                {cli.path}
              </p>
            )}
            <div className="flex min-w-0 items-center gap-2">
              <Select value={cliTarget} onValueChange={setCliTarget}>
                <SelectTrigger className="h-8 w-44 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cliTargets.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                      {t.needsSudo ? " (admin)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => void installCli()}>
                {cli.installed ? "Reinstall" : "Install"}
              </Button>
              {cliMsg && (
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={cliMsg}>
                  {cliMsg}
                </span>
              )}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <Label>Editor integration</Label>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Install shortcuts that call the <code>kira-ftp</code> CLI to upload/download/sync
              the current file. Install the CLI above first.
            </p>
            <div className="grid gap-1.5">
              {editors.map((ed) => (
                <div key={ed.id} className="flex min-w-0 items-center gap-2">
                  <span className="flex w-32 shrink-0 items-center gap-1.5 text-[13px]">
                    {ed.name}
                    {!ed.detected && (
                      <span className="text-[10px] text-muted-foreground">(not found)</span>
                    )}
                  </span>
                  {ed.installed ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-500">
                      <Check className="size-3.5" /> Installed
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={!ed.detected}
                      onClick={() => void installEditor(ed.id)}
                    >
                      Install
                    </Button>
                  )}
                  {editorMsg[ed.id] && (
                    <span
                      className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                      title={editorMsg[ed.id]}
                    >
                      {editorMsg[ed.id]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label>Remote editing (rmate)</Label>
              {rmate && (
                <span
                  className={`flex items-center gap-1.5 text-xs ${statusMeta(
                    rmate.state === "running" ? "active" : rmate.state,
                  ).text}`}
                >
                  <span
                    className={`size-2 rounded-full ${statusMeta(
                      rmate.state === "running" ? "active" : rmate.state,
                    ).dot}`}
                  />
                  {rmate.state === "running" ? `Listening on ${rmate.bind}` : rmate.state}
                </span>
              )}
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Run <code>rmate &lt;file&gt;</code> on a server (over{" "}
              <code>ssh -R 52698:localhost:52698</code>) to open it in your local editor and
              save it back.
            </p>
            {rmate?.state === "failed" && rmate.error && (
              <p className="mb-1.5 rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                {rmate.error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[13px]">Enable rmate server</span>
              <Switch
                checked={rmate?.state === "running"}
                onCheckedChange={(v) => void toggleRmate(v)}
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="w-24 text-[13px] text-muted-foreground">Open in</span>
              <Select value={rmate?.editor ?? "zed"} onValueChange={(v) => void changeRmateEditor(v)}>
                <SelectTrigger className="h-8 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rmateEditors.map((e) => (
                    <SelectItem key={e.id} value={e.id} disabled={!e.detected}>
                      {e.name}
                      {!e.detected ? " (not found)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[13px]">{title}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  );
}
