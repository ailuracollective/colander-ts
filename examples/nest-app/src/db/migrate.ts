import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";

import { packageRoot, type ColanderDatabase } from "./client.js";

/**
 * Migration application.
 *
 * Chosen strategy: read `migrations/meta/_journal.json`, apply the `.sql` files
 * in journal order with the driver's own `executeMultiple`, and record each one
 * in drizzle's `__drizzle_migrations` bookkeeping table using the same
 * sha256-of-SQL hash drizzle-kit uses.
 *
 * Why not `migrate()` from `drizzle-orm/libsql/migrator`: it needs the
 * migrations folder as a *runtime* filesystem path, which is the one thing that
 * changes between running from `src` under vitest and running from `dist` after
 * `nest build`; the `.sql` files are not emitted by the build. Doing the
 * bookkeeping here keeps the exact same table, hash and ordering, so a later
 * `drizzle-kit migrate` still agrees about what has already been applied. The
 * function is async only because `executeMultiple` is; there is no implicit
 * `await` anywhere else in `src/db`.
 */

const JOURNAL_FILE = "meta/_journal.json";
const STATEMENT_BREAKPOINT = /^\s*-->\s*statement-breakpoint\s*$/gm;

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface MigrateOptions {
  /** Overrides the folder holding `meta/_journal.json` and the `.sql` files. */
  migrationsFolder?: string;
}

/**
 * Where the migration files may live, in priority order. Callers can always
 * override it; the fallbacks only exist so the same code path works from
 * `src/`, from `dist/`, and from a test run in a temporary directory.
 */
function candidateFolders(): string[] {
  const root = packageRoot();
  return [
    fileURLToPath(new URL("./migrations", import.meta.url)),
    `${root}/src/db/migrations`,
    `${root}/dist/src/db/migrations`,
  ];
}

export function resolveMigrationsFolder(explicit?: string): string {
  const candidates = explicit === undefined ? candidateFolders() : [explicit];
  for (const candidate of candidates) {
    if (existsSync(`${candidate}/${JOURNAL_FILE}`)) {
      return candidate;
    }
  }
  throw new Error(
    `No migration journal found. Looked in: ${candidates.join(", ")}. ` +
      "Pass `migrationsFolder` to migrate() or generate the migrations with drizzle-kit.",
  );
}

function readJournal(folder: string): Journal {
  return JSON.parse(readFileSync(`${folder}/${JOURNAL_FILE}`, "utf8")) as Journal;
}

/** The `.sql` files in the folder, in journal order. */
function readMigrations(folder: string, journal: Journal): Array<{ hash: string; sql: string; when: number }> {
  return [...journal.entries]
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => {
      // The hash covers the raw file, `--> statement-breakpoint` markers
      // included, because that is what drizzle's own migrator hashes. Only the
      // statement sent to the driver has the markers removed.
      const raw = readFileSync(`${folder}/${entry.tag}.sql`, "utf8");
      return {
        hash: createHash("sha256").update(raw).digest("hex"),
        sql: raw.replace(STATEMENT_BREAKPOINT, ""),
        when: entry.when,
      };
    });
}

/**
 * Applies every migration that has not been applied yet. Safe to call on every
 * boot: already applied hashes are skipped.
 */
export async function migrate(db: ColanderDatabase, options: MigrateOptions = {}): Promise<void> {
  const folder = resolveMigrationsFolder(options.migrationsFolder);
  const journal = readJournal(folder);
  const client = db.$client;

  await client.executeMultiple(
    "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (" +
      "`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, " +
      "`hash` text NOT NULL, " +
      "`created_at` numeric, " +
      "`journal_hash` text" +
      ");",
  );

  const applied = await db.all<{ hash: string }>(sql`SELECT hash FROM __drizzle_migrations`);
  const known = new Set(applied.map((row) => row.hash));

  for (const migration of readMigrations(folder, journal)) {
    if (known.has(migration.hash)) {
      continue;
    }
    // `executeMultiple` runs the file's statements as one unit; a trigger in
    // 0000_init is part of that unit, so a database never exists without the
    // immutability guarantee.
    await client.executeMultiple(migration.sql);
    await client.execute({
      sql: "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
      args: [migration.hash, migration.when],
    });
  }
}
