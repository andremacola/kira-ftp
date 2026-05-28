/**
 * Shared SSH key discovery. Like Sublime SFTP, when no key is configured we
 * fall back to the user's existing ~/.ssh keys. Used by both the ssh2 backend
 * and the rclone backend so they authenticate identically.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export const DEFAULT_KEY_NAMES = ["id_ed25519", "id_ecdsa", "id_rsa"];

/** First existing default key under ~/.ssh, or null. */
export function defaultKeyPath(): string | null {
  for (const name of DEFAULT_KEY_NAMES) {
    const p = `${homedir()}/.ssh/${name}`;
    if (existsSync(p)) return p;
  }
  return null;
}

/** Resolve an explicit key path if it exists, else a default ~/.ssh key. */
export function resolveKeyPath(explicit: string | null): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  return defaultKeyPath();
}
