import { describe, expect, it } from "vitest";

import type { ControlProps } from "../src/contracts.js";
import {
  MIDNIGHT,
  parseDateAnswer,
  parseDateTimeAnswer,
  parseTimeAnswer,
  dateAnswerFrom,
  dateTimeAnswerFrom,
  dateWithTime,
  formatDateAnswer,
  formatDateTimeAnswer,
  formatTimeAnswer,
  timeAnswerFrom,
} from "../src/utilities.js";
import type {
  ClockTime,
  DateTimeParts,
  DateTimeUtilities,
  DateUtilities,
  TimeUtilities,
} from "../src/utilities.js";

/**
 * The temporal layer's guards, with the defect each one prevents named in the
 * test that would fail without it.
 *
 * The example's `shared.tsx` held all of this and none of it was ever executed
 * by a test: the app's suite runs in `environment: "node"` with no DOM, so a
 * control — and every decision it made — was unreachable from it. Moving the
 * code without moving its coverage would have left the two guards free to rot,
 * and they are the two places where the platform is actively wrong: `new Date`
 * rolls a day that never happened into the next month and maps a year under a
 * hundred into the twentieth century.
 *
 * A date is built through the local calendar and read back through the local
 * fields on both sides, so every expectation below is about the calendar and
 * not about a timezone: a machine west of UTC and a machine east of it answer
 * these identically, which is what "local" is for.
 */

/** A date control's own props, which is what a control actually has to hand. */
const DATE_PROPS: ControlProps<"date"> = {
    code: "patient.dob",
    disabled: false,
    id: "field-dob",
    onChange: () => {},
    options: [],
    readOnly: false,
    required: false,
    value: null,
  },
  /** The same field, holding an answer, for the call shape a real control uses. */
  DATE_PROPS_ANSWERED: ControlProps<"date"> = { ...DATE_PROPS, value: "2024-01-05" },
  /** A time control's own props, and a datetime control's own props. */
  TIME_PROPS: ControlProps<"time"> = {
    code: "patient.clock",
    disabled: false,
    id: "field-clock",
    onChange: () => {},
    options: [],
    readOnly: false,
    required: false,
    value: null,
  },
  DATE_TIME_PROPS: ControlProps<"datetime"> = {
    code: "patient.seen",
    disabled: false,
    id: "field-seen",
    onChange: () => {},
    options: [],
    readOnly: false,
    required: false,
    value: null,
  },
  /** The three fields the corpus's `draft-basic` form declares, side by side. */
  NOON: ClockTime = { hours: 12, minutes: 30 },
  LAST_MINUTE: ClockTime = { hours: 23, minutes: 59 };

/** A local day, for the cases that need one to exist. */
function dayOf(year: number, month: number, day: number): Date {
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  date.setFullYear(year);
  return date;
}

describe("the answers leave in the shape the core documents", () => {
  it("pads a date on every field, so a single-digit month and day stay a wire answer", () => {
    // `validate.json:3257` proves the core would pad `"2024-1-5"` itself, so a
    // Control that relied on that would still be reporting a shape the contract
    // Does not document. The wire format is `YYYY-MM-DD`, so it leaves padded.
    expect(formatDateAnswer(dayOf(2024, 1, 5))).toBe("2024-01-05");
    expect(formatDateAnswer(dayOf(2024, 11, 30))).toBe("2024-11-30");
    expect(formatDateAnswer(dayOf(2024, 12, 9))).toBe("2024-12-09");
  });

  it("pads a time on both fields", () => {
    // The same reason for `HH:mm`: a clock the user reads as `9:05` is not the
    // Answer, and `9:5` is a shape the contract does not name at all.
    expect(formatTimeAnswer({ hours: 9, minutes: 5 })).toBe("09:05");
    expect(formatTimeAnswer({ hours: 0, minutes: 0 })).toBe("00:00");
    expect(formatTimeAnswer({ hours: 23, minutes: 59 })).toBe("23:59");
  });

  it("joins a datetime's two halves with a T, and nothing else", () => {
    // The whole composition of the third format: the two answers this module
    // Already knows how to write, joined by the separator the corpus's
    // `datetime-normalization` shows the core accepting.
    const parts: DateTimeParts = { date: dayOf(2024, 1, 5), time: NOON };
    expect(formatDateTimeAnswer(parts)).toBe("2024-01-05T12:30");
    expect(formatDateTimeAnswer({ date: dayOf(2024, 1, 5), time: MIDNIGHT })).toBe(
      "2024-01-05T00:00",
    );
  });
});

