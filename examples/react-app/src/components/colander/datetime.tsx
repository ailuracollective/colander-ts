import { defineControl } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";
import { cn } from "cn";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** What the trigger says when nothing has been answered yet. */
const PLACEHOLDER = "Pick a date and time";

/**
 * A `datetime` field: the core's answer is text, and this control is one decision.
 *
 * A datetime is a day and a clock, and it is edited as the two things it is: a
 * calendar for the day, a time field for the clock, side by side in one popover.
 * Neither half disturbs the other — choosing a day keeps the time that was
 * already answered, and setting a time keeps the day — and what leaves is the
 * same `YYYY-MM-DDTHH:mm` the native field used to send.
 *
 * That "what leaves" is the compiler's, and it is the one rule in the family that
 * is a decision rather than a translation: a day with no time is completed to the
 * first minute of that day, and a time with no day is no answer at all. The
 * second half is why the clock below is disabled until a day exists — a time
 * alone is not a datetime the wire format can carry — and it is also why this
 * control reports the utility's "no answer" as the host contract's `null`.
 */
export default defineControl("datetime", ({ id, value, onChange, disabled, readOnly }) => {
  const parts = typeUtilities.datetime.parseAnswer(value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/*
         * The shell points the label's `htmlFor` at the control's id, and with a
         * popover the trigger button is the element that takes focus, so the id
         * belongs here. `type="button"` keeps it from submitting a form it sits
         * inside, which the input this control replaced could not do.
         */}
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled || readOnly}
          className={cn(
            "w-full justify-start font-normal",
            parts === undefined && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-4 opacity-50" />
          {parts === undefined
            ? PLACEHOLDER
            : // The two halves are shown as themselves: a day, then the clock half
              // of the answer, which is a time of day in its own right.
              `${format(parts.date, "PPP")}, ${typeUtilities.time.formatAnswer(parts.time)}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={
            parts === undefined
              ? undefined
              : typeUtilities.datetime.dateWithTime(parts.date, typeUtilities.datetime.midnight)
          }
          onSelect={(day) => onChange(typeUtilities.datetime.answerFrom(day, parts?.time) ?? null)}
        />
        <div className="border-t p-2">
          <Input
            type="time"
            // A clock with no day is not a datetime the wire format can carry, so
            // the time is only offered once a day has been answered.
            disabled={parts === undefined}
            value={parts === undefined ? "" : typeUtilities.time.formatAnswer(parts.time)}
            onChange={(event) => {
              const chosen = typeUtilities.time.parseAnswer(event.currentTarget.value);
              // A clock the user cleared is not "midnight". The utility's rule
              // completes a *day* that has no time of its own; this is the widget
              // reporting that it has nothing, and answering it would replace a
              // cleared field with an invented instant.
              if (parts === undefined || chosen === undefined) {
                return;
              }
              onChange(typeUtilities.datetime.answerFrom(parts.date, chosen) ?? null);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
});
