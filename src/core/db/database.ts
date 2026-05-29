/**
 * SQLite bootstrap + migrator built on bun:sqlite.
 * Opens the app database under the OS app-data dir and applies pending
 * migrations transactionally via PRAGMA user_version.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema";

let db: Database | null = null;

/** Apply any migrations newer than the DB's current user_version. */
function migrate(database: Database): void {
  // Guard against SCHEMA_VERSION drifting away from the actual migration count.
  if (SCHEMA_VERSION !== MIGRATIONS.length) {
    throw new Error(
      `SCHEMA_VERSION (${SCHEMA_VERSION}) != MIGRATIONS.length (${MIGRATIONS.length})`,
    );
  }
  const current = (
    database.query("PRAGMA user_version").get() as { user_version: number }
  ).user_version;

  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    database.transaction(() => {
      database.run(sql);
      // user_version only accepts a literal, not a bound param.
      database.run(`PRAGMA user_version = ${version + 1}`);
    })();
  }
}

/**
 * Open (once) and return the shared database handle.
 * @param path Absolute path to the SQLite file.
 */
export function openDatabase(path: string): Database {
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true });
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA foreign_keys = ON");
  migrate(database);
  db = database;
  return db;
}

/** Get the already-opened handle, throwing if openDatabase wasn't called. */
export function getDatabase(): Database {
  if (!db) throw new Error("Database not opened. Call openDatabase() first.");
  return db;
}

/** For tests / shutdown. */
export function closeDatabase(): void {
  db?.close();
  db = null;
}