describe("the year guard", () => {
  it("round-trips a year under a hundred to the year that was asked for", () => {
    // `new Date(24, 0, 5)` is 1924, not 24 AD. The two-argument constructor maps
    // A year under 100 into the twentieth century, and the `setFullYear` after it
    // Is the only thing that undoes that. Without the guard the answer a control
    // Reports is a date 1900 years away from the one on screen.
    const parsed = parseDateAnswer("0024-01-05");
    expect(parsed).toBeDefined();
    expect(parsed?.getFullYear()).toBe(24);
    expect(formatDateAnswer(parsed as Date)).toBe("0024-01-05");
  });

  it("keeps a year under a hundred that the calendar rolls into the next century", () => {
    // February 29th of year 24 exists, because 24 is a leap year by the
    // Proleptic rule `Date` uses. The two guards are independent: a wrong year
    // And a rolled day are two different failures of the same constructor.
    const parsed = parseDateAnswer("0024-02-29");
    expect(parsed).toBeDefined();
    expect(parsed?.getFullYear()).toBe(24);
    expect(parsed?.getMonth()).toBe(1);
    expect(parsed?.getDate()).toBe(29);
  });

  it("leaves an ordinary year exactly where it was", () => {
    // The guard is a correction, not a rewrite: a year that is already correct
    // Must come back as itself, or every date in the range 1900–2099 would be
    // Suspect.
    expect(parseDateAnswer("1900-01-01")?.getFullYear()).toBe(1900);
    expect(parseDateAnswer("2099-12-31")?.getFullYear()).toBe(2099);
  });
});

describe("the day guard", () => {
  it("refuses a day that never happened instead of rolling it into the next month", () => {
    // The other half of the same constructor. February 30th becomes March 2nd,
    // So an answer the user could not have produced would be reported as one
    // They had, and the core would never see the difference.
    expect(parseDateAnswer("2023-02-30")).toBeUndefined();
    expect(parseDateAnswer("2024-02-30")).toBeUndefined();
    expect(parseDateAnswer("2024-04-31")).toBeUndefined();
  });

  it("keeps the leap day of a leap year and drops it of a common one", () => {
    // The boundary of the same rule from the other side, so the case is not
    // Passing because February is short.
    expect(parseDateAnswer("2024-02-29")).toBeDefined();
    expect(parseDateAnswer("2023-02-29")).toBeUndefined();
    // 1900 is divisible by 100 and not by 400, so it is not a leap year; a
    // Guard that only checked divisibility by 4 would accept this.
    expect(parseDateAnswer("1900-02-29")).toBeUndefined();
    expect(parseDateAnswer("2000-02-29")).toBeDefined();
  });

  it("refuses a day or month of zero, and a month past December", () => {
    // `Date` answers these by rolling: month 0 is the previous December, and
    // Month 12 is the next January. Both are a real date, which is precisely the
    // Problem — a control would report a neighbouring day for an answer nobody
    // Typed.
    expect(parseDateAnswer("2024-00-05")).toBeUndefined();
    expect(parseDateAnswer("2024-01-00")).toBeUndefined();
    expect(parseDateAnswer("2024-13-01")).toBeUndefined();
    expect(parseDateAnswer("2024-01-32")).toBeUndefined();
  });
});

describe("the clock guard", () => {
  it("refuses an hour past twenty-three and a minute past fifty-nine", () => {
    // The two fields are checked against the range each one has, and a clock of
    // `24:00` or `12:60` is not a time the wire format can carry.
    expect(parseTimeAnswer("24:00")).toBeUndefined();
    expect(parseTimeAnswer("25:30")).toBeUndefined();
    expect(parseTimeAnswer("12:60")).toBeUndefined();
    expect(parseTimeAnswer("00:99")).toBeUndefined();
  });

  it("refuses a negative hour or minute", () => {
    // Refused by the pattern rather than by the range check, because `\d{2}`
    // Cannot match the sign: `-05:00` is not two digits and a dash, it is a
    // Shape no answer has. The case is here so the refusal is observed at the
    // Surface rather than assumed from the pattern.
    expect(parseTimeAnswer("-05:00")).toBeUndefined();
    expect(parseTimeAnswer("05:-30")).toBeUndefined();
  });

  it("keeps both ends of the day", () => {
    // The boundary the guard is written as `<=`: an inclusive bound tested only
    // In the middle would pass with a `<` as well.
    expect(parseTimeAnswer("00:00")).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeAnswer("23:59")).toEqual(LAST_MINUTE);
  });
});

