/**
 * Typed event bus used by services to push updates that the RPC layer relays
 * to the React view as fire-and-forget messages.
 */
import type {
  ConnectionState,
  LogLine,
  TransferJob,
} from "../shared/domain";

export interface AppEvents {
  "transfer:update": TransferJob;
  "transfer:done": TransferJob;
  "transfer:error": { jobId: string; error: string };
  "connection:state": { connectionId: number; state: ConnectionState };
  "watch:event": { projectId: number; path: string; action: "upload" | "skip" };
  /** True when any interactive remote op (list/stat/mkdir/…) is in flight. */
  "remote:activity": { busy: boolean };
  /** Request a desktop notification (e.g. a CLI command with no project). */
  notify: { title: string; body: string };
  log: LogLine;
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof AppEvents, Set<Handler<unknown>>>();

  on<K extends keyof AppEvents>(event: K, handler: Handler<AppEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => set!.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // copy so a handler that unsubscribes during emit can't break iteration
    for (const h of [...set]) (h as Handler<AppEvents[K]>)(payload);
  }
}
