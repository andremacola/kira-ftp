import { useState } from "react";
import { ChevronUp, ChevronDown, X, Trash2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Badge } from "./ui/badge";
import { useStore } from "../store";
import { cn, formatBytes, formatSpeed } from "../lib/utils";
import type { TransferJob, TransferStatus } from "@shared/domain";

export function TransferDock() {
  const transfers = useStore((s) => s.transfers);
  const logs = useStore((s) => s.logs);
  const cancelTransfer = useStore((s) => s.cancelTransfer);
  const clearFinished = useStore((s) => s.clearFinished);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"transfers" | "log">("transfers");

  const active = transfers.filter((t) => t.status === "running" || t.status === "queued").length;

  return (
    <div className="shrink-0 border-t border-border bg-sidebar">
      <div className="flex h-8 items-center gap-2 px-3">
        <button
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wider",
            tab === "transfers" ? "text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            setTab("transfers");
            setOpen(true);
          }}
        >
          Transfers {active > 0 && <Badge variant="secondary" className="ml-1">{active}</Badge>}
        </button>
        <button
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wider",
            tab === "log" ? "text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            setTab("log");
            setOpen(true);
          }}
        >
          Log
        </button>
        <div className="ml-auto flex items-center gap-1">
          {tab === "transfers" && (
            <Button variant="ghost" size="icon-sm" onClick={() => void clearFinished()}>
              <Trash2 />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown /> : <ChevronUp />}
          </Button>
        </div>
      </div>

      {open && (
        <div className="h-40 overflow-y-auto border-t border-border bg-background px-2 py-1">
          {tab === "transfers" ? (
            transfers.length === 0 ? (
              <Empty label="No transfers" />
            ) : (
              transfers.map((job) => (
                <TransferRow key={job.id} job={job} onCancel={() => void cancelTransfer(job.id)} />
              ))
            )
          ) : logs.length === 0 ? (
            <Empty label="No log output" />
          ) : (
            <div className="font-mono text-[11px] leading-relaxed">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    l.level === "error" && "text-destructive",
                    l.level === "warn" && "text-amber-500",
                    l.level === "debug" && "text-muted-foreground",
                  )}
                >
                  {l.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TransferRow({ job, onCancel }: { job: TransferJob; onCancel: () => void }) {
  const running = job.status === "running" || job.status === "queued";
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/40">
      <StatusIcon status={job.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px]">{job.label}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {job.bytesTotal > 0 && `${formatBytes(job.bytesDone)} / ${formatBytes(job.bytesTotal)}`}
            {job.speed > 0 && ` · ${formatSpeed(job.speed)}`}
          </span>
        </div>
        {running && <Progress value={job.progress} className="mt-1" />}
        {job.error && <div className="mt-0.5 truncate text-[11px] text-destructive">{job.error}</div>}
      </div>
      {running && (
        <Button variant="ghost" size="icon-sm" onClick={onCancel}>
          <X />
        </Button>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: TransferStatus }) {
  if (status === "done") return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />;
  if (status === "error") return <AlertCircle className="size-4 shrink-0 text-destructive" />;
  if (status === "cancelled") return <X className="size-4 shrink-0 text-muted-foreground" />;
  return <Loader2 className="size-4 shrink-0 animate-spin text-sky-500" />;
}

function Empty({ label }: { label: string }) {
  return <div className="grid h-full place-items-center text-xs text-muted-foreground">{label}</div>;
}
