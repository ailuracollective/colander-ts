/* eslint-disable sort-vars, one-var */
import { describe, expect, it, vi } from "vite-plus/test";

import engineSource from "../scripts/wasm-engine-source.mjs";

const {
  DEFAULT_GITHUB_ASSET,
  REMOVED_FUNCTION,
  REQUIRED_FUNCTIONS,
  assertReleaseDigestSatisfied,
  assertRequiredExports,
  parseEngineSource,
  parseExpectedArtifactSha256,
} = engineSource;

vi.setConfig({ testTimeout: 5000 });

const DIGEST_LENGTH = 64,
  OFF_BY_ONE = 1,
  // The eleven engine entry points are a pinned ABI surface, not an incidental count.
  PINNED_EXPORT_COUNT = 11,
  EXPECTED_DIGEST = "a".repeat(DIGEST_LENGTH),
  // An absent optional value is an empty string in this workspace, so a blank variable is "unset".
  UNSET_VALUES = ["", "   "],
  INVALID_SOURCES = [
    "colander@0.1.0",
    "registry:colander@0.1.0",
    "crate:colander@0.1.0",
    "crate:colander",
    "github:ailuracode@v1.2.3",
    "github:ailuracollective/colander",
    "github:ailuracode/colander@main",
    "github:ailuracode/colander@feature/engine",
    "github:ailuracode/colander@v1.2.3!",
    "github:ailuracode/colander@v1.2.3!../evil.wasm",
    "path:",
    "path:withcontrol",
  ],
  MALFORMED_DIGESTS = [
    "abc",
    "z".repeat(DIGEST_LENGTH),
    "a".repeat(DIGEST_LENGTH - OFF_BY_ONE),
    "a".repeat(DIGEST_LENGTH + OFF_BY_ONE),
  ],
  completeExports = (): Set<string> => new Set(REQUIRED_FUNCTIONS);

describe("engine source parsing", () => {
  it("refuses to guess an origin when the variable is unset or blank", () => {
    expect.hasAssertions();
    // There is no default: every scheme that names a published artifact is dead or
    // Unverifiable, so a build that does not say where the engine comes from stops here.
    for (const rawSource of UNSET_VALUES) {
      expect(() => parseEngineSource(rawSource), rawSource).toThrow(
        /missing origin\. Expected github:<owner>.*path:<file\.wasm\|directory>.*git:<repository>/su,
      );
    }
  });

  it("parses a local path origin of each shape", () => {
    expect.hasAssertions();
    expect(parseEngineSource("path:../colander-rs/target/colander.wasm")).toStrictEqual({
      kind: "path",
      looksLikeModule: true,
      target: "../colander-rs/target/colander.wasm",
    });
  });
});

describe("engine source parsing for remote origins", () => {
  it("parses a github origin with the default release asset", () => {
    expect.hasAssertions();
    expect(parseEngineSource("github:ailuracode/colander@v1.2.3")).toStrictEqual({
      asset: DEFAULT_GITHUB_ASSET,
      downloadUrl: "https://github.com/ailuracode/colander/releases/download/v1.2.3/colander.wasm",
      kind: "github",
      owner: "ailuracode",
      ref: "v1.2.3",
      repository: "colander",
    });
  });

  it("parses a github origin with an explicit asset name", () => {
    expect.hasAssertions();
    const plan = parseEngineSource("github:ailuracode/colander@1.2.3-rc.1!colander-rc.wasm");
    expect(plan).toStrictEqual({
      asset: "colander-rc.wasm",
      downloadUrl:
        "https://github.com/ailuracode/colander/releases/download/1.2.3-rc.1/colander-rc.wasm",
      kind: "github",
      owner: "ailuracode",
      ref: "1.2.3-rc.1",
      repository: "colander",
    });
  });
});

describe("engine source parsing for local origins", () => {
  it("parses local path origins and classifies a module target", () => {
    expect.hasAssertions();
    expect(parseEngineSource("path:../colander-rs/target/colander.wasm")).toStrictEqual({
      kind: "path",
      looksLikeModule: true,
      target: "../colander-rs/target/colander.wasm",
    });
    expect(parseEngineSource("path:../colander-rs")).toStrictEqual({
      kind: "path",
      looksLikeModule: false,
      target: "../colander-rs",
    });
  });

  it("rejects malformed, unknown, and ambiguous origins", () => {
    expect.hasAssertions();
    for (const rawSource of INVALID_SOURCES) {
      expect(() => parseEngineSource(rawSource), rawSource).toThrow(/COLANDER_WASM_SOURCE/u);
    }
  });

  it("names the accepted forms and an example in the error message", () => {
    expect.hasAssertions();
    expect(() => parseEngineSource("registry:colander")).toThrow(
      /github:<owner>\/<repo>@<release-tag>.*path:<file\.wasm\|directory>/su,
    );
  });
});