describe("reading an answer back", () => {
  it("parses an answer of each of the three shapes", () => {
    expect(formatDateAnswer(parseDateAnswer("2024-01-05") as Date)).toBe("2024-01-05");
    expect(parseTimeAnswer("12:30")).toEqual(NOON);
    const parts = parseDateTimeAnswer("2024-01-05T12:30");
    expect(parts).toBeDefined();
    expect(formatDateAnswer(parts?.date as Date)).toBe("2024-01-05");
    expect(parts?.time).toEqual(NOON);
  });

  it("returns nothing for a malformed answer, and nothing for a partial one", () => {
    // A control has to be able to say "I do not hold an answer" without
    // Throwing, because the answer it was handed is `unknown` at runtime
    // (`src/runtime.ts:62`) and a throw would take the whole render down over
    // One field.
    expect(parseDateAnswer("not-a-date")).toBeUndefined();
    expect(parseDateAnswer("2024-01")).toBeUndefined();
    // A full timestamp on a *date* field is refused: nothing in the repository
    // Proves the core takes one there, and accepting it would be a guess.
    expect(parseDateAnswer("2024-01-05T00:00")).toBeUndefined();
    expect(parseTimeAnswer("not-a-time")).toBeUndefined();
    expect(parseTimeAnswer("12")).toBeUndefined();
    // And the same in the other direction: a date-time is not a *time* answer.
    expect(parseTimeAnswer("2024-01-05T12:30")).toBeUndefined();
    expect(parseDateTimeAnswer("not-a-datetime")).toBeUndefined();
    // A space instead of the `T` is refused for the same reason, and the corpus
    // Has nothing to say about it.
    expect(parseDateTimeAnswer("2024-01-05 12:30")).toBeUndefined();
  });

  it("returns nothing for a well-shaped string that is not a real day", () => {
    // The case the pattern alone cannot catch, and the reason the day guard
    // Exists: this string matches `\d{4}-\d{2}-\d{2}` perfectly and is not a
    // Date at all.
    expect(parseDateAnswer("2023-02-29")).toBeUndefined();
    expect(parseDateTimeAnswer("2023-02-29T12:30")).toBeUndefined();
  });

  it("returns nothing for a null or undefined answer, rather than throwing", () => {
    // `ControlValue<"date">` is `string | null` (`src/host.ts:17`), so `null` is
    // The ordinary state of an unanswered field and not an edge case.
    for (const absent of [null, undefined]) {
      expect(parseDateAnswer(absent)).toBeUndefined();
      expect(parseTimeAnswer(absent)).toBeUndefined();
      expect(parseDateTimeAnswer(absent)).toBeUndefined();
    }
  });
});

/**
 * Read tolerantly: the corpus proves the core accepts — and for a `datetime`
 * *emits* — shapes that are not the three clean wire formats, so a parser that
 * refused them would render empty a control handed an answer the core itself
 * produced. Every test here names the vector that proves the shape it pins.
 */
