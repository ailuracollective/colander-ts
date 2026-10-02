# T7 verification pass

Nothing in this file is a new feature. It is the list of claims the system makes,
and how each one is checked. Every item says what the evidence is, so a claim with
no evidence shows up as a line to fill rather than as a sentence in a report.

## Claims and their evidence

| Claim | How it is checked | Status |
|---|---|---|
| The published-version table cannot be edited or deleted while published | The SQLite trigger, asserted from a test that reads `sqlite_master` and refuses a bypass table | done |
| A form created through the API renders at `/forms/:id` | Real definition created over HTTP, published, rendered in a headless browser | done |
| The stored bytes are the bytes the core hashed | Recompute the stored hash from the stored text and compare with the stored hash; compare the stored text with what the client sent | done |
| An unanswered `choice` does not break a page | The core's value kind is never absent; a published form with an unanswered choice rendered in a browser | done |
| A panicked core is not cached | `packages/colander-browser` suite, and the react suite that exercises the same client | done |
| The editor round-trips a document byte for byte | Model tests with unknown keys injected at eight levels, asserted as exact string equality | done |
| The editor's address arithmetic matches the model | 40 tests asserting through `moveNode` and the resulting document, not through the index the drag sends | done |
| A drag moves a field | Scripted drag over CDP: `text, number, choice` becomes `choice, text, number` | done |
| A refused move is never swallowed | Refusal cases in the browser, surfaced in the header alert and beside the node | done |
| A keyboard drag never aims at the node it is carrying, and never releases silently | 11 new tests over every fixture node and both directions; browser sequence lift → ArrowUp → ArrowUp → Enter moves `text,number,choice` to `text,choice,number` | done |
| The first aim after a lift is a reorder wherever a reorder exists | The aim list is walked in three passes: `before` bands, then `inside`, then `after`, so both ends of the list — the only two places a lift opens — are sibling bands. Verified in the browser on a flat form ("Choice will go above Number") and on a nested one ("Group will go below Text"), and both moved the node | done |
| A drop never aims at a position the model will always refuse | The drop climbs: from the hovered node upward while it cannot receive the dragged node, inserting below the deepest node that could not, inside the first ancestor the model accepts. The drag layer asks the model's `canReceiveChild` for each node it climbs past and holds no rule of its own. 17 new tests, including a 60-pair sweep asserting the predicate equals `addField`'s outcome | done, and the keyboard aim list no longer offers an `inside` band on a node that cannot receive |
| Rule expressions round-trip and unknown operators survive | 41 tests in `rules.test.ts` against real fixtures, plus a browser pass over the kind switcher, the argument controls and the reference field | done |
| The operator list does not claim to be complete | The caption under the operator field, and no write path calling the list | done |
| A saved draft is stored and a published version freezes it | Browser round trip: load a stored draft, edit a title, watch the dirty state derive itself, save, publish. `PATCH` on the published version answers 409; clone opens version 2 as a draft; `/forms/:id` renders the published title | done |
| A stored version loads as the exact bytes that were stored | The editor loads the document text into the model without re-serialising, and the core's own verdict on the stored text is shown as computed by the resource, not guessed in the browser | done |
| A response is stored with the core's validation result, valid or not | To be checked in T6 | pending |
| Formatting is what the repository's formatter says it is | `vp fmt --check` clean in both examples | pending: T4c's five files |
| The two test suites are green | `npx vitest run` in each example, and the compiler package | pending T5/T6 |

## Commands

```bash
# compiler package
cd packages/colander-compiler && npx tsc -b && npx vitest run

# nest example
cd examples/nest-app && npx tsc -b && npx vitest run && npx vitest run --config ./vitest.config.e2e.ts

# react example
cd examples/react-app && npx tsc -b && npx vitest run && npx vp fmt --check
```

## The browser is part of the verification

Three defects in this feature were invisible to a green suite and were found by
using the app: an unanswered `choice` white-screening the runtime, a model index
that lost a node, and an end-of-list drag address refused as `ILLEGAL_INDEX`. A
verification pass that only runs commands would have closed all three.

The harness: `chromium-browser --headless=new --no-sandbox --disable-gpu
--remote-debugging-port=9333 <url>`, then `Runtime.evaluate` to act and
`Page.captureScreenshot` to look. Two rules learned the hard way: put a tick
between `dragstart` and `drop`, because React state does not re-render inside one
task; and never treat a CSS class match as evidence that state changed.

## The one thing no check here covers

A person grabbing a drag handle with a mouse. `Input.dispatchMouseEvent` produces
zero drag events in this headless Chromium, so every drag above was
event-dispatched. This needs a human, once.

## What must not be claimed without evidence

- That the operator vocabulary is complete. It is observed from corpora; the
  client types `op` as a `string` and the Rust core is not in this tree.
- That formatting was checked, until `vp fmt --check` is clean. It is checked now.
- That an e2e spec exercises the boot configuration. The definitions spec calls
  `app.setGlobalPrefix("api")` while the running app sets no prefix, so it cannot
  catch a mismatch.
