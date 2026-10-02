-- Initial schema for the dynamic form system.
--
-- Written by hand to match `src/db/schema.ts`; `drizzle-kit generate` produces
-- the same DDL, but the published-version triggers below have no schema
-- equivalent, so this file is the source of truth for them.

CREATE TABLE `form_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE TABLE `form_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `form_id` text NOT NULL,
  `version` integer NOT NULL,
  `status` text NOT NULL CHECK (status in ('draft', 'published')),
  `form_schema_json` text NOT NULL,
  `ui_schema_json` text,
  `rules_schema_json` text,
  `components_json` text,
  `content_hash` text,
  `created_at` text NOT NULL,
  `published_at` text,
  FOREIGN KEY (`form_id`) REFERENCES `form_definitions` (`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `responses` (
  `id` text PRIMARY KEY NOT NULL,
  `form_id` text NOT NULL,
  `version_id` text NOT NULL,
  `answers_json` text NOT NULL,
  `validation_json` text,
  `is_valid` integer NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`form_id`) REFERENCES `form_definitions` (`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`version_id`) REFERENCES `form_versions` (`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `form_versions_form_id_version_unique` ON `form_versions` (`form_id`, `version`);

-- Published versions are immutable, and the guarantee lives here rather than in
-- the service layer on purpose. A TypeScript check only protects the writers
-- that go through it: a second process, a migration, a psql session, or a
-- future endpoint that forgets the check can still move the row. `form_versions`
-- is the one table whose rows are cited by responses and by the content hash
-- the core computed, so it must not move once it is published. A published
-- form is changed by publishing a new draft cloned from it, never by editing in
-- place.
CREATE TRIGGER `form_versions_published_are_immutable` BEFORE UPDATE ON `form_versions` FOR EACH ROW
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published versions are immutable');
END;

-- The same guarantee for DELETE, with one condition worth reading twice: the
-- parent definition must still exist. A published version may only disappear
-- together with the definition that owns it, never while that definition is
-- still there.
--
-- `DELETE FROM form_definitions` has to tear down its versions and, through
-- them, their responses, and an `ON DELETE CASCADE` fires as part of the parent
-- delete: by the time this trigger runs for the child row, the parent row is
-- already gone, so `EXISTS` is false and the cascade is allowed through. A
-- direct `DELETE FROM form_versions WHERE id = ...` leaves the parent in place,
-- `EXISTS` is true, and the statement is aborted.
--
-- There is deliberately no flag table, no session variable and no transaction
-- that opens the guarantee: nothing a writer can `INSERT` weakens the rule, so
-- the guarantee holds for SQL that never touches the service. The cost is that
-- the trigger states the one legal teardown explicitly instead of delegating it
-- to a bypass.
CREATE TRIGGER `form_versions_published_cannot_be_deleted` BEFORE DELETE ON `form_versions` FOR EACH ROW
WHEN OLD.status = 'published'
  AND EXISTS (SELECT 1 FROM `form_definitions` WHERE `id` = OLD.`form_id`)
BEGIN
  SELECT RAISE(ABORT, 'published versions are immutable');
END;
