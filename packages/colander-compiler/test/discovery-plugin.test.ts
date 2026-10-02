import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ColanderCompilerError } from "../src/errors.js";
import { colander } from "../src/plugin.js";
import type { ViteLoggerLike, VitePluginLike } from "../src/plugin.js";

/**
 * The plugin as a consumer uses it: no configuration file, a directory of one file
 * per type, and a shell.
 */
const TYPES = [
  "text",
  "textarea",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "time",
  "choice",
] as const;

let dir = "",
  root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "colander-plugin-"));
  dir = join(root, "src", "components", "colander");
  await mkdir(dir, { recursive: true });
  for (const type of TYPES) {
    await writeFile(
      join(dir, `${type}.tsx`),
      "export default function Control() { return null }\n",
      "utf8",
    );
  }
  await writeFile(
    join(dir, "shell.tsx"),
    "export default function Shell() { return null }\n",
    "utf8",
  );
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

function pluginFor(overrides: Record<string, unknown> = {}): VitePluginLike {
  return colander({
    componentsDir: "src/components/colander",
    root,
    shell: "src/components/colander/shell",
    ...overrides,
  });
}

const generated = async (name: string): Promise<string> =>
  readFile(join(root, ".colander", name), "utf8");

/** A logger that records what the plugin asked it to say. */
function fakeLogger(): {
  logger: ViteLoggerLike;
  warned: string[];
  warnedOnce: string[];
} {
  const warned: string[] = [],
    warnedOnce: string[] = [];
  return {
    logger: {
      warn: (message: string) => warned.push(String(message)),
      warnOnce: (message: string) => warnedOnce.push(String(message)),
    },
    warned,
    warnedOnce,
  };
}

describe("a type with no control file", () => {
  it("fails the build, naming the type, because the field would render nothing", async () => {
    await rm(join(dir, "choice.tsx"));
    await expect(pluginFor().configResolved?.({ root })).rejects.toThrow(ColanderCompilerError);
    await expect(pluginFor().configResolved?.({ root })).rejects.toThrow(/`choice`/);
  });

  it("says what to do about it", async () => {
    await rm(join(dir, "choice.tsx"));
    await expect(pluginFor().configResolved?.({ root })).rejects.toThrow(
      /Add the file, or list the type in `omit`/,
    );
  });

  it("is allowed when the consumer says so", async () => {
    await rm(join(dir, "choice.tsx"));
    await rm(join(dir, "time.tsx"));
    await pluginFor({ omit: ["choice", "time"] }).configResolved?.({ root });
    const map = JSON.parse(await generated("colander.map.json")) as {
      types: Record<string, unknown>;
    };
    expect(Object.keys(map.types)).not.toContain("choice");
  });
});

describe("a file the convention leaves alone", () => {
  it("is left alone, and a misspelled control is caught by the type it leaves behind", async () => {
    await rm(join(dir, "text.tsx"));
    await writeFile(
      join(dir, "textt.tsx"),
      "export default function T() { return null }\n",
      "utf8",
    );
    await expect(pluginFor().configResolved?.({ root })).rejects.toThrow(ColanderCompilerError);
    await expect(pluginFor().configResolved?.({ root })).rejects.toThrow(/`text`/);
  });

  it("says nothing about a helper beside the controls, nor about a misspelled control", async () => {
    await writeFile(join(dir, "format.ts"), "export const f = 1\n", "utf8");
    await writeFile(
      join(dir, "textt.tsx"),
      "export default function T() { return null }\n",
      "utf8",
    );
    const logger = fakeLogger();
    await pluginFor().configResolved?.({ logger: logger.logger, root });
    expect(logger.warned).toEqual([]);
    expect(logger.warnedOnce).toEqual([]);
  });

  it("is not an error, so a helper beside the controls is fine", async () => {
    await writeFile(join(dir, "format.ts"), "export const f = 1\n", "utf8");
    await expect(pluginFor().configResolved?.({ root })).resolves.toBeUndefined();
  });
});

describe("a directory the convention cannot use", () => {
  it("says so when it does not exist", async () => {
    await expect(
      pluginFor({ componentsDir: "src/components/nowhere" }).configResolved?.({ root }),
    ).rejects.toThrow(/could not be read/);
  });

  it("says so when the shell names no file", async () => {
    await expect(
      pluginFor({ shell: "src/components/colander/nowhere" }).configResolved?.({ root }),
    ).rejects.toThrow(/names no file/);
  });

  it("says so when no mapping was given at all", async () => {
    await expect(colander({ root } as never).configResolved?.({ root })).rejects.toThrow(
      /Pass `componentsDir` and `shell`/,
    );
  });

  it("refuses a control written as JSX in the configuration", async () => {
    await expect(
      pluginFor({
        components: { text: { jsx: "<input />" } },
        componentsDir: undefined,
        shell: { export: "S", module: "@/s" },
      }).configResolved?.({ root }),
    ).rejects.toThrow(/not a place for UI code/);
  });
});
