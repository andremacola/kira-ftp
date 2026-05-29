/**
 * Import a Sublime SFTP `sftp-config.json` into our data model. Pure parsing:
 * returns structured inputs; persistence/orchestration happens in AppContext.
 */
import { basename } from "node:path";
import type {
  ConnectionFields,
  ProjectInput,
} from "../../shared/domain";

/** Subset of Sublime SFTP config keys we understand. */
interface SublimeConfig {
  type?: string;
  host?: string;
  user?: string;
  password?: string;
  port?: number;
  remote_path?: string;
  ssh_key_file?: string;
  sftp_flags?: string[] | string;
  connect_timeout?: number;
  keepalive?: number;
  ftp_passive_mode?: boolean;
  remote_time_offset_in_hours?: number;
  enc?: string;
  upload_on_save?: boolean;
  save_before_upload?: boolean;
  confirm_sync?: boolean;
  confirm_downloads?: boolean;
  confirm_overwrite_newer?: boolean;
  sync_down_on_open?: boolean;
  sync_skip_deletes?: boolean;
  sync_same_age?: boolean;
  file_permissions?: string;
  dir_permissions?: string;
  allow_config_upload?: boolean;
  ignore_regexes?: string[];
}

export interface ImportResult {
  connection: ConnectionFields;
  project: Omit<ProjectInput, "defaultEnvironmentId">;
  remotePath: string;
  ignorePatterns: string[];
}

function pick<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/**
 * Parse JSONC: Sublime's sftp-config.json allows `//` and block comments plus
 * trailing commas. We strip comments with a string-aware scan (so `//` or `*​/`
 * inside string values are preserved), then drop trailing commas.
 */
function parseJsonc(input: string): unknown {
  const text = input.replace(/^﻿/, ""); // strip BOM
  let out = "";
  let inStr = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const n = text[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? ""; // keep escaped char verbatim
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && n === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  // drop trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(out);
}

export function parseSublimeConfig(text: string, localPath: string): ImportResult {
  const cfg = parseJsonc(text) as SublimeConfig;

  const type = (cfg.type === "ftp" || cfg.type === "ftps" ? cfg.type : "sftp") as
    | "sftp"
    | "ftp"
    | "ftps";
  const defaultPort = type === "sftp" ? 22 : 21;
  const name = basename(localPath) || cfg.host || "Imported";
  const flags = Array.isArray(cfg.sftp_flags)
    ? cfg.sftp_flags
    : typeof cfg.sftp_flags === "string"
      ? cfg.sftp_flags.split(/\s+/).filter(Boolean)
      : [];

  const connection: ConnectionFields = {
    name,
    type,
    host: cfg.host ?? "",
    port: pick(cfg.port, defaultPort),
    user: cfg.user ?? "",
    // FTP/FTPS only support password auth; key/agent are SFTP-only.
    authType:
      type !== "sftp" ? "password" : cfg.ssh_key_file ? "key" : cfg.password ? "password" : "key",
    sshKeyPath: cfg.ssh_key_file ?? null,
    password: cfg.password ?? null,
    remotePath: cfg.remote_path ?? "",
    remoteEncoding: cfg.enc ?? "utf-8",
    timeout: pick(cfg.connect_timeout, 30),
    keepalive: pick(cfg.keepalive, 0),
    ftpPassiveMode: pick(cfg.ftp_passive_mode, true),
    sftpFlags: flags,
  };

  const project: Omit<ProjectInput, "defaultEnvironmentId"> = {
    name,
    localPath,
    uploadOnSave: pick(cfg.upload_on_save, true),
    saveBeforeUpload: pick(cfg.save_before_upload, true),
    watchEnabled: false,
    confirmOverwriteNewer: pick(cfg.confirm_overwrite_newer, false),
    confirmSync: pick(cfg.confirm_sync, true),
    confirmDownloads: pick(cfg.confirm_downloads, false),
    syncDownOnOpen: pick(cfg.sync_down_on_open, false),
    syncSkipDeletes: pick(cfg.sync_skip_deletes, false),
    syncSameAge: pick(cfg.sync_same_age, false),
    filePermissions: cfg.file_permissions ?? null,
    dirPermissions: cfg.dir_permissions ?? null,
    allowConfigUpload: pick(cfg.allow_config_upload, false),
  };

  return {
    connection,
    project,
    remotePath: cfg.remote_path ?? "",
    ignorePatterns: cfg.ignore_regexes ?? [],
  };
}
