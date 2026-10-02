/**
 * What a `date`, a `time` and a `datetime` control have to decide: how the three
 * temporal answers travel, and what a control holding half an answer reports.
 *
 * Everything below is a translation between temporal answer strings and the
 * local calendar values a picker edits, and the translation is the same one the
 * example app already had — this module is where it moved to, with the coverage
 * it never had. The app's suite runs in `environment: "node"` with no DOM, so
 * none of it was ever executed by a test.
 *
 * The two guards in {@link buildLocalDate} and {@link buildLocalClock} are the
 * load-bearing part and are carried over with their reasoning, because they
 * encode real defects in `new Date(year, month, day)`: it rolls a day that never
 * happened into the next month, and it maps a year under a hundred into the
 * twentieth century. Re-deriving them would be a regression risk bought for
 * nothing.
 *
 * What the corpus proves about the three formats, and what it cannot:
 *
 * - `validate.json:3349`/`:3356` `date-normalization` answers `"2024-1-5"` and
 *   expects `"2024-01-05"` with zero errors, so the core accepts an **unpadded**
 *   month and day and normalises them.
 * - `validate.json:3565`/`:3575` `time-normalization` answers `"9:5:3"` and
 *   expects `"09:05:03"` with zero errors, so the core accepts **unpadded** fields
 *   and **seconds** in a time.
 * - `validate.json:3457`/`:3464` `datetime-normalization` answers
 *   `"2024-01-05T10:00:00Z"` and expects `"2024-01-05T10:00:00.0000000+00:00"`,
 *   so the core accepts a trailing `Z`, seconds, and a fractional offset — and
 *   **emits** a shape none of the three clean ones matches.
 * - `validate.json:2339` / `:2453` / `:2567` prove only the negatives:
 *   `Field 'patient.dob' must be an ISO date (YYYY-MM-DD).`,
 *   `Field 'patient.seen' must be an ISO date-time.` and
 *   `Field 'patient.clock' must be an ISO time.`
 *
 * So the corpus proves the core is **more permissive** than the three clean
 * shapes, and that its own normalised output for a `datetime` is a timestamp none
 * of them matches. An earlier revision of this module reported that as a defect
 * and refused every one of those answers, which meant a control handed an answer
 * the core itself had produced rendered empty. The decision that settled it is
 * **read tolerantly, write strictly**: a parser accepts every shape the corpus
 * proves the core accepts or emits, and keeps in the value it returns the extra
 * precision that shape carried ({@link ClockTime.seconds},
 * {@link DateTimeParts.offsetMinutes}), because a parser that read `09:05:03` and
 * answered `{ hours: 9, minutes: 5 }` would be doing the one thing this package
 * exists not to do — rewriting the answer in the client's name. The formatters
 * keep writing the three clean shapes, which is what a control surface emits, and
 * each one that drops precision says so where a reader will meet it.
 *
 * What the tolerance does *not* extend to is guesswork. The corpus proves
 * nothing about a space instead of a `T`, about a full ISO timestamp on a *date*
 * field, about a date-time on a *time* field, about an offset other than `+00:00`,
 * about an unpadded month or day inside a `datetime`, or about a fractional second
 * that is not `.0000000`. No parser for any of those is written here. The one
 * place that needs its reasoning stated out loud is `+00:00`, and the reason it is
 * not a guess is that **the core emitted that exact string itself**
 * (`validate.json:3467`): the normalised output of a `datetime` is evidence of an
 * accepted answer in the same way an input in `answersRaw` is.
 */

/**
 * A time of day, with no date attached: it is the half a time answer carries.
 *
 * `seconds` is present **only when the answer carried seconds**. An `HH:mm`
 * answer, and every value this module completes on its own — {@link MIDNIGHT},
 * a whole minute by definition — leave it absent rather than zero, because
 * `"09:05:00"` and `"09:05"` are two different answers the core emits and a
 * control that invented the first one from the second would be reporting digits
 * the user never produced.
 */
export interface ClockTime {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds?: number;
}

