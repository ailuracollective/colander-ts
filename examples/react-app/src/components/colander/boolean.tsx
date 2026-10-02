import { defineControl, type ControlProps } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";

import { Checkbox } from "@/components/ui/checkbox";

/**
 * A `boolean` field.
 *
 * The only type whose answer is never absent: an unchecked box is an answer, not
 * a missing one, so this control reports `true` or `false` and never `null`. The
 * one reader serves both edges — what the box is drawn as and what it reports —
 * because there is no absent state for it to decide about.
 */
export default defineControl(
  "boolean",
  ({ id, code, value, onChange, disabled, readOnly, required }: ControlProps<"boolean">) => (
    <Checkbox
      id={id}
      name={code}
      checked={typeUtilities.boolean.checkedFrom(value)}
      disabled={disabled || readOnly}
      required={required}
      onCheckedChange={(checked) => onChange(typeUtilities.boolean.checkedFrom(checked))}
    />
  ),
);
