#!/usr/bin/env bun
/**
 * `kira` — external CLI to drive the running Kira FTP app from editors
 * (Sublime/VSCode/Zed keymaps). Resolves the project that owns a path inside
 * the app and triggers upload/download/sync. Talks to the app's local control
 * server; launches the app if it isn't running.
 *
 * Usage:
 *   kira upload   <path>
 *   kira download <path>
 *   kira sync-up  <path>
 *   kira sync-down <path>
 *   kira sync     <path>     (bidirectional)
 */
import { resolve } from "node:path";
import { CONTROL_PORT, readControlToken, type ControlAction } from "../core/control/server";

const BASE = `http://127.0.0.1:${CONTROL_PORT}`;

const ALIASES: Record<string, ControlAction> = {
  upload: "upload",
  up: "upload",
  download: "download",
  down: "download",
  "sync-up": "sync-up",
  push: "sync-up",
  "sync-down": "sync-down",
  pull: "sync-down",
  sync: "sync-both",
  "sync-both": "sync-both",
};

function usage(): never {
  console.error(
    "Usage: kira <upload|download|sync-up|sync-down|sync> <path>\n" +
      "Aliases: up, down, push (sync-up), pull (sync-down), sync (both)",
  );
  process.exit(2);
}

async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/ping`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Launch the app (.app bundle) and wait until its control server responds. */
async function launchApp(): Promise<boolean> {
  const appPath = process.env.KIRA_APP_PATH ?? "/Applications/Kira FTP.app";
  Bun.spawn(["open", "-g", appPath], { stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 40; i++) {
    if (await ping()) return true;
    await Bun.sleep(250);
  }
  return false;
}

async function main() {
  const [, , rawAction, rawPath] = process.argv;
  if (!rawAction || !rawPath) usage();
  const action = ALIASES[rawAction];
  if (!action) usage();

  const path = resolve(rawPath);

  if (!(await ping())) {
    process.stderr.write("Kira FTP is not running — launching…\n");
    if (!(await launchApp())) {
      console.error(
        "Could not reach Kira FTP. Set KIRA_APP_PATH to the .app if it's not in /Applications.",
      );
      process.exit(1);
    }
  }

  const token = readControlToken();
  if (!token) {
    console.error("Control token not found. Open Kira FTP once to initialize it.");
    process.exit(1);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kira-token": token },
      body: JSON.stringify({ action, path }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error(`Failed to reach Kira FTP: ${(e as Error).message}`);
    process.exit(1);
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
    project?: string;
  };
  if (!res.ok || !data.ok) {
    console.error(`Error: ${data.error ?? res.statusText}`);
    process.exit(1);
  }
  console.log(`✓ [${data.project}] ${data.message}`);
}

main();
