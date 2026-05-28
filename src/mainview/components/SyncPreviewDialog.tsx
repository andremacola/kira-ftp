import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useUi } from "../ui-store";
import { formatBytes } from "../lib/utils";
import type { SyncPlanItem } from "@shared/domain";

function actionIcon(action: SyncPlanItem["action"]) {
  if (action === "upload") return <ArrowUp className="size-3.5 text-emerald-500" />;
  if (action === "download") return <ArrowDown className="size-3.5 text-sky-500" />;
  return <Trash2 className="size-3.5 text-destructive" />;
}

export function SyncPreviewDialog() {
  const cfg = useUi((s) => s.syncPreview);
  const close = useUi((s) => s.closeSyncPreview);

  const items = cfg?.plan.items ?? [];
  const deletes = items.filter((i) => i.action.startsWith("delete")).length;
  const transfers = items.length - deletes;

  const run = async () => {
    if (!cfg) return;
    await cfg.onRun();
    close();
  };

  return (
    <Dialog open={!!cfg} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Sync {cfg?.direction === "up" ? "Up — local → remote" : "Down — remote → local"}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Badge variant="secondary">{transfers} transfers</Badge>
            {deletes > 0 && <Badge variant="destructive">{deletes} deletes</Badge>}
            <span className="text-muted-foreground">{formatBytes(cfg?.plan.totalBytes ?? 0)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Already in sync — nothing to do.
            </div>
          ) : (
            items.map((item) => (
              <div
                key={`${item.action}:${item.path}`}
                className="flex items-center gap-2 border-b border-border/50 px-3 py-1 text-[12px] last:border-0"
              >
                {actionIcon(item.action)}
                <span className="min-w-0 flex-1 truncate">{item.path}</span>
                <span className="text-[11px] text-muted-foreground">{item.reason}</span>
                <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">
                  {item.action.startsWith("delete") ? "" : formatBytes(item.size)}
                </span>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={run} disabled={items.length === 0}>
            Run sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
