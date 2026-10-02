import { defineControl, type ControlProps } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";

import { Input } from "@/components/ui/input";

import { common } from "./shared";

/**
 * A `text` field.
 *
 * The file is named after the type it materialises, which is how the compiler
 * finds it. The contract is the core's own declaration of what a `text` field
 * carries: `minLength`, `maxLength` and `pattern` arrive under those names, and
 * the element here happens to want the same three, so they are forwarded rather
 * than derived. The one decision — what the typed string *is* — belongs to the
 * compiler, and the utility forwards it unchanged: whether an empty input is an
 * answer is the core's call, not this control's. The shell draws the label, the
 * description and the messages around it.
 */
export default defineControl(
  "text",
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
    pattern,
  }: ControlProps<"text">) => (
    <Input
      {...common({ id, code, disabled, readOnly, required })}
      type="text"
      value={value ?? ""}
      minLength={minLength}
      maxLength={maxLength}
      pattern={pattern}
      readOnly={readOnly}
      onChange={(event) => onChange(typeUtilities.text.answerFrom(event.currentTarget.value))}
    />
  ),
);
