import { defineControl, type ControlProps } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";

import { Input } from "@/components/ui/input";

import { common } from "./shared";

/**
 * A `number` field.
 *
 * Two decisions, and neither is written here: the granularity the element steps
 * by, and the number the core is handed. Both come from the `number` entry of
 * the compiler's registry, named with the properties the core declares for this
 * type and nothing else, so the control cannot reach a field's `value` through
 * them. The bounds arrive as `minimum` and `maximum` and the element wants `min`
 * and `max`, which is this file's business.
 */
export default defineControl(
  "number",
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
    decimalPlaces,
  }: ControlProps<"number">) => (
    <Input
      {...common({ id, code, disabled, readOnly, required })}
      type="number"
      min={minimum}
      max={maximum}
      step={typeUtilities.number.step({ multipleOf, decimalPlaces })}
      value={value ?? ""}
      onChange={(event) => onChange(typeUtilities.number.answerFrom(event.currentTarget.value))}
    />
  ),
);
