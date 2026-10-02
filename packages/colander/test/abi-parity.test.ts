/**
 * What the core exposes that the binding used to drop.
 *
 * Each case is a capability the sibling Rust core documents and this binding did
 * not surface: the `bump` of `colander_next_version`, the failure code of
 * SPEC C-11, the request cap of SPEC C-10, and the keys the core refuses
 * outright. The Rust suite proves the core is right; these tests prove the
 * boundary still tells the truth about it.
 */

import { describe, expect, it, vi } from "vite-plus/test";

import { COLANDER_MAX_REQUEST_BYTES, ColanderError, colander } from "../src/index.ts";
import type { ValidateSchemaRequest } from "../src/index.ts";

// Every case loads the engine once and the oversize case builds a 64 MiB string, so this
// Suite allows more than the default budget.
vi.setConfig({ testTimeout: 15_000 });

/** The cap the sibling core states in its generated header: 64 MiB. */
const CORE_REQUEST_CAP = 64 * 1_048_576;

/**
 * A workflow request as a caller that predates the retirement of `published` would send it.
 *
 * The key is not in `ValidateSchemaRequest` on purpose, so this is how it reaches the core.
 */
interface RetiredWorkflowRequest extends ValidateSchemaRequest {
  readonly published?: unknown;
}

/**
 * Runs `body` and returns the `ColanderError` it threw.
 *
 * @param {() => unknown} body Operation to run.
 * @returns {ColanderError} The thrown failure.
 */
function thrownBy(body: () => unknown): ColanderError {
  try {
    body();
  } catch (error) {
    if (error instanceof ColanderError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail, and it returned normally");
}

describe("the surface the binding has to keep", () => {
  it("nextVersion sends the bump the core accepts", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      published = ["1.2.3", "1.10.0", "1.9.9"];
    expect(core.nextVersion({ bump: "minor", published })).toBe("1.11.0");
    expect(core.nextVersion({ bump: "major", published })).toBe("2.0.0");
    expect(core.nextVersion({ bump: "patch", published })).toBe("1.10.1");
    expect(core.nextVersion({ published })).toBe("1.10.1");
  });

  it("nextVersion parses strictly, so a sloppy version is a typed failure", async () => {
    expect.hasAssertions();
    const core = await colander.load();
    for (const published of [["1..0.0"], ["01.0.0"], ["1.0.0-beta"], ["1.0"]]) {
      const label = published.join(","),
        error = thrownBy(() => core.nextVersion({ published }));
      expect(error.code, label).toBe("INVALID_SEMVER");
    }
  });

  it("a failure carries the code the core put in front of the message", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      error = thrownBy(() => core.compile({ formSchemaJson: "not json" }));
    expect(error.kind).toBe("validation");
    expect(error.code).toBe("JSON_PARSE_ERROR");
  });

  it("a message that opens with prose carries no code", () => {
    expect.hasAssertions();
    expect(new ColanderError("validation", "'mode' must be a string when present.").code).toBe("");
    expect(new ColanderError("panic", "WebAssembly trap: unreachable.").code).toBe("");
  });

  it("validateSchema reports a schema failure with its code", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      missing = core.validateSchema({
        instanceJson: JSON.stringify({}),
        kind: "instance",
        label: "thing",
        schemaJson: JSON.stringify({ required: ["id"], type: "object" }),
      });
    expect(missing).toHaveProperty("valid", false);
    expect(missing).toHaveProperty("code", expect.any(String));
    expect(missing).toHaveProperty("message", expect.stringContaining("Invalid thing:"));
  });

  it("the core refuses published for a workflow, so the type does not offer it", async () => {
    expect.hasAssertions();
    const core = await colander.load(),
      refused: RetiredWorkflowRequest = {
        kind: "workflow",
        published: ["1.0.0"],
        schemas: { workflowSchema: JSON.stringify({ type: "object" }) },
        workflowSchemaJson: JSON.stringify({ steps: [] }),
      };
    // A retired key is a payload rejection, so it answers rather than throws, exactly as an
    // Invalid document does.
    const outcome = core.validateSchema(refused);
    expect(outcome).toHaveProperty("valid", false);
    expect(outcome).toHaveProperty(
      "message",
      expect.stringContaining("'published' is not accepted"),
    );
  });

  it("refuses an oversized request before it reaches linear memory", async () => {
    expect.hasAssertions();
    expect(COLANDER_MAX_REQUEST_BYTES).toBe(CORE_REQUEST_CAP);
    const core = await colander.load(),
      error = thrownBy(() =>
        core.contentHash({ formSchemaJson: "x".repeat(COLANDER_MAX_REQUEST_BYTES) }),
      );
    expect(error.kind).toBe("invalid_request");
    expect(error.code).toBe("REQUEST_TOO_LARGE");
  });
});
