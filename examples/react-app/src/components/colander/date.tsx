import { defineControl } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";
import { cn } from "cn";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** What the trigger says when nothing has been answered yet. */
const PLACEHOLDER = "Pick a date";

/**
 * A `date` field: the core's answer is text, and this control is one decision.
 *
 * A date is a day, and a day is easier to point at than to type, so the answer
 * goes into a calendar inside a popover and the trigger shows what was chosen in
 * a form a person reads. Both halves of the wire format are the compiler's: it
 * reads the answer into a day the calendar can hold and writes the day back as
 * `YYYY-MM-DD`, so a cleared calendar reports an empty answer rather than today's
 * date. The `PPP` below is this app's own display choice, not a wire decision.
 */
export default defineControl("date", ({ id, value, onChange, disabled, readOnly }) => {
  const selected = typeUtilities.date.parseAnswer(value);
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
            selected === undefined && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="size-4 opacity-50" />
          {selected === undefined ? PLACEHOLDER : format(selected, "PPP")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(day) => onChange(typeUtilities.date.answerFrom(day))}
        />
      </PopoverContent>
    </Popover>
  );
});