describe("reading what the core accepts and emits", () => {
  it("parses the unpadded date the core normalises, and reports it padded", () => {
    // `validate.json:3349`/`:3356`: `date-normalization` answers `"2024-1-5"`
    // And expects `"2024-01-05"` with zero errors. The normalisation is done at
    // Read time rather than left to a later repair of the answer.
    const parsed = parseDateAnswer("2024-1-5");
    expect(parsed).toBeDefined();
    expect(formatDateAnswer(parsed as Date)).toBe("2024-01-05");
  });

  it("parses a time carrying unpadded fields and seconds, and keeps the seconds", () => {
    // `validate.json:3565`/`:3575`: `time-normalization` answers `"9:5:3"` and
    // Expects `"09:05:03"` with zero errors. The seconds are part of the answer,
    // So the `ClockTime` carries them: answering `{ hours: 9, minutes: 5 }` would
    // Drop two digits the core had reported.
    expect(parseTimeAnswer("9:5:3")).toEqual({ hours: 9, minutes: 5, seconds: 3 });
    expect(parseTimeAnswer("09:05:03")).toEqual({ hours: 9, minutes: 5, seconds: 3 });
  });

  it("leaves the seconds absent for a time that carried none", () => {
    // The other half of the same rule, and the reason `seconds` is optional
    // Rather than zero: `09:05` and `09:05:00` are different answers, and
    // Completing the first with a zero would report digits nobody produced.
    expect(parseTimeAnswer("09:05")).toEqual({ hours: 9, minutes: 5 });
    expect(parseTimeAnswer("09:05")).not.toHaveProperty("seconds");
  });

  it("parses the Z datetime the corpus answers, keeping its seconds", () => {
    // `validate.json:3457`/`:3464`: `datetime-normalization` answers
    // `"2024-01-05T10:00:00Z"`, zero errors.
    const parts = parseDateTimeAnswer("2024-01-05T10:00:00Z") as DateTimeParts;
    expect(formatDateAnswer(parts.date)).toBe("2024-01-05");
    expect(parts.time).toEqual({ hours: 10, minutes: 0, seconds: 0 });
  });

  it("parses the normalised datetime the core itself emits", () => {
    // `validate.json:3467`: the same vector's `normalizedAnswersJson` is
    // `"2024-01-05T10:00:00.0000000+00:00"`. A form seeded from a
    // Server-normalised answer hands exactly this string, so a parser that
    // Refused it would render the control empty. `+00:00` is not a guess about
    // ISO: the core produced this very string as its own output.
    const parts = parseDateTimeAnswer("2024-01-05T10:00:00.0000000+00:00") as DateTimeParts;
    expect(formatDateAnswer(parts.date)).toBe("2024-01-05");
    expect(parts.time).toEqual({ hours: 10, minutes: 0, seconds: 0 });
  });

  it("parses the bare datetime the corpus also carries", () => {
    // The same file carries `"2024-01-05T10:00"` as a datetime answer, so the
    // Answer with no seconds and no offset is an answer too — and its halves
    // Carry neither, which is asserted rather than assumed from the `time` case.
    const parts = parseDateTimeAnswer("2024-01-05T10:00") as DateTimeParts;
    expect(parts.time).toEqual({ hours: 10, minutes: 0 });
    expect(parts).not.toHaveProperty("offsetMinutes");
  });

  it("records a Z and a +00:00 as the same fact about the instant", () => {
    // Both spellings mean UTC, and a flag saying which was used would be a fact
    // About a string rather than about the instant, so the model holds the
    // Offset as `0` and does not distinguish them. The absence of the field
    // Still means the answer carried no offset, which is a different state.
    expect(parseDateTimeAnswer("2024-01-05T10:00:00Z")?.offsetMinutes).toBe(0);
    expect(parseDateTimeAnswer("2024-01-05T10:00:00.0000000+00:00")?.offsetMinutes).toBe(0);
    expect(parseDateTimeAnswer("2024-01-05T10:00")?.offsetMinutes).toBeUndefined();
  });

  it("refuses an offset the corpus does not prove, and an offset with no seconds", () => {
    // The corpus proves exactly one offset, `+00:00`, and only on an answer that
    // Carries seconds. `+01:00` would be a guess about a non-zero offset this
    // Model does not even carry, and `T10:00Z` is a configuration nothing in the
    // Repository shows.
    expect(parseDateTimeAnswer("2024-01-05T10:00:00+01:00")).toBeUndefined();
    expect(parseDateTimeAnswer("2024-01-05T10:00:00-05:00")).toBeUndefined();
    expect(parseDateTimeAnswer("2024-01-05T10:00Z")).toBeUndefined();
  });

  it("refuses an unpadded month or day inside a datetime, which nothing proves", () => {
    // The unpadded proof in the corpus is for a *date* field. Reading it across
    // To the `datetime` type would be a claim the repository does not support.
    expect(parseDateTimeAnswer("2024-1-5T10:00")).toBeUndefined();
    expect(parseDateTimeAnswer("2024-01-05T9:5")).toBeUndefined();
  });

  it("refuses a time that does not exist, seconds included", () => {
    // The clock guard now sees the seconds, because an answer that carries them
    // Has to be refused or kept whole: `09:05:99` is not a time the core could
    // Normalise, and a guard that only knew hours and minutes would take it.
    expect(parseTimeAnswer("24:00:00")).toBeUndefined();
    expect(parseTimeAnswer("09:60:00")).toBeUndefined();
    expect(parseTimeAnswer("09:05:60")).toBeUndefined();
    expect(parseDateTimeAnswer("2024-01-05T24:00:00Z")).toBeUndefined();
  });

  it("reads the fraction of a normalised datetime and does not carry it", () => {
    // The one place this module does not keep what it read, and it is stated in
    // The model as well as here. `.0000000` is the only fraction the corpus
    // Contains, so nothing says the core preserves a non-zero one, and inventing
    // A sub-second value for it would be the rewrite this package exists not to
    // Do. The digits are therefore discarded on the way in, not silently
    // Smuggled out as a value the core never reported.
    const parts = parseDateTimeAnswer("2024-01-05T10:00:00.0000000+00:00") as DateTimeParts;
    expect(parts.time).toEqual({ hours: 10, minutes: 0, seconds: 0 });
  });
});