/**
 * A `datetime` answer taken apart into the two halves its two widgets edit.
 *
 * Renamed from the example's `LocalDateTime` for the same reason
 * `formatLocalDate` was: `Local` names the platform the value is expressed in,
 * and the platform is not part of the concept. A `Date` in this module is read
 * through its own local fields on purpose — a calendar day has no timezone — but
 * that is a decision each function documents, not something the type's name
 * should leak to every consumer.
 */
export interface DateTimeParts {
  readonly date: Date;
  readonly time: ClockTime;
  /**
   * The instant's offset from UTC in minutes, present only when the answer
   * carried one. A `Z` and a `+00:00` are the same fact and are deliberately
   * **not** distinguishable: both are `0`, and a flag saying which spelling was
   * used would be a fact about a string rather than about the instant, which is
   * the only thing the offset is for.
   *
   * A non-zero offset is not in the model. The corpus proves exactly one offset
   * — `+00:00`, and it is the core's own output — so a value for any other
   * offset would be a claim the repository does not support.
   *
   * Sub-second precision is likewise not in the model, and that is a stated limit
   * rather than a silent one: the only fractional answer the corpus contains is
   * `.0000000`, so nothing here says the core preserves a non-zero fraction, and
   * the digits are dropped on the way in. That is the one place this module does
   * not carry what it read, and it is bounded to a fraction the corpus only ever
   * shows as zero.
   */
  readonly offsetMinutes?: number;
}

/**
 * The start of a day, used where a date has to become an answer on its own.
 *
 * A `datetime` is one string, so a day cannot be held as half an answer; when
 * one is picked before any time, the time half is completed with the first
 * minute of that day, which the user can then change in the time field. It is
 * exported rather than inlined so the completion is one value the answer-side
 * function and the widget that shows the day agree on.
 */
export const MIDNIGHT: ClockTime = { hours: 0, minutes: 0 };

/**
 * The decisions a `date` control takes from its own state.
 *
 * No constraints parameter, because the core declares no property for a `date`
 * beyond the shell's own two (`@ailura/colander-client` `semantics.ts:168-172`),
 * and an empty constraints type would accept anything and mean nothing by it.
 */
export interface DateUtilities {
  /** The value an unanswered field of this family holds. */
  readonly unansweredValue: () => string | null;

  /** The `YYYY-MM-DD` answer, read from the day the control holds. */
  readonly formatAnswer: (date: Date) => string;
  /** The day the control holds, from the answer it was given. */
  readonly parseAnswer: (raw: string | null | undefined) => Date | undefined;
  /** The answer the core is to validate, from the day the user picked. */
  readonly answerFrom: (selected: Date | undefined) => string;
}

/**
 * The decisions a `time` control takes from its own state.
 *
 * No constraints parameter, for the same reason as {@link DateUtilities}: the
 * core declares no property for a `time` beyond `title` and `description`
 * (`semantics.ts:182-190`).
 */
export interface TimeUtilities {
  /** The value an unanswered field of this family holds. */
  readonly unansweredValue: () => string | null;

  /** The `HH:mm` answer, read from the time of day the control holds. */
  readonly formatAnswer: (time: ClockTime) => string;
  /** The time of day the control holds, from the answer it was given. */
  readonly parseAnswer: (raw: string | null | undefined) => ClockTime | undefined;
  /** The answer the core is to validate, from the time the user chose. */
  readonly answerFrom: (selected: ClockTime | undefined) => string;
}

/**
 * The decisions a `datetime` control takes from its two halves.
 *
 * The only type in the family with a rule that is not a translation: a
 * `datetime` is one answer made of two halves, so what each half reports on its
 * own is a decision this interface states rather than something a control works
 * out. {@link DateTimeUtilities.answerFrom} is where the two rules live, and
 * `midnight` is the value the calendar is given so the day it holds is the day
 * that was chosen.
 */
export interface DateTimeUtilities {
  /** The value an unanswered field of this family holds. */
  readonly unansweredValue: () => string | null;

  /** The first minute of a day, which completes a day with no time of its own. */
  readonly midnight: ClockTime;
  /** The `YYYY-MM-DDTHH:mm` answer, read from the two halves. */
  readonly formatAnswer: (parts: DateTimeParts) => string;
  /** The two halves the control holds, from the answer it was given. */
  readonly parseAnswer: (raw: string | null | undefined) => DateTimeParts | undefined;
  /** The answer the core is to validate, from the day and the clock it holds. */
  readonly answerFrom: (day: Date | undefined, time: ClockTime | undefined) => string | undefined;
  /** The one `Date` a single widget holds, given a day and a time of day. */
  readonly dateWithTime: (date: Date, time: ClockTime) => Date;
}