describe("engine source parsing for commit origins", () => {
  it("parses a local repository selected by commit", () => {
    expect.hasAssertions();
    const plan = parseEngineSource("git:../colander-rs@d54a86eb755c");
    expect(plan).toStrictEqual({
      isLocal: true,
      kind: "git",
      ref: "d54a86eb755c",
      repository: "../colander-rs",
      source: "repository ../colander-rs",
    });
  });

  it("parses a remote repository selected by a full url", () => {
    expect.hasAssertions();
    const plan = parseEngineSource("git:https://github.com/ailuracollective/colander@v1.0.0");
    expect(plan).toStrictEqual({
      isLocal: false,
      kind: "git",
      ref: "v1.0.0",
      repository: "https://github.com/ailuracollective/colander",
      source: "remote https://github.com/ailuracollective/colander",
    });
  });

  it("parses an absolute local repository and a branch ref", () => {
    expect.hasAssertions();
    expect(parseEngineSource("git:/home/lives/colander@master")).toStrictEqual({
      isLocal: true,
      kind: "git",
      ref: "master",
      repository: "/home/lives/colander",
      source: "repository /home/lives/colander",
    });
  });
});

describe("commit refs against release tags", () => {
  it("keeps a commit-looking ref distinct from a release tag", () => {
    expect.hasAssertions();
    const commit = parseEngineSource("git:../colander-rs@c213761d274380befea12ebfa03de49c786d89ba"),
      tag = parseEngineSource("git:../colander-rs@v1.0.0");
    expect(commit).toMatchObject({ kind: "git", ref: "c213761d274380befea12ebfa03de49c786d89ba" });
    expect(tag).toMatchObject({ kind: "git", ref: "v1.0.0" });
    expect(commit).not.toStrictEqual(tag);
  });

  it("names the git origin form in the accepted forms", () => {
    expect.hasAssertions();
    expect(() => parseEngineSource("registry:colander")).toThrow(
      /git:<repository>@<commit\|tag\|branch>/u,
    );
  });
});

describe("engine artifact digest", () => {
  it("treats a blank digest as absent", () => {
    expect.hasAssertions();
    for (const rawDigest of UNSET_VALUES) {
      expect(parseExpectedArtifactSha256(rawDigest), rawDigest).toBe("");
    }
  });

  it("normalizes an uppercase digest to lowercase", () => {
    expect.hasAssertions();
    expect(parseExpectedArtifactSha256("A".repeat(DIGEST_LENGTH))).toBe(EXPECTED_DIGEST);
  });

  it("rejects a malformed digest and names the variable", () => {
    expect.hasAssertions();
    for (const rawDigest of MALFORMED_DIGESTS) {
      expect(() => parseExpectedArtifactSha256(rawDigest), rawDigest).toThrow(
        /COLANDER_WASM_SHA256 must be 64 hexadecimal characters/u,
      );
    }
  });
});

describe("release digest gate", () => {
  const pathPlan = parseEngineSource("path:../colander-rs"),
    ungatedOrigins: readonly (readonly [string, ReturnType<typeof parseEngineSource>])[] = [
      ["path", pathPlan],
      ["github", parseEngineSource("github:ailuracollective/colander@v1.0.0")],
      ["git", parseEngineSource("git:../colander-rs@d54a86e")],
    ],
    assertReleaseGate = (
      plan: Readonly<ReturnType<typeof parseEngineSource>>,
      expectedSha256 = "",
    ): void => {
      assertReleaseDigestSatisfied({ expectedSha256, plan, requireDigest: true });
    };

  it("does not require a digest in an ordinary build", () => {
    expect.hasAssertions();
    expect(() => {
      assertReleaseDigestSatisfied({ expectedSha256: "", plan: pathPlan, requireDigest: false });
    }).not.toThrow();
  });

  it("accepts an explicit digest in the release build", () => {
    expect.hasAssertions();
    expect(() => {
      assertReleaseGate(pathPlan, EXPECTED_DIGEST);
    }).not.toThrow();
  });

  it("requires a digest for every origin in the release build", () => {
    expect.hasAssertions();
    for (const [kind, plan] of ungatedOrigins) {
      expect(() => {
        assertReleaseGate(plan);
      }, kind).toThrow(
        new RegExp(
          `COLANDER_WASM_SHA256 is required for the release build of a ${kind} origin`,
          "u",
        ),
      );
    }
  });
});

describe("module export contract", () => {
  it("accepts the pinned engine export surface", () => {
    expect.hasAssertions();
    expect(REQUIRED_FUNCTIONS).toHaveLength(PINNED_EXPORT_COUNT);
    expect(() => {
      assertRequiredExports(completeExports());
    }).not.toThrow();
  });

  it("rejects a module that misses a required export", () => {
    expect.hasAssertions();
    const exportNames = completeExports();
    exportNames.delete("colander_compile");
    expect(() => {
      assertRequiredExports(exportNames);
    }).toThrow(/built module does not export colander_compile\(\)/u);
  });

  it("rejects a module that still exports the removed function", () => {
    expect.hasAssertions();
    const exportNames = completeExports();
    exportNames.add(REMOVED_FUNCTION);
    expect(() => {
      assertRequiredExports(exportNames);
    }).toThrow(/unexpectedly exports the removed colander_last_panic\(\)/u);
  });
});