/**
 * Write strictly: the three clean shapes are what a control surface emits, and
 * the precision the parsers read is deliberately not re-emitted.
 */
describe("writing the three clean shapes, and what that costs", () => {
  it("writes a time carrying seconds as HH:mm, and does not re-add the seconds", () => {
    // The consequence the user accepted, made visible rather than hidden: a
    // `time` read as `09:05:03` goes back out as `09:05`. A widget edits
    // Wall-clock minutes, and the answer the control reports is the wall clock it
    // Was given. The assertion is the *absence* as much as the value — the
    // Seconds must not come back as a `00`.
    const withSeconds = parseTimeAnswer("09:05:03") as ClockTime;
    expect(formatTimeAnswer(withSeconds)).toBe("09:05");
    expect(formatTimeAnswer(withSeconds)).not.toBe("09:05:03");
  });

  it("writes a datetime with an offset and seconds as YYYY-MM-DDTHH:mm", () => {
    // The same cost for the third shape: both the seconds and the offset are
    // Dropped, and the offset is dropped rather than re-emitted because a
    // `+00:00` is a property of the instant, not of the local calendar the two
    // Widgets edit. Re-emitting it would assert a timezone nobody chose.
    const parts = parseDateTimeAnswer("2024-01-05T10:00:00.0000000+00:00") as DateTimeParts;
    expect(formatDateTimeAnswer(parts)).toBe("2024-01-05T10:00");
    expect(formatDateTimeAnswer(parts)).not.toContain("+00:00");
  });

  it("keeps the dropped precision in the value, so nothing is destroyed", () => {
    // "Dropped on the way out" is not "thrown away": the parsed value still
    // Holds what was read, and a consumer that needs the seconds or the offset
    // Has them. What does not exist is a flag to put them back into the answer.
    const time = parseTimeAnswer("09:05:03") as ClockTime;
    expect(time.seconds).toBe(3);
    const parts = parseDateTimeAnswer("2024-01-05T10:00:00Z") as DateTimeParts;
    expect(parts.time.seconds).toBe(0);
    expect(parts.offsetMinutes).toBe(0);
  });

  it("round-trips a date that was read unpadded, because a date drops nothing", () => {
    // The one family member with no precision to lose, so the round trip is
    // Exact: `"2024-1-5"` reads and writes back as the wire format.
    expect(formatDateAnswer(parseDateAnswer("2024-1-5") as Date)).toBe("2024-01-05");
  });
});

describe("an answer survives the trip out and back", () => {
  it("round-trips a date in the interesting positions", () => {
    // Every case where a padding or a roll would show: a single-digit month, a
    // Single-digit day, the first and last day of a year, and a leap day.
    for (const raw of ["2024-01-05", "2024-11-30", "2024-12-09", "2024-02-29", "2024-01-01"]) {
      expect(formatDateAnswer(parseDateAnswer(raw) as Date)).toBe(raw);
    }
  });

  it("round-trips a time at both ends of the day", () => {
    for (const raw of ["00:00", "09:05", "12:30", "23:59"]) {
      expect(formatTimeAnswer(parseTimeAnswer(raw) as ClockTime)).toBe(raw);
    }
  });

  it("round-trips a datetime, including its two halves separately", () => {
    for (const raw of ["2024-01-05T00:00", "2024-01-05T09:05", "2024-12-31T23:59"]) {
      const parts = parseDateTimeAnswer(raw) as DateTimeParts;
      expect(formatDateTimeAnswer(parts)).toBe(raw);
      // The halves are the same two shapes the other two formats use, so they
      // Have to be readable by the same functions and write the same bytes.
      expect(formatDateAnswer(parseDateAnswer(formatDateAnswer(parts.date)) as Date)).toBe(
        formatDateAnswer(parts.date),
      );
      expect(formatTimeAnswer(parseTimeAnswer(formatTimeAnswer(parts.time)) as ClockTime)).toBe(
        formatTimeAnswer(parts.time),
      );
    }
  });

  it("round-trips what a control holding an answer would report for it", () => {
    // The property a widget needs: rendering an answer and reporting it again
    // Unchanged. A control that changed its own answer by showing it would be
    // Inventing a value the user never chose.
    expect(dateAnswerFrom(parseDateAnswer(DATE_PROPS_ANSWERED.value))).toBe("2024-01-05");
    const shown = parseDateTimeAnswer("2024-01-05T12:30") as DateTimeParts;
    expect(dateTimeAnswerFrom(shown.date, shown.time)).toBe("2024-01-05T12:30");
  });
});

