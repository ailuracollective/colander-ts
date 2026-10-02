import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = (name: string): string => join(import.meta.dirname, "..", "src", name);

/**
 * What a browser is allowed to reach.
 *
 * This package is mostly a build-time tool, and a build-time tool needs Node. It
 * also ships the few things a form needs at runtime, and those must be reachable
 * without dragging `node:child_process` and a directory walk into a browser
 * bundle: Vite externalises a Node built-in for the browser and the import then
 * fails at runtime, which is a far worse place to find out.
 */
async function graphOf(entry: string): Promise<{ modules: string[]; builtins: string[] }> {
  const seen = new Set<string>(),
    builtins = new Set<string>(),
    queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/from "([^"]+)"/g)) {
      const specifier = match[1];
      if (specifier === undefined) {
        continue;
      }
      if (specifier.startsWith("node:")) {
        builtins.add(specifier);
        continue;
      }
      if (specifier.startsWith(".")) {
        queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      }
    }
  }
  return { builtins: [...builtins], modules: [...seen] };
}

describe("the runtime entry point", () => {
  it("reaches no Node built-in, so a form can import it in a browser", async () => {
    const { builtins } = await graphOf(source("runtime.ts"));
    expect(builtins).toEqual([]);
  });

  it("is where a form gets the dispatcher, not the package root", async () => {
    const runtime = await readFile(source("runtime.ts"), "utf8");
    expect(runtime).toContain("export function renderColanderField");
    const root = await readFile(source("index.ts"), "utf8");
    // The root still exports it, for a build-time caller that already has the
    // Package, but the runtime entry is what a browser is meant to import.
    expect(root).toContain("./runtime.js");
  });

  it("keeps the build-time half on the root, where only Node ever loads it", async () => {
    const { builtins } = await graphOf(source("plugin.ts"));
    expect(builtins).toContain("node:child_process");
  });
});

describe("the utilities entry point", () => {
  it("reaches no Node built-in, so a control can import it in a browser", async () => {
    // The utilities are the half of this package a control actually calls at
    // Render time, so the same browser rule the runtime entry has to meet
    // Applies here. It reads the core's table and nothing else.
    const { builtins } = await graphOf(source("utilities.ts"));
    expect(builtins).toEqual([]);
  });

  it("is re-exported by the root, for a build-time caller that already has the package", async () => {
    const root = await readFile(source("index.ts"), "utf8");
    // The same shape as ./runtime.js: the subpath is what a consumer is meant
    // To import, and the root carries it for whoever has not switched yet.
    expect(root).toContain("./utilities.js");
  });

  it("is re-exported whole by the root, not partly", async () => {
    // The root carried `DERIVATION_RULE` and the constraint types while the
    // Registry and every function stayed on the subpath, and no test said so: a
    // Caller with the root in hand could read the rule and find nothing to apply
    // It to. Every subpath in this package is mirrored on the root, so this one
    // Is compared against the barrel rather than described.
    const barrel = await import("../src/utilities.js"),
      root = await import("../src/index.js"),
      missing = Object.keys(barrel)
        .filter((name) => name !== "default")
        .filter((name) => !(name in root));
    expect(missing).toEqual([]);
  });

  it("names every type the utilities publish in the root, not only their values", async () => {
    // The runtime check above cannot see a type, so the type half of the
    // Re-export is held here by name.
    const root = await readFile(source("index.ts"), "utf8");
    for (const name of [
      "NumberUtilities",
      "IntegerUtilities",
      "TextUtilities",
      "TextareaUtilities",
      "BooleanUtilities",
      "ChoiceUtilities",
      "DateUtilities",
      "TimeUtilities",
      "DateTimeUtilities",
      "TypeUtilities",
      "UtilitiesOf",
      "ClockTime",
      "DateTimeParts",
    ]) {
      expect(root, `the root re-exports ${name}`).toContain(name);
    }
  });
});
