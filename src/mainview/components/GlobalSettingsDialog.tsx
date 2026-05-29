import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Switch } from "./ui/switch";
import { useUi } from "../ui-store";
import { api } from "../lib/rpc";

/** App-wide settings (not tied to any project). */
export function GlobalSettingsDialog() {
  const open = useUi((s) => s.globalSettingsOpen);
  const close = useUi((s) => s.closeGlobalSettings);
  const [dockVisible, setDockVisible] = useState(true);

  useEffect(() => {
    if (open) void api.getDockVisible({}).then(setDockVisible);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Application-wide preferences.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px]">Show icon in the Dock</div>
              <div className="text-[11px] text-muted-foreground">
                Turn off to run from the menu bar only.
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
      </DialogContent>
    </Dialog>
  );
}
