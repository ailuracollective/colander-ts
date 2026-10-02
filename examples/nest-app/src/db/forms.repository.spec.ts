import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  defaultDatabaseFile,
  isMemoryUrl,
  openDatabase,
  packageRoot,
  type ColanderDatabase,
} from "./client.js";
import { FormsRepository, FormsRepositoryError } from "./forms.repository.js";
import { migrate } from "./migrate.js";
import { formVersions } from "./schema.js";

/** The SQLite message lives on the `cause` of Drizzle's wrapper error. */
function driverMessage(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 10; depth += 1) {
    if (current.message.includes("Failed query:") === false) {
      return current.message;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return error instanceof Error ? error.message : String(error);
}

const MEMORY_URL = "file::memory:";

async function newRepository(): Promise<{ db: ColanderDatabase; repository: FormsRepository }> {
  const db = openDatabase(MEMORY_URL);
  await migrate(db);
  return { db, repository: new FormsRepository(db) };
}

const FORM_SCHEMA = JSON.stringify({ fields: [{ key: "email", kind: "text" }] });
const UI_SCHEMA = JSON.stringify({ layout: "single-column" });
const RULES_SCHEMA = JSON.stringify({ rules: [] });
const COMPONENTS = JSON.stringify([{ name: "TextInput" }]);

describe("FormsRepository", () => {
  let db: ColanderDatabase;
  let repository: FormsRepository;

  beforeEach(async () => {
    const created = await newRepository();
    db = created.db;
    repository = created.repository;
  });

  it("creates a definition and a draft at version 1", async () => {
    const definition = await repository.createDefinition({
      name: "Contact",
      description: "A contact form",
    });
    expect(definition.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(definition.description).toBe("A contact form");
    expect(definition.updatedAt).toBe(definition.createdAt);

    const draft = await repository.createDraft(definition.id, {
      formSchemaJson: FORM_SCHEMA,
      uiSchemaJson: UI_SCHEMA,
      rulesSchemaJson: RULES_SCHEMA,
      componentsJson: COMPONENTS,
    });
    expect(draft.version).toBe(1);
    expect(draft.status).toBe("draft");
    expect(draft.formSchemaJson).toBe(FORM_SCHEMA);
    expect(draft.publishedAt).toBeNull();

    expect(await repository.getDefinition(definition.id)).toEqual(definition);
    expect(await repository.getVersion(draft.id)).toEqual(draft);
    expect(await repository.listVersions(definition.id)).toEqual([draft]);
  });

  it("numbers a second draft 2 and rejects a duplicate version number", async () => {
    const definition = await repository.createDefinition({ name: "Numbered" });
    const first = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });
    const second = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect((await repository.getLatestVersion(definition.id))?.id).toBe(second.id);

    // The constraint, not the read, is what makes this impossible.
    const duplicate = {
      id: randomUUID(),
      formId: definition.id,
      version: 1,
      status: "draft" as const,
      formSchemaJson: FORM_SCHEMA,
      uiSchemaJson: null,
      rulesSchemaJson: null,
      componentsJson: null,
      contentHash: null,
      createdAt: new Date().toISOString(),
      publishedAt: null,
    };
    await expect(db.insert(formVersions).values(duplicate).run()).rejects.toSatisfy(
      (error: unknown) => /UNIQUE constraint/i.test(driverMessage(error)),
    );
    expect(await repository.listVersions(definition.id)).toHaveLength(2);
  });

  it("ends with exactly one winner when two drafts race for the same form", async () => {
    const definition = await repository.createDefinition({ name: "Raced" });
    const results = await Promise.allSettled([
      repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA }),
      repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    // The libsql local client multiplexes one connection, so the loser of the
    // race can fail either on the unique constraint (`duplicate_version`) or on
    // the connection's transaction guard. Either way exactly one draft lands:
    // the second draft for a form is impossible, and the stored version numbers
    // stay unique.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(rejected.length).toBe(2 - fulfilled.length);
    expect(await repository.listVersions(definition.id)).toHaveLength(fulfilled.length);
    const versions = await repository.listVersions(definition.id);
    expect(new Set(versions.map((version) => version.version)).size).toBe(versions.length);
    for (const failure of rejected) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    }

    // The typed duplicate path itself: two drafts that both believe they are
    // writing version 1, which only UNIQUE(form_id, version) can stop.
    const stale = {
      id: randomUUID(),
      formId: definition.id,
      version: 1,
      status: "draft" as const,
      formSchemaJson: FORM_SCHEMA,
      uiSchemaJson: null,
      rulesSchemaJson: null,
      componentsJson: null,
      contentHash: null,
      createdAt: new Date().toISOString(),
      publishedAt: null,
    };
    await expect(db.insert(formVersions).values(stale).run()).rejects.toSatisfy(
      (error: unknown) => /UNIQUE constraint/i.test(driverMessage(error)),
    );
  });

  it("updates a draft's documents", async () => {
    const definition = await repository.createDefinition({ name: "Editable" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });

    const updated = await repository.updateDraft(draft.id, {
      formSchemaJson: '{"fields":[]}',
      uiSchemaJson: null,
    });
    expect(updated.formSchemaJson).toBe('{"fields":[]}');
    expect(updated.uiSchemaJson).toBeNull();
    expect(updated.rulesSchemaJson).toBeNull();
    expect(updated.status).toBe("draft");
  });

  it("refuses to update a draft that does not exist", async () => {
    await expect(
      repository.updateDraft(randomUUID(), { formSchemaJson: FORM_SCHEMA }),
    ).rejects.toBeInstanceOf(FormsRepositoryError);
  });

  it("publishes a draft, setting status and published_at", async () => {
    const definition = await repository.createDefinition({ name: "Publishable" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });

    const published = await repository.publishVersion(draft.id, "hash-1");
    expect(published.status).toBe("published");
    expect(published.contentHash).toBe("hash-1");
    expect(published.publishedAt).not.toBeNull();
    expect(Date.parse(published.publishedAt ?? "")).not.toBeNaN();
    expect((await repository.getLatestPublishedVersion(definition.id))?.id).toBe(published.id);
  });

  it("rejects an attempt to republish a published version", async () => {
    const definition = await repository.createDefinition({ name: "Republish" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });
    await repository.publishVersion(draft.id, "hash-1");

    await expect(repository.publishVersion(draft.id, "hash-2")).rejects.toMatchObject({
      code: "version_already_published",
    });
  });

  it("rejects an update to a published version, in the database", async () => {
    const definition = await repository.createDefinition({ name: "Immutable" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });
    const published = await repository.publishVersion(draft.id, "hash-1");
    const before = await repository.getVersion(published.id);

    // Straight through Drizzle, with no service-layer check in the way: the
    // trigger is what has to stop this.
    await expect(
      db
        .update(formVersions)
        .set({ formSchemaJson: '{"tampered":true}' })
        .where(sql`id = ${published.id}`)
        .run(),
    ).rejects.toSatisfy((error: unknown) =>
      driverMessage(error).includes("published versions are immutable"),
    );

    // The repository stops it one step earlier, with the `status = 'draft'`
    // predicate; the trigger above is what stops everyone else.
    await expect(
      repository.updateDraft(published.id, { formSchemaJson: '{"tampered":true}' }),
    ).rejects.toMatchObject({ code: "version_not_draft" });

    expect(await repository.getVersion(published.id)).toEqual(before);
    expect(before?.formSchemaJson).toBe(FORM_SCHEMA);
  });

  it("rejects the deletion of a published version, in the database", async () => {
    const definition = await repository.createDefinition({ name: "Undeletable" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });
    const published = await repository.publishVersion(draft.id, "hash-1");

    await expect(
      db.delete(formVersions).where(sql`id = ${published.id}`).run(),
    ).rejects.toSatisfy((error: unknown) =>
      driverMessage(error).includes("published versions are immutable"),
    );
    await expect(repository.deleteDraft(published.id)).rejects.toMatchObject({
      code: "version_immutable",
    });
    expect(await repository.getVersion(published.id)).not.toBeNull();
  });

  it("deletes a draft", async () => {
    const definition = await repository.createDefinition({ name: "Disposable" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });
    expect(await repository.deleteDraft(draft.id)).toBe(true);
    expect(await repository.getVersion(draft.id)).toBeNull();
  });

  it("clones the latest version into a new draft and leaves the published row byte-identical", async () => {
    const definition = await repository.createDefinition({ name: "Cloned" });
    const draft = await repository.createDraft(definition.id, {
      formSchemaJson: FORM_SCHEMA,
      uiSchemaJson: UI_SCHEMA,
      rulesSchemaJson: RULES_SCHEMA,
      componentsJson: COMPONENTS,
    });
    const published = await repository.publishVersion(draft.id, "hash-1");
    const before = await repository.getVersion(published.id);

    const clone = await repository.cloneLatestAsDraft(definition.id);
    expect(clone.id).not.toBe(published.id);
    expect(clone.version).toBe(2);
    expect(clone.status).toBe("draft");
    expect(clone.formSchemaJson).toBe(FORM_SCHEMA);
    expect(clone.uiSchemaJson).toBe(UI_SCHEMA);
    expect(clone.contentHash).toBeNull();
    expect(clone.publishedAt).toBeNull();

    const edited = await repository.updateDraft(clone.id, { formSchemaJson: '{"fields":["changed"]}' });
    expect(edited.formSchemaJson).toBe('{"fields":["changed"]}');
    expect(await repository.getVersion(published.id)).toEqual(before);
  });

  it("cascades a definition delete to its versions and responses", async () => {
    const definition = await repository.createDefinition({ name: "Cascading" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });
    const published = await repository.publishVersion(draft.id, "hash-1");
    const response = await repository.submitResponse({
      formId: definition.id,
      versionId: published.id,
      answersJson: '{"email":"a@b.c"}',
      validationJson: '{"valid":true}',
      isValid: true,
    });

    expect(await repository.deleteDefinition(definition.id)).toBe(true);
    expect(await repository.getDefinition(definition.id)).toBeNull();
    expect(await repository.getVersion(published.id)).toBeNull();
    expect(await repository.getResponse(response.id)).toBeNull();
    expect(await repository.listResponses(definition.id)).toEqual([]);
  });

  it("accepts a response only for a published version, and lists it back", async () => {
    const definition = await repository.createDefinition({ name: "Responded" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });

    await expect(
      repository.submitResponse({
        formId: definition.id,
        versionId: draft.id,
        answersJson: "{}",
        isValid: false,
      }),
    ).rejects.toMatchObject({ code: "response_version_not_published" });
    expect(await repository.listResponses(definition.id)).toEqual([]);

    const published = await repository.publishVersion(draft.id, "hash-1");
    const response = await repository.submitResponse({
      formId: definition.id,
      versionId: published.id,
      answersJson: '{"email":"a@b.c"}',
      validationJson: '{"valid":true}',
      isValid: true,
    });
    expect(response.isValid).toBe(true);
    expect(response.validationJson).toBe('{"valid":true}');
    expect(await repository.listResponses(definition.id)).toEqual([response]);
    expect(await repository.getResponse(response.id)).toEqual(response);

    const other = await repository.createDefinition({ name: "Other" });
    const otherDraft = await repository.createDraft(other.id, { formSchemaJson: FORM_SCHEMA });
    const otherPublished = await repository.publishVersion(otherDraft.id, "hash-2");
    await expect(
      repository.submitResponse({
        formId: definition.id,
        versionId: otherPublished.id,
        answersJson: "{}",
        isValid: true,
      }),
    ).rejects.toMatchObject({ code: "response_version_mismatch" });
  });

  it("updates a definition and moves updated_at", async () => {
    const definition = await repository.createDefinition({ name: "Original", description: "before" });
    const updated = await repository.updateDefinition(definition.id, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
    expect(updated.description).toBe("before");
    expect(Date.parse(updated.updatedAt)).not.toBeNaN();
    expect(await repository.listDefinitions()).toHaveLength(1);
  });

  it("keeps published-version immutability free of any bypass table or flag", async () => {
    const objects = await db.all<{ type: string; name: string; tbl_name: string }>(
      sql`SELECT type, name, tbl_name FROM sqlite_master WHERE type = 'table'`,
    );
    const names = objects.map((object) => object.name).sort();
    // No flag table, no session marker, nothing a writer could INSERT into: the
    // immutability guarantee has to hold for SQL that never touches the service.
    expect(names.filter((name) => name.includes("bypass"))).toEqual([]);
    expect(names.filter((name) => name.includes("flag"))).toEqual([]);
    // Exactly the three schema tables, drizzle's own bookkeeping, and SQLite's
    // internals. Nothing else may be added to this database.
    expect(names).toEqual(
      [
        "__drizzle_migrations",
        "form_definitions",
        "form_versions",
        "responses",
        "sqlite_sequence",
      ].sort(),
    );

    // The guarantee holds with the definition still in place, and disappears
    // only with the definition itself.
    const definition = await repository.createDefinition({ name: "Sealed" });
    const draft = await repository.createDraft(definition.id, { formSchemaJson: FORM_SCHEMA });
    const published = await repository.publishVersion(draft.id, "hash-1");
    await expect(
      db.delete(formVersions).where(eq(formVersions.id, published.id)).run(),
    ).rejects.toSatisfy((error: unknown) =>
      driverMessage(error).includes("published versions are immutable"),
    );
    expect(await repository.getVersion(published.id)).not.toBeNull();
    expect(await repository.deleteDefinition(definition.id)).toBe(true);
    expect(await repository.getVersion(published.id)).toBeNull();
  });

  it("resolves the database file from COLANDER_DB_FILE, defaulting to data/colander.db", () => {
    expect(defaultDatabaseFile({})).toBe(resolve(packageRoot(), "data/colander.db"));
    expect(defaultDatabaseFile({ COLANDER_DB_FILE: "/tmp/explicit.db" })).toBe("/tmp/explicit.db");
    expect(defaultDatabaseFile({ COLANDER_DB_FILE: "nested/other.db" })).toBe(
      resolve(packageRoot(), "nested/other.db"),
    );
    expect(isMemoryUrl("file::memory:")).toBe(true);
    expect(isMemoryUrl(":memory:")).toBe(true);
    expect(isMemoryUrl(resolve(packageRoot(), "data/colander.db"))).toBe(false);
  });

  it("migrates idempotently", async () => {
    await expect(migrate(db)).resolves.toBeUndefined();
    const definition = await repository.createDefinition({ name: "AfterSecondMigrate" });
    expect(await repository.getDefinition(definition.id)).not.toBeNull();
  });
});