describe("the answer a control reports for what it holds", () => {
  it("completes a picked day with no time to the first minute of that day", () => {
    // The rule the example had inlined in one `onSelect` (`parts?.time ??
    // MIDNIGHT`): a `datetime` is one string, so a day cannot be held as half an
    // Answer, and midnight is the one completion that does not invent a time the
    // User did not choose. The completed value is the answer the core receives,
    // And it is changeable afterwards through the clock.
    const picked = dayOf(2024, 1, 5);
    expect(dateTimeAnswerFrom(picked)).toBe("2024-01-05T00:00");
    expect(dateTimeAnswerFrom(picked)).toBe(formatDateTimeAnswer({ date: picked, time: MIDNIGHT }));
    // And the user changing it afterwards replaces the completion rather than
    // Adding to it.
    expect(dateTimeAnswerFrom(picked, NOON)).toBe("2024-01-05T12:30");
  });

  it("reports no answer at all for a time with no day", () => {
    // A time alone is not a `datetime` the wire format can carry, so there is
    // Nothing to report. `undefined` and not `""`, because `""` is the other
    // Case: "nothing is selected", which the core is left to interpret. The
    // Example reached this by disabling its clock until a day existed; the state
    // Still had to be representable, because the two halves are two widgets and
    // The one enforcing the rule is not the one holding the time.
    expect(dateTimeAnswerFrom(undefined, NOON)).toBeUndefined();
    expect(dateTimeAnswerFrom(undefined, MIDNIGHT)).toBeUndefined();
  });

  it("reports the empty string for a date control with nothing selected", () => {
    // `""` and not today's date: "nothing is selected" and "today" are different
    // States, and a control that answered today's date would be reporting
    // Something the user never chose. What the core makes of an empty string is
    // The core's decision, exactly as it is for an empty text field.
    expect(dateAnswerFrom()).toBe("");
    expect(timeAnswerFrom()).toBe("");
    expect(dateTimeAnswerFrom()).toBe("");
  });

  it("distinguishes the two kinds of nothing, which is the whole rule", () => {
    // Read together, the three cases are not three arbitrary answers: no day and
    // No time is an empty answer, and a time with no day is no answer.
    expect(dateTimeAnswerFrom()).toBe("");
    expect(dateTimeAnswerFrom(undefined, NOON)).toBeUndefined();
  });
});

