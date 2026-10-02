/**
 * Test-only: build a `DescribedForm` for a form document.
 *
 * The client package has no core dependency, so its unit tests cannot ask the
 * real core to describe a document. This helper stands in for it.
 *
 * It deliberately mirrors the core's addressing — a nested field's pointer is
 * its container's plus `/items/<n>`, and the entries are in depth-first document
 * order — so a test failure means the client consumed the description wrongly.
 * That it is not itself a re-derivation of the client's *old* code is the point:
 * it lives in the test tree, is never shipped, and agrees with the real core
 * because the React example exercises both against the same WASM.
 */
import type { DescribedField, DescribedForm, FormSchema } from "../src/index.js";

interface FieldLike {
  readonly id?: unknown;
  readonly code?: unknown;
  readonly type?: unknown;
  readonly required?: unknown;
  readonly readOnly?: unknown;
  readonly items?: unknown;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function describeForm(form: FormSchema, contentHash = "test-hash"): DescribedForm {
  const fields: DescribedField[] = [],
    walk = (entries: unknown, parentPath: string | null, container: string): void => {
      if (!Array.isArray(entries)) {
        return;
      }
      entries.forEach((entry, index) => {
        if (typeof entry !== "object" || entry === null) {
          return;
        }
        const field = entry as FieldLike,
          path = `${container}/${index}`;
        fields.push({
          code: text(field.code),
          id: text(field.id),
          parentPath,
          path,
          readOnly: field.readOnly === true,
          required: field.required === true,
          type: text(field.type),
        });
        walk(field.items, path, `${path}/items`);
      });
    };

  walk(form.fields, null, "/fields");
  return { contentHash, fields };
}
