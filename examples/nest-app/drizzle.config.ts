import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * The application never reads this file at runtime: it exists so `drizzle-kit
 * generate` and `drizzle-kit studio` operate on the same SQLite file the app
 * opens by default. The generated SQL lives in `src/db/migrations`, and
 * `src/db/migrate.ts` applies it without drizzle-kit at runtime.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env["COLANDER_DB_FILE"] ?? "./data/colander.db",
  },
  verbose: true,
  strict: true,
});
