import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { schema } from "./schema.js";

/**
 * The database handle every other module in `src/db` takes.
 *
 * `@libsql/client` is the driver because drizzle 0.45 has no `node:sqlite`
 * driver and libsql ships prebuilt binaries, so nothing in this example needs a
 * node-gyp build.
 */
// Drizzle 0.45 renamed `NodeLibSQLiteDatabase` to `LibSQLDatabase`; the older
// name is kept in the docs of this task, not in the code.
export type ColanderDatabase = LibSQLDatabase<typeof schema> & {
  $client: Client;
};

const DEFAULT_DATABASE_FILE = "data/colander.db";
const DATABASE_FILE_ENV = "COLANDER_DB_FILE";

/**
 * The root of the `nest-app` package, found by walking up from this module
 * until a `package.json` appears. Resolving from the module rather than from
 * `process.cwd()` keeps the default file in the same place whether the app is
 * started from the package root, from the monorepo root, or from `dist/`.
 */
function packageRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      if (existsSync(resolve(directory, "package.json"))) {
        return directory;
      }
    } catch {
      // Unreadable directory: keep walking.
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * An in-memory url. Tests open the whole suite against one of these and never
 * name a database of their own.
 *
 * The forms are not equivalent and none of them is what a test actually gets;
 * see `privateDatabaseFile` below.
 */
export function isMemoryUrl(url: string): boolean {
  return url === ":memory:" || url.startsWith("file::memory:") || url.startsWith("file::memory:?");
}

/**
 * A private, empty database, unique to this one call.
 *
 * A request for memory is answered with `:memory:`, which libsql scopes to the
 * connection rather than to a name, so two callers cannot land on the same
 * database. libsql rejects every url query parameter, so a *named* shared-cache
 * memory database is not available as an alternative.
 *
 * Verified: with the three e2e specs running in parallel this is stable across
 * repeated runs. The `SQLITE_BUSY` failures it used to show were never this
 * driver's memory behaviour; they came from `defaultDatabaseFile` resolving a
 * memory url into a real path, which made every suite share one file.
 */
function privateDatabaseFile(): string {
  return ":memory:";
}

/**
 * The default on-disk location, overridable through `COLANDER_DB_FILE`.
 *
 * An in-memory request is returned untouched. Resolving it would turn
 * `file::memory:` into an absolute path ending in a file *named* `file::memory:`
 * in the package root: two suites asking for memory would silently share that
 * one file and lock each other out, and the directory would collect a stray
 * database per suite. This was the actual cause of the `SQLITE_BUSY` the e2e
 * suites hit; the in-memory driver behaviour it was blamed on was innocent.
 */
export function defaultDatabaseFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[DATABASE_FILE_ENV];
  const file = configured === undefined || configured === "" ? DEFAULT_DATABASE_FILE : configured;
  if (isMemoryUrl(file)) {
    return file;
  }
  return isAbsolute(file) ? file : resolve(packageRoot(), file);
}

/**
 * Opens the database and returns a Drizzle instance over it.
 *
 * The parent directory of a file-backed database is created if missing: a fresh
 * checkout has no `data/` directory, and failing to boot over that would be a
 * worse answer than creating one empty directory.
 *
 * The url is decided here and nowhere else. A caller may pass a bare path, a
 * `file:` url, or one of the in-memory forms, and each request is answered with
 * a database that belongs to that call alone. Deciding the url in one place is
 * what stops one module handing the driver a shared database another module
 * already opened.
 */
export function openDatabase(filePath?: string): ColanderDatabase {
  const requested = filePath ?? defaultDatabaseFile();
  const memory = isMemoryUrl(requested);
  const path = memory
    ? privateDatabaseFile()
    : requested.startsWith("file:")
      ? requested.slice("file:".length)
      : requested;
  if (!memory) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const client = createClient({ url: `file:${path}` });
  return drizzle(client, { schema });
}

export { packageRoot };