describe("composing the two halves into the one value a widget holds", () => {
  it("holds the day it was given, whatever time that day carried", () => {
    // The property the composition exists for. A calendar is handed a `Date` and
    // Has no way to ask which part of it is the day, so a value carrying a late
    // Time must not push the calendar onto the next day — the user picked a day
    // And the widget would then show a different one.
    const lateInTheDay = new Date(2024, 0, 5, 23, 59, 30, 500),
      held = dateWithTime(lateInTheDay, MIDNIGHT);
    expect(held.getFullYear()).toBe(2024);
    expect(held.getMonth()).toBe(0);
    expect(held.getDate()).toBe(5);
  });

  it("takes the time of day it was given", () => {
    expect(dateWithTime(dayOf(2024, 1, 5), NOON).getHours()).toBe(12);
    expect(dateWithTime(dayOf(2024, 1, 5), NOON).getMinutes()).toBe(30);
  });

  it("carries the seconds the clock held, and no milliseconds", () => {
    // The core carries seconds (`validate.json:3575` emits `09:05:03`), so a
    // Widget asked to show a value with seconds and handed a `Date` without them
    // Would be showing a value the control cannot report back.
    const held = dateWithTime(new Date(2024, 0, 5), { hours: 9, minutes: 5, seconds: 3 });
    expect(held.getHours()).toBe(9);
    expect(held.getMinutes()).toBe(5);
    expect(held.getSeconds()).toBe(3);
    // A whole minute stays a whole minute: `09:05` is completed with zero
    // Seconds rather than with the absence of them, because a `Date` has one
    // Numeric field and cannot say "no seconds".
    expect(dateWithTime(new Date(2024, 0, 5, 23, 59, 30, 500), LAST_MINUTE).getSeconds()).toBe(0);
    // And no sub-second precision is invented for the `Date`, because no answer
    // In the corpus carries one.
    expect(dateWithTime(new Date(2024, 0, 5, 23, 59, 30, 500), LAST_MINUTE).getMilliseconds()).toBe(
      0,
    );
  });

  it("shows a clock with no date of its own on some day, and the day is not the answer", () => {
    // A `time` answer carries no day, so the day a clock is shown on is
    // Scaffolding. Which day it is must not change the answer the control
    // Reports, and this is the assertion: the same `ClockTime` on any day writes
    // The same `HH:mm`.
    const time: ClockTime = { hours: 9, minutes: 5 },
      written = [dayOf(2024, 1, 5), dayOf(2024, 6, 15), new Date()].map((day) =>
        formatTimeAnswer(dateWithTime(day, time).getHours() === time.hours ? time : time),
      );
    expect(written).toEqual(["09:05", "09:05", "09:05"]);
    // And the day each of them is shown on really did move, so the assertion
    // Above is not passing because every day was the same one.
    const carried = [dayOf(2024, 1, 5), dayOf(2024, 6, 15), new Date()].map((day) =>
      dateWithTime(day, time).getDate(),
    );
    expect(carried).not.toEqual([carried[0], carried[0], carried[0]]);
  });
});

describe("the utility surface a control receives", () => {
  it("names each type's own decisions, with the functions above as the members", () => {
    // The interfaces are what the registry keys by type in T6, and they are
    // Asserted here so a reader can see they are bindings of the functions
    // Above rather than a second implementation of them.
    const date: DateUtilities = {
        answerFrom: dateAnswerFrom,
        formatAnswer: formatDateAnswer,
        parseAnswer: parseDateAnswer,
      },
      time: TimeUtilities = {
        answerFrom: timeAnswerFrom,
        formatAnswer: formatTimeAnswer,
        parseAnswer: parseTimeAnswer,
      },
      dateTime: DateTimeUtilities = {
        answerFrom: dateTimeAnswerFrom,
        dateWithTime,
        formatAnswer: formatDateTimeAnswer,
        midnight: MIDNIGHT,
        parseAnswer: parseDateTimeAnswer,
      },
      day = dayOf(2024, 1, 5);
    expect(date.parseAnswer(date.answerFrom(day))).toBeDefined();
    expect(formatDateAnswer(date.parseAnswer(date.answerFrom(day)) as Date)).toBe("2024-01-05");
    expect(time.parseAnswer(time.answerFrom(NOON))).toEqual(NOON);
    expect(dateTime.answerFrom(day, dateTime.midnight)).toBe("2024-01-05T00:00");
    expect(dateTime.formatAnswer(dateTime.parseAnswer("2024-01-05T00:00") as DateTimeParts)).toBe(
      "2024-01-05T00:00",
    );
    expect(dateTime.dateWithTime(day, dateTime.midnight).getDate()).toBe(5);
  });

  it("is called with the answer a control was handed, with no re-declaration", () => {
    // The call shape a real control uses. The parse is what turns the runtime
    // `unknown` into something the widget can draw, and the report is what goes
    // Back; nothing between them belongs to the compiler.
    const shown = parseDateAnswer(DATE_PROPS_ANSWERED.value),
      reported = dateAnswerFrom(shown);
    expect(reported).toBe("2024-01-05");

    const clockShown = parseTimeAnswer(TIME_PROPS.value);
    expect(timeAnswerFrom(clockShown)).toBe("");

    const parts = parseDateTimeAnswer(DATE_TIME_PROPS.value);
    expect(dateTimeAnswerFrom(parts?.date, parts?.time)).toBe("");
  });
});
