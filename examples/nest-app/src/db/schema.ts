import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The persisted shape of the dynamic form system.
 *
 * Three tables and nothing else: a definition is the stable identity of a form,
 * a version is one immutable-once-published snapshot of that form's documents,
 * and a response is one submitted answer set against a published version.
 *
 * The four document columns hold the exact JSON text the core hashed. Parsing
 * and re-serializing a document rewrites number literals and can reorder keys,
 * which changes the content hash, so the bytes that were compiled are the bytes
 * that are kept.
 */

export const formDefinitions = sqliteTable("form_definitions", {
  // `crypto.randomUUID()`, assigned by the repository. A default expression
  // would move identity generation into the database and make fixtures harder
  // to reason about.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // ISO 8601 UTC strings. SQLite has no date type worth depending on, and a
  // sortable text timestamp keeps ordering and comparison trivial.
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const formVersions = sqliteTable(
  "form_versions",
  {
    id: text("id").primaryKey(),
    formId: text("form_id")
      .notNull()
      .references(() => formDefinitions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").$type<FormVersionStatus>().notNull(),
    formSchemaJson: text("form_schema_json").notNull(),
    uiSchemaJson: text("ui_schema_json"),
    rulesSchemaJson: text("rules_schema_json"),
    componentsJson: text("components_json"),
    contentHash: text("content_hash"),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    // Version numbers are assigned by the repository inside a transaction that
    // reads the current maximum. This constraint is what makes two concurrent
    // drafts for the same form impossible: the loser gets a unique violation
    // instead of silently overwriting a version number.
    uniqueIndex("form_versions_form_id_version_unique").on(table.formId, table.version),
    check("form_versions_status_check", sql`${table.status} in ('draft', 'published')`),
  ],
);

export const responses = sqliteTable("responses", {
  id: text("id").primaryKey(),
  formId: text("form_id")
    .notNull()
    .references(() => formDefinitions.id, { onDelete: "cascade" }),
  versionId: text("version_id")
    .notNull()
    .references(() => formVersions.id, { onDelete: "cascade" }),
  answersJson: text("answers_json").notNull(),
  validationJson: text("validation_json"),
  isValid: integer("is_valid", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export type FormVersionStatus = "draft" | "published";

export type FormDefinitionsTable = typeof formDefinitions;
export type FormVersionsTable = typeof formVersions;
export type ResponsesTable = typeof responses;

export const schema = {
  formDefinitions,
  formVersions,
  responses,
};
