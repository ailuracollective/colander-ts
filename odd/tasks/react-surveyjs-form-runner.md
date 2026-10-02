# Build a React + SurveyJS form runner over the NestJS colander backend

## Objective

Add `examples/react-app`: a React application that consumes the existing NestJS API in
`examples/nest-app` and lets a person fill in a colander form. SurveyJS renders the form, the
backend stays the engine: every answer change is evaluated by `/forms/evaluate-rules` and the
returned `visibility`, `enabled`, `required` and `calculatedValues` are applied back onto the
SurveyJS model. Submission is validated by `/forms/validate-response`.

## Problem

A colander `formSchema` is **not** a SurveyJS survey definition. Colander describes data:

```json
{ "schemaVersion": "1.0.0", "fields": [{ "id": "weight-kg", "code": "body.weight.kg", "type": "number" }] }
```

SurveyJS describes presentation:

```json
{ "elements": [{ "type": "text", "name": "body.weight.kg", "inputType": "number" }] }
```

SurveyJS therefore cannot render a colander form until something translates one into the other.
That translator, plus the round trip that keeps the SurveyJS model in sync with the rule engine,
is the substance of this feature. The front is a renderer and an interaction surface; colander
remains the only source of truth for what is visible, required, enabled and calculated.

A second, quieter trap: colander keys **different maps by different things**. `values` and
`calculatedValues` are keyed by field **code**; `visibility`, `enabled` and `required` are keyed by
field **id**. The bridge must carry both, so the translator emits a code↔id index alongside the
survey definition.

## Why

The repository already proves that a NestJS consumer can drive the WebAssembly core through real
public operations. What it does not show is the thing the core exists for: a human filling in a
form while the rules engine answers on every keystroke. This closes that loop with a real form
renderer rather than a hand-rolled input list.

## Scope

- Scaffold a Vite + React + TypeScript application at `examples/react-app`.
- Isolate it as its own pnpm workspace root, mirroring `examples/nest-app`, so the library's
  workspace and lockfile stay untouched.
- Install **shadcn** from its latest CLI and add the components the runner needs.
- Install the **SurveyJS agent skills** from the official `surveyjs-cli`, and install
  `survey-core` + `survey-react-ui`.
- Add a pure translator from a colander `formSchema` to a SurveyJS survey definition, carrying the
  code↔id index.
- Add the runner: SurveyJS model, debounced `evaluate-rules` round trip, rule application,
  Draft/Complete validation, and error mapping back to fields.
- Bundle the two sample form+rules pairs (BMI calculation, blood-pressure cross-field validation)
  so the app is usable on first load without copying files by hand.
- Add `examples/react-app/README.md` documenting prerequisites, run, and how the loop works.

## Constraints

- Do not change library behavior, `src/`, the package export map, the root lockfile, or root test
  configuration.
- Do not change `examples/nest-app`'s public contract. Front-end reachability is solved with the
  Vite dev proxy, not by editing the Nest bootstrap.
- Every `…Json` field on the wire is JSON **held as a string**. The front must send
  `JSON.stringify` of the document exactly once and must never send a parsed document.
- `values` sent to `evaluate-rules` are keyed by field **code**; rules come back keyed by field
  **id**. Never conflate them.
- Use English for technical artifacts, comments, and UI copy.

## Work units

- [x] **T1 — Scaffold the React application.** Create `examples/react-app` with Vite, React 19, and
  TypeScript strict, isolated by its own `pnpm-workspace.yaml`. Route: delegated writer; trigger:
  CLI output is broad and noisy and produces many files.
- [x] **T2 — Install shadcn and its components.** Run the shadcn CLI at its latest version, then add
  the components the runner uses. Route: delegated writer, same unit as T1 (installation noise).
- [x] **T3 — Install the SurveyJS skills and packages.** Run `surveyjs-cli init-agents` so the
  project carries SurveyJS guidance, and install `survey-core` + `survey-react-ui`. Route:
  delegated writer, same unit as T1.
- [x] **T4 — Write the translator.** Pure `formSchema` → SurveyJS survey definition plus a code↔id
  index, with unit tests for the type mapping, `readOnly`, and the index. Route: delegated writer;
  trigger: coordinated non-trivial files with a real design surface.
