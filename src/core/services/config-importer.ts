/**
 * Import a Sublime SFTP `sftp-config.json` into our data model. Pure parsing:
 * returns structured inputs; persistence/orchestration happens in AppContext.
 */
import { basename } from "node:path";
import type {
  ConnectionInput,
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
  connection: ConnectionInput;
  project: Omit<ProjectInput, "defaultEnvironmentId">;
  remotePath: string;
  ignorePatterns: string[];
}

function pick<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/** Strip `//` and `/* *​/` comments Sublime tolerates in its JSON. */
function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

export function parseSublimeConfig(text: string, localPath: string): ImportResult {
  const cfg = JSON.parse(stripJsonComments(text)) as SublimeConfig;

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

  const connection: ConnectionInput = {
    name,
    type,
    host: cfg.host ?? "",
    port: pick(cfg.port, defaultPort),
    user: cfg.user ?? "",
    authType: cfg.ssh_key_file ? "key" : cfg.password ? "password" : "key",
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