// `date-normalization` (`validate.json:3349`) answers `"2024-1-5"`, so a month
// And a day of one or two digits are both an answer the core accepts.
const DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
// `time-normalization` (`:3565`) answers `"9:5:3"`, so the seconds are optional
// And every field is one or two digits.
const TIME_PATTERN = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;
// `datetime-normalization` (`:3457`, `:3467`) answers `"2024-01-05T10:00:00Z"`
// And normalises it to `"2024-01-05T10:00:00.0000000+00:00"`, and the corpus
// Also carries the bare `"2024-01-05T10:00"`. Every field on this side is
// Therefore two digits wide: the corpus's only datetime answer is fully padded,
// And an unpadded month or day inside a *datetime* is a shape nothing proves,
// Unlike the `date` field above where it is proven.
//
// The offset is admitted only together with the seconds, and only as `Z` or
// `+00:00`, because that is the only configuration the corpus contains. `+00:00`
// Is not a guess about an ISO timestamp: the core emitted that exact string
// Itself as its own normalised output, which is the same kind of evidence an
// Input in `answersRaw` is. An offset other than `+00:00`, and an offset on an
// Answer with no seconds, are refused.
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?(?:Z|\+00:00))?$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Build a local calendar date, or nothing at all if that day does not exist.
 *
 * Every field is read back and compared with what was asked for, because
 * `new Date(year, month, day)` quietly answers a different question twice over:
 * it rolls a day that never happened (February 30th becomes March 2nd) into the
 * next month, and it maps a year under a hundred into the twentieth century. The
 * round trip is what turns both into "no date" rather than a wrong one.
 */
function buildLocalDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // The two-argument year is mapped to 1900+year, so the year is set in full after.
  date.setFullYear(year);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined;
}

/**
 * Build a time of day, or nothing at all if that time does not exist.
 *
 * The upper bounds are the whole check, and they are enough because this is only
 * ever reached from {@link parseTimeAnswer} and {@link parseDateTimeAnswer},
 * whose `\d{1,2}` patterns cannot produce a negative field or a field longer than
 * two digits. The lower bound is therefore the pattern's job and is carried
 * there rather than added here, because a lower-bound comparison would refuse
 * nothing that the pattern has already refused and would be a second, weaker
 * statement of the same rule.
 *
 * `seconds` is threaded through because the core carries it: a time the user
 * produced as `09:05:03` has to be refused or kept whole, and a guard that only
 * knew about hours and minutes would accept `09:05:99`. A time that arrived with
 * no seconds is completed with no seconds: the field is absent, not zero.
 */
function buildLocalClock(
  hours: number,
  minutes: number,
  seconds: number | undefined,
): ClockTime | undefined {
  if (hours > 23 || minutes > 59 || (seconds !== undefined && seconds > 59)) {
    return undefined;
  }
  return seconds === undefined ? { hours, minutes } : { hours, minutes, seconds };
}

/**
 * Read a `Date` as the `YYYY-MM-DD` answer, from its own local fields.
 *
 * Every field is zero-padded, so a single-digit month or day reaches the core
 * padded. The corpus proves the core would pad it anyway — `date-normalization`
 * normalises `"2024-1-5"` to `"2024-01-05"` — but a control that reports the
 * shape it parses is not relying on a later repair of its own answer, and the
 * wire format is documented as `YYYY-MM-DD` rather than as "whatever the core
 * will normalise".
 */
