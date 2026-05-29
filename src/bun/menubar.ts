/**
 * Menubar (tray) presence + activity animation + completion notifications, and
 * the show-in-dock toggle. Lives in the Electrobun layer because it drives the
 * native Tray/Utils APIs; it observes the core EventBus for transfer activity.
 */
import { Tray, Utils } from "electrobun/bun";
import type { AppContext } from "../core/app-context";
import type { TransferJob } from "../shared/domain";

const DOCK_VISIBLE_KEY = "dockVisible";
const ICON = "views://mainview/menubar-idle.png";
/** Title-based pulse frames shown while transfers run (template image stays). */
const PULSE = ["􀈋", "↑", "↕", "↓"]; // simple ascii spinner-ish; cycles
const PULSE_MS = 220;

export class MenubarManager {
  private tray: Tray | null = null;
  private active = new Map<string, TransferJob>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;

  constructor(
    private ctx: AppContext,
    /** Called when the user picks "Open" from the tray menu. */
    private onOpen: () => void,
    /** Called when the user picks "Quit". */
    private onQuit: () => void,
  ) {}

  /** Create the tray and apply the persisted dock-visibility preference. */
  init(): void {
    this.applyDockPreference();
    try {
      this.tray = new Tray({ title: "", image: ICON, template: true });
      this.tray.setMenu(this.menu());
      this.tray.on("tray-clicked", () => this.onOpen());
    } catch {
      this.tray = null; // tray unavailable (rare) — app still works
    }

    this.ctx.bus.on("transfer:update", (job) => this.track(job));
    this.ctx.bus.on("transfer:done", (job) => this.complete(job));
  }

  private menu() {
    return [
      { type: "normal" as const, label: "Open Kira FTP", action: "open" },
      { type: "divider" as const },
      { type: "normal" as const, label: "Quit", role: "quit" },
    ];
  }

  /** Whether the dock icon should be shown (persisted, default true). */
  isDockVisible(): boolean {
    return this.ctx.settings.getBool(DOCK_VISIBLE_KEY, true);
  }

  setDockVisible(visible: boolean): void {
    this.ctx.settings.setBool(DOCK_VISIBLE_KEY, visible);
    this.applyDockPreference();
  }

  private applyDockPreference(): void {
    try {
      Utils.setDockIconVisible(this.isDockVisible());
    } catch {
      /* not supported -> ignore */
    }
  }

  /* ----------------------------- activity ------------------------------- */

  private track(job: TransferJob): void {
    if (job.status === "running" || job.status === "queued") {
      this.active.set(job.id, job);
    } else {
      this.active.delete(job.id);
    }
    this.refreshAnimation();
  }

  private complete(job: TransferJob): void {
    this.active.delete(job.id);
    this.refreshAnimation();
    if (job.status === "done") {
      Utils.showNotification({
        title: "Kira FTP",
        body: `${labelFor(job)} finished`,
        silent: false,
      });
    } else if (job.status === "error") {
      Utils.showNotification({
        title: "Kira FTP — transfer failed",
        body: job.error ?? labelFor(job),
        silent: false,
      });
    }
  }

  private refreshAnimation(): void {
    const busy = this.active.size > 0;
    if (busy && !this.timer) {
      this.timer = setInterval(() => this.tick(), PULSE_MS);
    } else if (!busy && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.frame = 0;
      this.tray?.setTitle("");
    }
  }

  private tick(): void {
    if (!this.tray) return;
    this.frame = (this.frame + 1) % PULSE.length;
    const n = this.active.size;
    this.tray.setTitle(` ${PULSE[this.frame]}${n > 1 ? ` ${n}` : ""}`);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.tray?.remove();
    this.tray = null;
  }
}

function labelFor(job: TransferJob): string {
  switch (job.kind) {
    case "upload":
    case "upload-folder":
      return "Upload";
    case "download":
    case "download-folder":
      return "Download";
    case "sync-up":
      return "Sync up";
    case "sync-down":
      return "Sync down";
    case "sync-both":
      return "Sync";
    default:
      return "Transfer";
  }
}
