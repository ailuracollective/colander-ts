import { defineControl, type ControlProps } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * A `choice` field: the options the core published, drawn as whatever the
 * field's own `allowMultiple` says the answer looks like.
 *
 * **A choice's answer is not one shape, and this control is where that becomes
 * visible.** The core is strict in both directions — `convert_single_choice`
 * takes `Json::as_str` and rejects a list, `convert_multi_choice` takes
 * `Json::Array` and rejects a scalar — so a single-select answers with `"red"`
 * and a multiple with `["red", "blue"]`. `allowMultiple` is a *field*
 * property, so the same control serves both and the field decides which it
 * draws.
 *
 * What the control actually does, in each case:
 *
 * - **Without `allowMultiple`** it draws shadcn's `Select`, which holds exactly
 *   one value, and reports the scalar the core takes for this field. The empty
 *   selection is `null`, which the core accepts as an absent value.
 * - **With `allowMultiple`** it draws one checkbox per option and reports the
 *   list of checked values. Toggling adds or removes one entry, so the
 *   selections the user made are all kept — this is a real multi-select, not a
 *   single pick reported as a list. That is the case the old version of this
 *   file got wrong: it emitted `onChange([next])` unconditionally, so a
 *   dropdown answered a single-select produced `["red"]`, and the core answered
 *   *must be a choice value*. The comment it carried said a multiple choice
 *   "degrades to a single pick"; that was true of the widget it had and false of
 *   the contract, and both halves are gone.
 *
 * **The answer may still arrive in the other shape, and the control survives
 * it.** `value` is typed as the union of everything a choice can be bound with,
 * deliberately, because a document that sets `allowMultiple` and a stored answer
 * that disagrees is a real possibility and this is the place it has to be
 * handled. The narrowing below is a `typeof` and a `null` test — what the
 * control can *draw* — and it never rewrites what is stored: the untouched
 * answer is what the core validates, and a control that reconciled the two
 * shapes here would make the core's own type error unreachable.
 *
 * The value that means "nothing is selected" is derived from this field's own
 * options rather than being a constant in this file, so a document that offers an
 * option of exactly that name does not render that option as the chosen one. It
 * is recomputed from the options on each render and the options do not change
 * between renders, so the widget's value is stable for a given field.
 */
function ChoiceControl({
  id,
  code,
  value,
  onChange,
  disabled,
  readOnly,
  required,
  options,
  allowMultiple,
}: ControlProps<"choice">) {
  const off = disabled || readOnly;

  // The branch is the whole contract: the two arms below get two different
  // `onChange` types, one that takes a scalar and one that takes a list, and a
  // control that reported the wrong one would not compile.
  if (allowMultiple) {
    // A multiple choice is drawn as toggles, so what it needs to know is
    // membership — and a scalar or an absent answer carries nothing to be a
    // member of, which is what the narrowing says. It does not say the answer is
    // *wrong*: a scalar here is what the core would reject, and the point of
    // leaving it alone is that the core is the one who gets to say so.
    const chosen = value === null || typeof value === "string" ? [] : value;
    return (
      <fieldset
        className="flex flex-col gap-2"
        aria-required={required}
        aria-labelledby={`${id}-legend`}
      >
        <legend id={`${id}-legend`} className="sr-only">
          {code}
        </legend>
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          const checked = typeUtilities.choice.has(chosen, option.value);
          return (
            <div key={option.value} className="flex items-center gap-2">
              <Checkbox
                id={optionId}
                name={code}
                checked={checked}
                disabled={off}
                required={required}
                onCheckedChange={(next) => {
                  onChange(
                    next === true
                      ? [...chosen, option.value]
                      : chosen.filter((entry) => entry !== option.value),
                  );
                }}
              />
              <Label htmlFor={optionId}>{option.label ?? option.value}</Label>
            </div>
          );
        })}
      </fieldset>
    );
  }

  return (
    <Select
      name={code}
      disabled={off}
      required={required}
      value={typeUtilities.choice.controlValue(value, options)}
      onValueChange={(next) =>
        onChange(typeUtilities.choice.answerFrom(next, options, allowMultiple))
      }
    >
      <SelectTrigger id={id} className="w-full" aria-required={required}>
        <SelectValue placeholder="Select an option" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label ?? option.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default defineControl("choice", ChoiceControl);
