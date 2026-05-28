/**
 * Webview RPC client. Exposes a typed `api` of all Bun request handlers and a
 * typed `onMessage` for events pushed from the main process.
 */
import { Electroview } from "electrobun/view";
import type { KiraRPC } from "@shared/rpc";

type WebviewMessages = KiraRPC["webview"] extends { messages: infer M } ? M : never;

type MessageListener<K extends keyof WebviewMessages> = (
  payload: WebviewMessages[K],
) => void;

const listeners = new Map<string, Set<(payload: unknown) => void>>();

function emit(name: string, payload: unknown): void {
  listeners.get(name)?.forEach((l) => l(payload));
}

/** Subscribe to a main-process message; returns an unsubscribe function. */
export function onMessage<K extends keyof WebviewMessages & string>(
  name: K,
  cb: MessageListener<K>,
): () => void {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  const wrapped = cb as (payload: unknown) => void;
  set.add(wrapped);
  return () => set!.delete(wrapped);
}

const rpc = Electroview.defineRPC<KiraRPC>({
  maxRequestTime: 600000,
  handlers: {
    requests: {},
    messages: {
      transferUpdate: (p) => emit("transferUpdate", p),
      transferDone: (p) => emit("transferDone", p),
      transferError: (p) => emit("transferError", p),
      connectionState: (p) => emit("connectionState", p),
      watchEvent: (p) => emit("watchEvent", p),
      log: (p) => emit("log", p),
    },
  },
});

const electroview = new Electroview({ rpc });

/** Typed map of all Bun request handlers: api.listConnections({}) etc. */
export const api = electroview.rpc!.request;
