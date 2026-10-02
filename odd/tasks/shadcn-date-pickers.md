# shadcn date pickers for the temporal controls

The `date`, `datetime` and `time` controls were native `<Input type="date" | "datetime-local" | "time">`
elements, one decision per type, all sharing `TemporalInput` in `shared.tsx`. The reference is the
shadcn/ui Date Picker page, which is not a registry component but a documented composition:

```
Popover
├── PopoverTrigger
└── PopoverContent
    └── Calendar
```

The `react-app` example had neither `Popover` nor `Calendar`, nor `react-day-picker` and `date-fns`.
This feature installs the two primitives and rebuilds the three temporal controls on that composition.

## Decisions

- **Base: Radix.** The example is configured `style: radix-nova` and already depends on `radix-ui`.
  The Base UI flavour of the reference page would introduce a second primitive library in one app.
- **All three types.** `date` and `datetime` get a `Calendar`; `time` gets a time field inside a
  popover, because a time has no calendar and the native time input already covers locale, keyboard
  and mobile better than any hour/minute grid would.
- **The wire format does not change.** The core declares these types as `string` and the current
  controls emit what the native inputs emit. That is the format the transport and `samples.ts`
  already carry, so it stays: `date` is `YYYY-MM-DD`, `time` is `HH:mm`, `datetime` is
  `YYYY-MM-DDTHH:mm`.
- **Local calendar dates, never UTC.** `new Date("2026-01-05")` is UTC midnight and renders as the
  4th west of Greenwich. Every parse builds a local date and every format reads local fields, with a
  round-trip check so `2026-02-30` is rejected rather than silently rolled into March.
- **The control keeps the `id`.** `shell.tsx` points `FieldLabel`'s `htmlFor` at the control id. With
  a popover the focusable element is the trigger button, so the id moves there, which keeps the
  label click focusing the control and keeps the label associated with it.

## Tasks

- [ ] T1 Install `Popover` and `Calendar` into the example, with `react-day-picker` and `date-fns`.
- [ ] T2 Temporal parsing and formatting helpers in `shared.tsx`, with the round-trip validation.
- [ ] T3 `date.tsx` as `Popover` + `Calendar mode="single"`.
- [ ] T4 `time.tsx` as `Popover` + a time field.
- [ ] T5 `datetime.tsx` as `Popover` + `Calendar` + a time field, where each keeps the other's part.
- [ ] T6 Verify: format, lint, typecheck, tests, and the compiler's control inventory.

## Verification

- `cd examples/react-app && pnpm run fmt:check && pnpm run lint`
- `cd examples/react-app && pnpm exec tsc -b`
- `cd examples/react-app && pnpm run test`
- `cd examples/react-app && pnpm run generate` then `pnpm run check:generated`

## Notes

- `examples/` is not versioned in this repository, so this feature produces no commit.
- The example's `pnpm-workspace.yaml` carries a local `minimumReleaseAge: 0`; see the file comment.
- `colander generate` currently fails on the pre-existing `outDir` plugin option, so T6's last two
  commands are expected to fail for that reason and not because of this feature.

## Commits

None. `examples/` and `odd/` are gitignored by decision.
