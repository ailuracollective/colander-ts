import { defineControl } from "@ailura/colander-compiler/contracts";
import { typeUtilities } from "@ailura/colander-compiler/utilities";
import { cn } from "cn";
import { ClockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** What the trigger says when nothing has been answered yet. */
const PLACEHOLDER = "Pick a time";

/**
 * A `time` field: the core's answer is text, and this control is one decision.
 *
 * A time has no calendar to pick from, so what opens the popover is a time field
 * and no month grid. The browser's own field is kept for the choosing, because it
 * already knows the locale, the keyboard and the platform picker; what this adds
 * is the trigger the shell's label points at.
 *
 * The trigger shows the wire shape itself, `HH:mm`, because that is exactly what
 * the answer is: this control used to hand the time to a `Date` on today's date
 * and format that, which bought a locale call and no other meaning, since a time
 * of day carries no date.
 */
export default defineControl("time", ({ id, value, onChange, disabled, readOnly }) => {
  const time = typeUtilities.time.parseAnswer(value);
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
            time === undefined && "text-muted-foreground",
          )}
        >
          <ClockIcon className="size-4 opacity-50" />
          {time === undefined ? PLACEHOLDER : typeUtilities.time.formatAnswer(time)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto" align="start">
        <Input
          type="time"
          value={time === undefined ? "" : typeUtilities.time.formatAnswer(time)}
          onChange={(event) =>
            onChange(
              typeUtilities.time.answerFrom(
                typeUtilities.time.parseAnswer(event.currentTarget.value),
              ),
            )
          }
        />
      </PopoverContent>
    </Popover>
  );
});
