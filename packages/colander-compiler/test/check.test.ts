import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkGeneratedTree, describeCheck } from "../src/check.js";
import { colander } from "../src/plugin.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "colander-check-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

/**
 * A `tsc` stand-in, so the suite never depends on a real TypeScript run.
 *
 * It is a real executable rather than a command line on purpose: the check spawns
 * without a shell, so a path with a metacharacter in it cannot become a command.
 */
async function writeFakeTsc(source: string): Promise<string> {
  const path = join(dir, "fake-tsc");
  await writeFile(path, `#!/bin/sh\n${source}`, "utf8");
  await chmod(path, 0o755);
  // The check compiles the tree under a project; a project that includes nothing
  // Is refused rather than trusted, so the tests provide one that includes it,
  // Unless the test wrote its own to exercise the refusal.
  if (!existsSync(join(dir, "tsconfig.json"))) {
    await writeFile(join(dir, "tsconfig.json"), '{ "include": ["generated"] }\n', "utf8");
  }
  return path;
}

describe("checking the generated tree", () => {
  it("reports success when the checker says nothing", async () => {
    const tsc = await writeFakeTsc("exit 0\n"),
      outcome = await checkGeneratedTree({ files: ["a.ts"], outDir: dir, tsc });
    expect(outcome.ok).toBe(true);
    expect(describeCheck(outcome)).toBeNull();
  });

  it("carries the checker's own output when it fails", async () => {
    const tsc = await writeFakeTsc(
        "console.log(\"text.tsx(9,3): error TS2339: Property 'minLenght' does not exist.\");\nprocess.exit(2)\n",
      ),
      outcome = await checkGeneratedTree({ files: ["a.ts"], outDir: dir, tsc });
    expect(outcome.ok).toBe(false);
    expect(describeCheck(outcome)).toContain("minLenght");
  });

  it("says what to do about a failure, not only that there was one", async () => {
    const tsc = await writeFakeTsc("exit 1\n"),
      described = describeCheck(await checkGeneratedTree({ files: ["a.ts"], outDir: dir, tsc }));
    expect(described).toContain("does not type-check");
    expect(described).toContain("the core");
  });

  it("reports a checker that cannot be run, instead of failing silently", async () => {
    await writeFile(join(dir, "tsconfig.json"), '{ "include": ["generated"] }\n', "utf8");
    const outcome = await checkGeneratedTree({
      files: ["a.ts"],
      outDir: dir,
      tsc: "definitely-not-a-real-tsc-binary",
    });
    expect(outcome.ok).toBe(false);
    expect(describeCheck(outcome)).toContain("Could not run");
  });

  it("stops a check that never finishes, and says the tree is unverified", async () => {
    const tsc = await writeFakeTsc("sleep 30\n"),
      outcome = await checkGeneratedTree({
        files: ["a.ts"],
        outDir: dir,
        timeoutMs: 120,
        tsc,
      });
    expect(outcome.ok).toBe(false);
    expect(describeCheck(outcome)).toContain("has not been verified");
  });

  it("asks for the project when no files are named", async () => {
    const tsc = await writeFakeTsc('echo "$@"\nexit 0\n'),
      outcome = await checkGeneratedTree({ outDir: dir, tsc });
    expect(outcome.ok).toBe(true);
  });
});

describe("the plugin in development", () => {
  /** Capture what the plugin warns about, from before it is built. */
  function captureLog() {
    const lines: string[] = [],
      original = console.warn;
    console.warn = (line: string) => lines.push(String(line));
    return { lines, restore: () => (console.warn = original) };
  }

  const jsxMapping = () => ({
      shell: { export: "S", module: "@/s" },
      // JSX belongs in a mapping module, which is what `resolveMapping` reads.
      components: { text: { jsx: "<input />" } },
    }),
    devServer = {
      moduleGraph: { getModuleById: () => {} },
      watcher: { add: () => {} },
    };

  it("checks the tree it just wrote, so a property the core does not declare is reported", async () => {
    const tsc = await writeFakeTsc('echo "text.tsx(9,3): error TS2339: minLenght"\nexit 2\n'),
      log = captureLog();
    try {
      const plugin = colander({
        checkTsc: tsc,
        resolveMapping: jsxMapping,
        root: dir,
      });
      // A development server is what turns the check on; a build already type-checks.
      plugin.configureServer?.(devServer);
      await plugin.configResolved?.({ root: dir });
    } finally {
      log.restore();
    }
    // The finding reaches the log the developer is already reading, naming the
    // Property and saying what to do about it.
    const reported = log.lines.find((line) => line.includes("does not type-check"));
    expect(reported).toBeDefined();
    expect(reported).toContain("minLenght");
  });

  it("does not check during a build, which already type-checks", async () => {
    const tsc = await writeFakeTsc('echo "text.tsx(9,3): error TS2339: minLenght"\nexit 2\n'),
      log = captureLog();
    try {
      const plugin = colander({
        checkTsc: tsc,
        resolveMapping: jsxMapping,
        root: dir,
      });
      await plugin.configResolved?.({ root: dir });
    } finally {
      log.restore();
    }
    expect(log.lines.find((line) => line.includes("does not type-check"))).toBeUndefined();
  });

  it("stays quiet when the tree type-checks", async () => {
    const tsc = await writeFakeTsc("exit 0\n"),
      log = captureLog();
    try {
      const plugin = colander({
        checkTsc: tsc,
        resolveMapping: jsxMapping,
        root: dir,
      });
      plugin.configureServer?.(devServer);
      await plugin.configResolved?.({ root: dir });
    } finally {
      log.restore();
    }
    expect(log.lines.find((line) => line.includes("does not type-check"))).toBeUndefined();
  });
});

