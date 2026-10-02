import { defineControl, type ControlProps } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";

import { Textarea } from "@/components/ui/textarea";

import { common } from "./shared";

/**
 * A `textarea` field: like a `text` field, and a different element.
 *
 * The registry answers for `textarea` the way it answers for `text`, and both
 * say the same thing — the string leaves the control exactly as it was typed,
 * and the core decides what a cleared field means.
 */
export default defineControl(
  "textarea",
  ({
    id,
    code,
    value,
    onChange,
    disabled,
    readOnly,
    required,
    minLength,
    maxLength,
  }: ControlProps<"textarea">) => (
    <Textarea
      {...common({ id, code, disabled, readOnly, required })}
      readOnly={readOnly}
      value={value ?? ""}
      minLength={minLength}
      maxLength={maxLength}
      onChange={(event) => onChange(typeUtilities.textarea.answerFrom(event.currentTarget.value))}
      className="min-h-20"
    />
  ),
);
