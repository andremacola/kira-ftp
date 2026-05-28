/**
 * App data locations. Kept framework-agnostic (derived from os.homedir) so the
 * core doesn't depend on Electrobun; the main process may override via env.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR_NAME = "kira-ftp";

/** Root directory for app data (macOS: ~/Library/Application Support/kira-ftp). */
export function appDataDir(): string {
  if (process.env.KIRA_DATA_DIR) return process.env.KIRA_DATA_DIR;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_DIR_NAME);
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_DIR_NAME);
}

/** Absolute path to the SQLite database file. */
export function databasePath(): string {
  return join(appDataDir(), "kira.sqlite");
}
