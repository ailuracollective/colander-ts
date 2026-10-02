/**
 * What several controls share.
 *
 * One function, and it is not a per-type decision: {@link common} folds the
 * core's `readOnly` into the element's own `disabled`, because this application's
 * markup renders a read-only field as a disabled one. That is plumbing about
 * the consumer's elements, and the host contract deliberately keeps the two
 * flags separate, so it stays here.
 *
 * Everything that *was* here and is not any more is a per-type decision the
 * compiler now owns, and it is reached through `@ailura/colander-compiler/utilities`
 * rather than through a local copy: the numeric step, the numeric answer, and
 * the whole temporal layer (`ClockTime`, `MIDNIGHT`, the wire patterns, the
 * date and clock builders, the formatters and the parsers). Those were ~150
 * lines of careful code that this app's own test runner cannot execute, since it
 * runs in `environment: "node"` with no DOM. They moved into the package that
 * can be tested, and a control that needs one of them asks the registry for it
 * by type.
 */

/** The props an element needs that come from the field rather than from the control. */
export function common(props: {
  id: string;
  code: string;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
}) {
  return {
    id: props.id,
    name: props.code,
    disabled: props.disabled || props.readOnly,
    required: props.required,
  };
}
