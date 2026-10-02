import { defineControl, type ControlProps } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";

import { Input } from "@/components/ui/input";

import { common } from "./shared";

/**
 * An `integer` field.
 *
 * The step follows `multipleOf` only when it preserves integrality — a whole
 * number, or the reciprocal of one — and is `1` otherwise. The reason is the
 * corpus rather than taste: `validate.json:4232` and `:4281` both declare
 * `"multipleOf": 0.5` on an `integer` and both return zero errors, so the core
 * accepts that declaration and never enforces it there, and a step of `0.5`
 * would make the element refuse integers the core accepts. The expression that
 * used to sit in this file's `step` attribute read
 * `Number.isInteger(1 / multipleOf)` alone, so a `multipleOf` of `2` stepped by
 * `1` — the wrong way round for exactly the case the corpus accepts.
 *
 * The answer is not parsed as an integer, and deliberately so: the core is
 * strict about a value a control altered on purpose, and it will not catch a
 * fractional answer to an `integer` field, so rounding here would hide the one
 * place that error is visible.
 */
export default defineControl(
  "integer",
  ({
    id,
    code,
    value,
    onChange,
    disabled,
    readOnly,
    required,
    minimum,
    maximum,
    multipleOf,
  }: ControlProps<"integer">) => (
    <Input
      {...common({ id, code, disabled, readOnly, required })}
      type="number"
      min={minimum}
      max={maximum}
      step={typeUtilities.integer.step({ multipleOf })}
      value={value ?? ""}
      onChange={(event) => onChange(typeUtilities.integer.answerFrom(event.currentTarget.value))}
    />
  ),
);
