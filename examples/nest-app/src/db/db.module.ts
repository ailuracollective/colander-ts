import { Logger, Module } from "@nestjs/common";

import { defaultDatabaseFile, isMemoryUrl, openDatabase, type ColanderDatabase } from "./client.js";
import { DB } from "./db.constants.js";
import { FormsRepository } from "./forms.repository.js";
import { migrate } from "./migrate.js";

/**
 * The database, as a Nest provider.
 *
 * The module owns exactly one connection per Nest application: it is opened and
 * migrated once at bootstrap, and the repository is built from that same
 * handle so every consumer shares it.
 *
 * **How a test gets an in-memory app:** set `COLANDER_DB_FILE` to an in-memory
 * url (`file::memory:` or `:memory:`) *before* the testing module is compiled,
 * and nothing else. Migrations still run, so the schema, the published-version
 * triggers and the bookkeeping table are the real ones.
 *
 * The url is decided by `openDatabase`, not here. This module used to build the
 * `file:` prefix itself and hand the raw location over, which meant an in-memory
 * request reached the driver verbatim: two suites asking for `file::memory:`
 * shared one database, locked each other out with `SQLITE_BUSY`, and one suite
 * took the other down with it. Deciding the url in one place is what keeps that
 * from coming back.
 */
@Module({
  providers: [
    {
      provide: DB,
      useFactory: async (): Promise<ColanderDatabase> => {
        const location = defaultDatabaseFile();
        Logger.log(
          isMemoryUrl(location)
            ? `using an in-memory database (requested: ${location})`
            : `using database file ${location}`,
          "DbModule",
        );
        const db = openDatabase(location);
        // Every boot, not only the first: `migrate` skips the hashes it has
        // already applied, and a database that exists without its triggers is
        // one the immutability guarantee does not hold on.
        await migrate(db);
        return db;
      },
    },
    {
      provide: FormsRepository,
      inject: [DB],
      useFactory: (db: ColanderDatabase): FormsRepository => new FormsRepository(db),
    },
  ],
  exports: [DB, FormsRepository],
})
export class DbModule {}
