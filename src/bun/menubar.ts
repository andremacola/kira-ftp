/**
 * Menubar (tray) presence + activity animation + completion notifications, and
 * the show-in-dock toggle. Lives in the Electrobun layer because it drives the
 * native Tray/Utils APIs; it observes the core EventBus for transfer activity.
 *
 * The activity indicator animates the *image* of a single tray icon (swapping
 * spinner frames) — never the title — so the menu bar item never grows/jumps.
 */
import { Tray, Utils } from "electrobun/bun";
import type { AppContext } from "../core/app-context";
import type { TransferJob } from "../shared/domain";

const NOTIFY_SOUND_KEY = "notifySound";

const IDLE_ICON = "views://mainview/menubar/idle.png";
const SPIN_FRAMES = 8;
const spinIcon = (f: number) => `views://mainview/menubar/spin-${f}.png`;
const FRAME_MS = 110;

export class MenubarManager {
  private tray: Tray | null = null;
  private active = new Map<string, TransferJob>();
  /** Interactive remote ops in flight (list/stat/mkdir/rename/edit/…). */
  private remoteBusy = false;
  private remoteOffTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;

  constructor(
    private ctx: AppContext,
    /** Called when the user picks "Open" from the tray menu. */
    private onOpen: () => void,
    /** Called when the user picks "Quit". */
    private onQuit: () => void,
  ) {}

  /** Subscribe to activity events. The tray itself is added via setVisible(). */
  init(): void {
    this.ctx.bus.on("transfer:update", (job) => this.track(job));
    this.ctx.bus.on("transfer:done", (job) => this.complete(job));
    this.ctx.bus.on("notify", ({ title, body }) =>
      Utils.showNotification({ title, body, silent: !this.isNotifySound() }),
    );
    this.ctx.bus.on("remote:activity", ({ busy }) => {
      if (busy) {
        if (this.remoteOffTimer) {
          clearTimeout(this.remoteOffTimer);
          this.remoteOffTimer = null;
        }
        this.remoteBusy = true;
        this.refreshAnimation();
      } else {
        // brief hold so fast back-to-back ops don't flicker the icon
        if (this.remoteOffTimer) clearTimeout(this.remoteOffTimer);
        this.remoteOffTimer = setTimeout(() => {
          this.remoteBusy = false;
          this.remoteOffTimer = null;
          this.refreshAnimation();
        }, 300);
      }
    });
  }

  /** Add or remove the tray icon (driven by the "Show in menu bar" setting). */
  setVisible(visible: boolean): void {
    if (visible) {
      this.createTray();
    } else {
      this.tray?.remove();
      this.tray = null;
    }
  }

  private createTray(): void {
    if (this.tray) return;
    try {
      // Icons are 36px @144dpi = 18pt intrinsic. setTrayImage carries no size,
      // so the intrinsic point-size must match this; keep createTray at 18 too.
      this.tray = new Tray({ image: IDLE_ICON, template: true, width: 18, height: 18 });
      this.tray.setMenu(this.menu());
      // The clicked menu item's action arrives as e.data.action (per Electrobun
      // docs); an empty string means the tray icon itself was clicked.
      this.tray.on("tray-clicked", (e) => {
        const action = (e as { data?: { action?: string } } | undefined)?.data?.action;
        if (action === "quit") this.onQuit();
        else if (action === "rmate-toggle") {
          this.ctx.rmate.setEnabled(!this.ctx.rmate.isRunning());
          this.tray?.setMenu(this.menu()); // refresh the label
        } else this.onOpen();
      });
    } catch {
      this.tray = null; // tray unavailable (rare) — app still works
    }
  }

  private menu() {
    // Tray menus dispatch via `action` (the click handler reads it); `role` is
    // not honored on tray items, so Quit uses an action we handle ourselves.
    const rmateOn = this.ctx.rmate.isRunning();
    return [
      { type: "normal" as const, label: "Open Kira FTP", action: "open" },
      { type: "divider" as const },
      {
        type: "normal" as const,
        label: rmateOn ? "Stop rmate server" : "Start rmate server",
        action: "rmate-toggle",
      },
      { type: "divider" as const },
      { type: "normal" as const, label: "Quit Kira FTP", action: "quit" },
    ];
  }

  /** Whether completion notifications play a sound (persisted, default true). */
  isNotifySound(): boolean {
    return this.ctx.settings.getBool(NOTIFY_SOUND_KEY, true);
  }
  setNotifySound(on: boolean): void {
    this.ctx.settings.setBool(NOTIFY_SOUND_KEY, on);
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
    const silent = !this.isNotifySound();
    if (job.status === "done") {
      Utils.showNotification({ title: "Kira FTP", body: `${labelFor(job)} finished`, silent });
    } else if (job.status === "error") {
      Utils.showNotification({
        title: "Kira FTP — transfer failed",
        body: job.error ?? labelFor(job),
        silent,
      });
    }
  }

  private refreshAnimation(): void {
    const busy = this.active.size > 0 || this.remoteBusy;
    if (busy && !this.timer) {
      this.frame = 0;
      this.timer = setInterval(() => this.tick(), FRAME_MS);
    } else if (!busy && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.tray?.setImage(IDLE_ICON); // back to the resting glyph
    }
  }

  private tick(): void {
    if (!this.tray) return;
    this.frame = (this.frame + 1) % SPIN_FRAMES;
    this.tray.setImage(spinIcon(this.frame));
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.remoteOffTimer) clearTimeout(this.remoteOffTimer);
    this.timer = null;
    this.remoteOffTimer = null;
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