- [x] **T5 — Build the runner.** SurveyJS model, debounced `evaluate-rules`, rule application,
  Draft/Complete validation, and `ResponseError.path` → field mapping. Route: delegated writer,
  same unit as T4 (T5 consumes T4's index, so one writer avoids an interface negotiation).
- [x] **T6 — Write the README and verify.** Document prerequisites and run commands, then observe
  build, typecheck, lint, and a live round trip against the running backend. Route: delegated
  writer for the focused runtime check; parent retains final structural readback.

## Acceptance criteria

- `examples/react-app` builds with `pnpm build` and runs with `pnpm dev`.
- The app renders the BMI sample through SurveyJS and, when weight and height are filled, shows the
  calculated BMI that the **backend** computed (22.86 for 70 / 1.75²), not one computed in the browser.
- Filling the blood-pressure sample and validating in `Complete` mode surfaces the
  `BP_SYSTOLIC_GT_DIASTOLIC` rejection.
- A field that the rules engine marks not-required is not required by the rendered form, and a
  field marked read-only cannot be typed into.
- The translator has unit tests covering the type mapping and the code↔id index.
- `git status` at the repository root shows no change to `package.json`, `pnpm-lock.yaml`, or
  `pnpm-workspace.yaml`.

## TDD and checks

- Effective TDD mode: not configured for this repository; ordinary functional checks are required.
- Prerequisite: the Nest example must be running (`pnpm --dir examples/nest-app start`) for any
  live check.
- Example checks: `pnpm --dir examples/react-app build`, `pnpm --dir examples/react-app test`,
  `pnpm --dir examples/react-app lint`.
- Runtime check: run the dev server, load the BMI sample, fill weight and height, and read the
  calculation that appears; then submit the BP sample in `Complete` mode and read the error.
- Structural checks: the nested workspace root, the shadcn components present under
  `src/components/ui`, the SurveyJS skill files, and the root diff/status.
- Root regression checks: `pnpm exec vp check` and `pnpm test` at the repository root.

## Work-unit and delivery forecast

- Estimated authored change: about 700 lines excluding CLI scaffolding, generated components, and
  lockfiles. This exceeds the ~400-line planning heuristic; the excess is the translator plus its
  tests and the runner, which are one coherent behavior and are not separable without shipping a
  translator nothing consumes.
- Delivery strategy: `ask-on-risk` (default). Decision on splitting is deferred until the actual
  diff size is known.
- Rollback boundary: remove `examples/react-app/`; nothing outside it is touched.
- Commit evidence: pending; the user did not request a commit. No work-unit commit exists, so no
  review candidate exists either — see the review note in Progress.
- Engram mirror: pending; Engram tools are not exposed in this runtime.

## Authorized scope

The user explicitly asked for a React front over the NestJS backend with shadcn from the CLI and
SurveyJS from the CLI, and selected the translated form-runner approach over a full endpoint
playground or the SurveyJS Creator.

## Progress

Feature document created before the first source write.

- Decision recorded: the front is a **form runner**, not an endpoint playground and not the
  SurveyJS Creator. Chosen by the user.
- Baseline observed: the working tree already carries the uncommitted `nest-colander-example`
  feature (`vite.config.ts` modified, `examples/` and `odd/tasks/nest-colander-example.md`
  untracked) on branch `feat/nest-colander-example`. This feature builds on top of that state and
  does not commit it.
- T1–T3 implemented and checked. Vite + React 19 + TS scaffolded at `examples/react-app` under its
  own nested `pnpm-workspace.yaml`. shadcn CLI **4.21.0**: `-b` is no longer a colour in this
  version (it selects the component library, `radix|base|aria`), so `init -t vite -b radix -p nova
  -y` was used and `components.json` confirms `baseColor: "neutral"`. 11 components added plus
  `tooltip`. `surveyjs-cli 0.2.0` with `--client=agents-md` wrote 45 skill files under
  `.agents/skills/` and an `AGENTS.md` section, and installed `survey-core@3.1.0` +
  `survey-react-ui@3.1.0`. Isolation confirmed: the root workspace pins
  `vite@* → vite-plus-core`, while `react-app` resolved plain `vite 8.3.0`.
- Deviation corrected by the parent: the delegated writer kept `baseUrl` and suppressed its
  TypeScript 6 deprecation with `ignoreDeprecations: "6.0"` — a suppression that breaks on TS 7.
  The parent removed `baseUrl` from both tsconfigs, confirmed `pnpm build` still passes, and
  confirmed the shadcn CLI still resolves `@/` aliases by adding `tooltip` successfully afterwards.
- T4–T5 implemented and checked. `to-survey.ts` (pure translator), `apply-rules.ts`, `api.ts`,
  `colander-types.ts`, `samples.ts`, four components, and 31 tests across two spec files.
- T6 checked. Observed by the **parent**, independently of the writer:
  - `pnpm test` → 2 files, **31 passed**.
  - `pnpm build` → exit 0.
  - `pnpm exec vp check` at the root → all 13 files formatted, no lint or type errors.
  - Root `pnpm test` → **17 passed**.
  - A live front run on port 5199 served `<title>colander form runner</title>` and
    `GET /api/forms/core` through the Vite proxy returned
    `{"abiVersion":1,"versionInfo":{"name":"colander","version":"0.1.0","abi":1}}`.
  - A parent-authored temporary integration spec (written, run, then deleted) drove the app's real
    `toSurvey` + `coerceAnswers` + `applyEvaluation` against the live backend and observed:
    a `group` translating to a `panel` with **no `name`** whose children stayed flat in
    `model.data` as `{"inner.a":"hello","inner.b":7}` with **no `grp` key**; the BMI calculation
    landing `22.86` on the model with the field forced read-only; and the BP pair rejected with
    `BP_SYSTOLIC_GT_DIASTOLIC` in `Complete` while `Draft` returned `isValid: true`.
- Deviation recorded by the writer, verified rather than obeyed: the brief named
  `survey-core/defaultV2.min.css`, which does not exist in `survey-core@3.1.0`. The writer imported
  `survey-core/survey-core.css` plus the emitted `shadcn-base-nova` theme adapter instead. The
  writer also probed the brief's panel-nesting premise and found that in 3.1.0 a named panel did
  **not** nest. The unnamed-panel rule was followed regardless, and the parent's own live test
  confirms children stay flat, so the outcome is correct either way.
- **Not verified:** no browser driver was available, so the rendered UI was never visually
  confirmed. React paint, SurveyJS visual rendering, and the shadcn theme adapter's appearance are
  unverified. Everything above is API- and module-level evidence, not a screenshot.
- Review note: the native preflight (`gentle-ai review status --next-transition`, read-only) returned
  `applicability: "unrelated"` and a projection whose `paths` are only `vite.config.ts`, because all
  of this feature's work is **untracked**. It requires `intended_untracked_selection`, and its only
  tracked path belongs to the previous feature. A correct candidate therefore cannot be formed until
  the work is committed. No review lifecycle was started, deliberately: binding a candidate of one
  file from a different feature would be wrong, and the ODD contract makes the work-unit commit the
  review candidate.
- Next step: the user decides whether to commit the work, which would let a valid review candidate
  be formed; and whether to visually confirm the UI in a browser.