describe("finding the project's TypeScript", () => {
  it("uses the one the project installed, which is not on PATH for a bundler", async () => {
    const { projectTypeScript } = await import("../src/check.js"),
      typescript = join(process.cwd(), "node_modules/typescript/bin/tsc");
    expect(projectTypeScript()).toBe(existsSync(typescript) ? typescript : "tsc");
  });

  it("falls back to PATH when the project has none", async () => {
    const { projectTypeScript } = await import("../src/check.js");
    expect(projectTypeScript(join(dir, "empty"))).toBe("tsc");
  });
});

describe("a project that includes nothing", () => {
  it("is reported instead of trusted, because checking it would report success", async () => {
    const { findCheckProject } = await import("../src/check.js");
    await writeFile(
      join(dir, "tsconfig.json"),
      '{ "references": [{ "path": "./tsconfig.app.json" }] }\n',
      "utf8",
    );
    const found = findCheckProject(join(dir, "generated"));
    expect("reason" in found).toBe(true);
    if ("reason" in found) {
      expect(found.reason).toContain("would check nothing and report success");
    }
  });

  it("is refused through the check, with the fix in the message", async () => {
    await writeFile(join(dir, "tsconfig.json"), '{ "references": [] }\n', "utf8");
    const tsc = await writeFakeTsc("exit 0\n"),
      outcome = await checkGeneratedTree({ outDir: dir, tsc });
    expect(outcome.ok).toBe(false);
    expect(describeCheck(outcome)).toContain("checkProject");
  });

  it("uses a project that includes sources", async () => {
    const { findCheckProject } = await import("../src/check.js");
    await writeFile(join(dir, "tsconfig.json"), '{ "include": ["src"] }\n', "utf8");
    const found = findCheckProject(join(dir, "generated"));
    expect(found).toEqual({ project: join(dir, "tsconfig.json") });
  });

  it("uses the project the consumer named, however it is spelled", async () => {
    const { findCheckProject } = await import("../src/check.js");
    expect(findCheckProject(dir, "tsconfig.app.json")).toEqual({
      project: join(process.cwd(), "tsconfig.app.json"),
    });
  });

  it("says so when there is no project at all", async () => {
    const { findCheckProject } = await import("../src/check.js"),
      found = findCheckProject(join(dir, "generated"));
    expect("reason" in found).toBe(true);
  });
});

describe("a project file that lists no sources", () => {
  it("is refused, whatever shape the emptiness takes", async () => {
    const { findCheckProject } = await import("../src/check.js");
    for (const body of [
      '{ "files": [], "references": [] }',
      '{ "references": [] }',
      '{ "include": [] }',
      "{ /* a comment */ }",
      "not json at all",
    ]) {
      await writeFile(join(dir, "tsconfig.json"), body, "utf8");
      const found = findCheckProject(join(dir, "generated"));
      expect("reason" in found, body).toBe(true);
    }
  });

  it("is accepted when it lists a source, with or without comments", async () => {
    const { findCheckProject } = await import("../src/check.js");
    await writeFile(
      join(dir, "tsconfig.json"),
      '{\n  // the sources\n  /* and a block */\n  "include": ["src"],\n}\n',
      "utf8",
    );
    expect(findCheckProject(join(dir, "generated"))).toEqual({
      project: join(dir, "tsconfig.json"),
    });
  });

  it("accepts a project that names its files explicitly", async () => {
    const { findCheckProject } = await import("../src/check.js");
    await writeFile(join(dir, "tsconfig.json"), '{ "files": ["src/index.ts"] }', "utf8");
    expect(findCheckProject(join(dir, "generated"))).toEqual({
      project: join(dir, "tsconfig.json"),
    });
  });
});
