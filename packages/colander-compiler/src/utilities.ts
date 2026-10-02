/**
 * The per-type decisions a control has to make, derived once, in the package
 * that already owns the core's semantics.
 *
 * This is the entry point for the third thing the compiler publishes: it
 * publishes the names and ordering a control needs at build time (`plan`,
 * `contracts`), the framework-neutral binding it needs at runtime (`runtime`),
 * and here the decision itself — what the core's declared properties mean for
 * one type. They live in the compiler rather than in `@ailura/colander-client`
 * because the client's table is a transcription of the core that is
 * deliberately silent about derivation, and restating the core's intent there
 * is the one thing that package exists not to do.
 */

export { DERIVATION_RULE } from "./utilities/contract.js";
export type {
  ChoiceConstraints,
  DeclaredProperties,
  IntegerConstraints,
  NumberConstraints,
  TextareaConstraints,
  TextConstraints,
} from "./utilities/contract.js";
export type { IntegerUtilities, NumberUtilities } from "./utilities/numeric.js";
export { numberAnswerFrom, stepForInteger, stepForNumber } from "./utilities/numeric.js";
export type { BooleanUtilities } from "./utilities/boolean.js";
export { checkedFrom } from "./utilities/boolean.js";
export type {
  ChoiceAnswerFrom,
  ChoiceUnansweredValue,
  ChoiceUtilities,
} from "./utilities/choice.js";
export type { ChoiceAnswer } from "./host.js";
export {
  choiceAnswerFrom,
  choiceControlValue,
  choiceEmptyValue,
  choiceHas,
  unansweredChoiceValue,
} from "./utilities/choice.js";
export type { TextareaUtilities, TextUtilities } from "./utilities/text.js";
export { textAnswerFrom } from "./utilities/text.js";
export type {
  ClockTime,
  DateTimeParts,
  DateTimeUtilities,
  DateUtilities,
  TimeUtilities,
} from "./utilities/temporal.js";
export {
  MIDNIGHT,
  dateAnswerFrom,
  dateTimeAnswerFrom,
  dateWithTime,
  formatDateAnswer,
  formatDateTimeAnswer,
  formatTimeAnswer,
  parseDateAnswer,
  parseDateTimeAnswer,
  parseTimeAnswer,
  timeAnswerFrom,
} from "./utilities/temporal.js";
export type { TypeUtilities, UnansweredValue, UtilitiesOf } from "./utilities/registry.js";
export { typeUtilities, unansweredValueFor } from "./utilities/registry.js";