export function formatDateAnswer(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * Read a time of day as the `HH:mm` answer, zero-padded on both fields.
 *
 * **The seconds are dropped here, on purpose.** A `time` read as `09:05:03` —
 * the shape the core emits, `validate.json:3575` — is written back as `09:05`.
 * This is the "read tolerantly, write strictly" half of the decision: a widget
 * edits wall-clock minutes, and the answer the control reports is the wall clock
 * it was given, not a precision the clock on screen does not show. The value is
 * not destroyed, only not re-emitted: the `ClockTime` that was parsed still
 * carries its `seconds`, and a consumer that needs them has them.
 *
 * There is deliberately no flag to write them back. Three shapes is what the
 * control surface emits, and an option nobody asked for is a decision nobody
 * made.
 */
export function formatTimeAnswer(time: ClockTime): string {
  return `${pad(time.hours, 2)}:${pad(time.minutes, 2)}`;
}

/**
 * Join the two halves back into the `YYYY-MM-DDTHH:mm` a `datetime` travels as.
 *
 * **The seconds and the offset are dropped here, on purpose**, for the same
 * reason {@link formatTimeAnswer} drops the seconds: a `datetime` read as
 * `2024-01-05T10:00:00Z` or as the core's own normalised
 * `2024-01-05T10:00:00.0000000+00:00` is written back as `2024-01-05T10:00`.
 * The two halves a control holds are the day and the wall clock, and the offset
 * is a property of the instant rather than of the local calendar the two widgets
 * edit — a control that re-emitted `+00:00` would be asserting a timezone the
 * calendar never chose. As with the time, the value is not destroyed: the
 * `DateTimeParts` still carry `offsetMinutes` and a `time` with seconds, and no
 * flag exists to put them back, because nobody asked for one.
 */
export function formatDateTimeAnswer(parts: DateTimeParts): string {
  return `${formatDateAnswer(parts.date)}T${formatTimeAnswer(parts.time)}`;
}

/**
 * The same day at a given time of day, in local terms.
 *
 * A picker selects days and a clock selects times, and each of them has to show
 * the other as a value: the calendar is given midnight so that the day it holds
 * is the day that was chosen, and a clock with no date of its own is shown on
 * some day — any day, since the time is what the answer carries.
 *
 * The day is rebuilt from its own local fields rather than from the `Date` as it
 * arrived, so a `Date` that still carries a time cannot shift the day: a
 * calendar given a value for 23:59 still holds that same day, and not the next
 * one.
 *
 * The seconds the {@link ClockTime} carried are carried into the `Date`, because
 * a widget asked to show `09:05:03` and handed a `09:05` would be showing a
 * value the control cannot report back. Milliseconds stay zero, because no
 * answer in the corpus carries a sub-second precision and a `Date` that invented
 * one would be the platform being precise on the control's behalf.
 */
export function dateWithTime(date: Date, time: ClockTime): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.hours,
    time.minutes,
    time.seconds ?? 0,
  );
}

/**
 * Parse a `date` answer into a local date, or nothing if it is not one.
 *
 * An unpadded month or day is accepted, because the core accepts it
 * (`date-normalization` answers `"2024-1-5"` and normalises it), and the
 * normalisation the core performs is this module's job to do at read time rather
 * than to leave to a later repair of the answer. A full ISO timestamp is not
 * accepted: nothing in the repository proves the core takes one on a *date*
 * field, and `dateWithTime`/`dateTimeAnswerFrom` are the composition that
 * produces one.
 */
export function parseDateAnswer(raw: string | null | undefined): Date | undefined {
  const match = raw === null || raw === undefined ? null : DATE_PATTERN.exec(raw);
  if (match === null) {
    return undefined;
  }
  return buildLocalDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Parse a `time` answer into a time of day, or nothing if it is not one.
 *
 * Seconds are optional and are kept when present: the core answers `9:5:3` and
 * emits `09:05:03`, so an answer carrying seconds is an answer the core both
 * accepts and produces. A date-time string is not accepted — nothing proves the
 * core takes one on a *time* field.
 */
export function parseTimeAnswer(raw: string | null | undefined): ClockTime | undefined {
  const match = raw === null || raw === undefined ? null : TIME_PATTERN.exec(raw);
  if (match === null) {
    return undefined;
  }
  return buildLocalClock(
    Number(match[1]),
    Number(match[2]),
    match[3] === undefined ? undefined : Number(match[3]),
  );
}

/**
 * Take a `datetime` answer apart, or nothing if either half is missing.
 *
 * Both halves are checked, and the whole answer is refused when either is not a
 * real value: a `datetime` is one string, so half of one is not a datetime the
 * wire format can carry.
 *
 * What the answer carried is kept, so a value built from a normalised answer is
 * the same instant the core reported and not a truncated reading of it: the
 * seconds go into the {@link ClockTime}, and a `Z` or a `+00:00` goes into
 * {@link DateTimeParts.offsetMinutes} as `0`. The fraction is read and dropped —
 * see {@link DateTimeParts} for why that one is stated rather than carried.
 */
export function parseDateTimeAnswer(raw: string | null | undefined): DateTimeParts | undefined {
  const match = raw === null || raw === undefined ? null : DATE_TIME_PATTERN.exec(raw);
  if (match === null) {
    return undefined;
  }
  const date = buildLocalDate(Number(match[1]), Number(match[2]), Number(match[3]));
  const time = buildLocalClock(
    Number(match[4]),
    Number(match[5]),
    match[6] === undefined ? undefined : Number(match[6]),
  );
  if (date === undefined || time === undefined) {
    return undefined;
  }
  // The offset is read off the matched text rather than off `raw`, which the
  // Pattern already proved is a string; `match[0]` is that same text.
  return match[0].endsWith("Z") || match[0].endsWith("+00:00")
    ? { date, offsetMinutes: 0, time }
    : { date, time };
}

/**
 * The `date` answer the core is to validate, from the day the user picked.
 *
 * A day that was cleared reports `""`, and not today's date: "nothing is
 * selected" and "today" are different states, and substituting one for the other
 * is an answer this control invented. Whether `""` is an answer at all is the
 * core's decision, not the control's — the same rule the text utilities follow
 * by forwarding the string unchanged and substituting nothing for `null`.
 */
export function dateAnswerFrom(selected: Date | undefined): string {
  return selected === undefined ? "" : formatDateAnswer(selected);
}

/**
 * The `time` answer the core is to validate, from the time the user chose.
 *
 * A time that was cleared reports `""` for the same reason as
 * {@link dateAnswerFrom}: the empty string is the control's "nothing chosen",
 * and what the core makes of it is the core's business.
 */
export function timeAnswerFrom(selected: ClockTime | undefined): string {
  return selected === undefined ? "" : formatTimeAnswer(selected);
}

/**
 * The `datetime` answer the core is to validate, from the two halves the control
 * holds. This is the only function in the family that is a decision rather than
 * a translation, and the three cases are the whole rule:
 *
 * 1. **A day and a time** is the answer the two halves make together, joined by
 *    a `T` ({@link formatDateTimeAnswer}).
 * 2. **A day with no time** is completed to the first minute of that day
 *    ({@link MIDNIGHT}). A `datetime` is one string, so a picked day cannot be
 *    held as half an answer; completing it to midnight makes the day selectable
 *    on its own, and the user can then change the time. The example did this in
 *    its `onSelect` (`parts?.time ?? MIDNIGHT`) and nowhere else, which is why
 *    it was a fact about one control rather than a rule.
 * 3. **A time with no day** is *no answer at all*, and `undefined` rather than
 *    `""` says so. A time alone is not a `datetime` the wire format can carry:
 *    there is no day to put it on, and inventing one — today, the epoch — would
 *    be the control answering a question nobody asked. The example reached the
 *    same place by disabling its clock until a day existed; the state still had
 *    to be representable, because the two halves are separate widgets and the
 *    widget the user can reach is not the one that enforces the rule.
 *
 * `""` and `undefined` are therefore different answers and the difference is the
 * rule: `""` is "nothing is selected" and the core decides what that means, and
 * `undefined` is "there is no answer a datetime could carry".
 */
export function dateTimeAnswerFrom(
  day: Date | undefined,
  time: ClockTime | undefined,
): string | undefined {
  if (day === undefined) {
    return time === undefined ? "" : undefined;
  }
  return formatDateTimeAnswer({ date: day, time: time ?? MIDNIGHT });
}

/**
 * The value an unanswered temporal field holds: `null`.
 *
 * `ControlValue<"string">` is `string | null` for `date`, `time` and `datetime`
 * alike, so all three share this one empty value rather than each deciding its
 * own: a temporal field with no answer is not an empty string date, it is no
 * answer, and the core is the authority on what that means.
 */
export function unansweredTemporalValue(): string | null {
  return null;
}
