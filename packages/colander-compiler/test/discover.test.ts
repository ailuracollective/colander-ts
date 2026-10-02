import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverComponents, mappingFromDiscovery, relativeSpecifier } from "../src/discover.js";
import { ColanderCompilerError } from "../src/errors.js";

let dir = "",
  root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "colander-discover-"));
  dir = join(root, "src", "components", "colander");
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

async function write(name: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, "export default function C() { return null }\n", "utf8");
  return path;
}

const importer = (): string => join(root, "src", "generated", "colander", "controls.ts"),
  TYPES = [
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

describe("finding controls by convention", () => {
  it("maps a file named after a type to that type", async () => {
    await write("text.tsx");
    await write("number.tsx");
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(found.controls.map((control) => control.type)).toEqual(["text", "number"]);
  });

  it("imports each control by its default export, by a relative path", async () => {
    await write("text.tsx");
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(found.controls[0]?.source).toEqual({
      export: "default",
      module: "../../components/colander/text",
    });
  });

  it("covers every type the core materializes, in the core's own order", async () => {
    for (const type of TYPES) {
      await write(`${type}.tsx`);
    }
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(found.controls.map((control) => control.type)).toEqual([...TYPES]);
    expect(found.missing).toEqual([]);
  });

  it("accepts a `.ts` file as readily as a `.tsx` one", async () => {
    await write("text.ts");
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(found.controls.map((control) => control.type)).toEqual(["text"]);
  });

  it("reports a type no file declares", async () => {
    await write("text.tsx");
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(found.missing).toEqual(TYPES.filter((type) => type !== "text"));
  });

  it("does not report a type the consumer omitted", async () => {
    await write("text.tsx");
    const found = await discoverComponents({
      componentsDir: dir,
      importer: importer(),
      omit: ["choice", "time"],
    });
    expect(found.missing).not.toContain("choice");
    expect(found.missing).not.toContain("time");
  });

  it("refuses to omit a type the core does not materialize", async () => {
    await expect(
      discoverComponents({ componentsDir: dir, importer: importer(), omit: ["banana"] }),
    ).rejects.toThrow(ColanderCompilerError);
  });

  it("leaves a file that names no type alone, and reports it", async () => {
    await write("text.tsx");
    await write("utils.ts");
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(found.controls.map((control) => control.type)).toEqual(["text"]);
    // A misspelled control is visible without every helper file being an error.
    expect(found.ignored).toEqual(["utils.ts"]);
  });

  it("refuses two files declaring the same type", async () => {
    await write("text.tsx");
    await write("text-control.tsx");
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(found.controls).toHaveLength(1);
    expect(found.ignored).toContain("text-control.tsx");
  });

  it("refuses a directory it cannot read, saying what to point it at", async () => {
    await expect(
      discoverComponents({ componentsDir: join(root, "nope"), importer: importer() }),
    ).rejects.toThrow(/could not be read/);
  });
});

describe("the shell", () => {
  it("is the file the consumer named, found whether or not it carries an extension", async () => {
    const withoutExtension = join(dir, "shell");
    await write("shell.tsx");
    const found = await discoverComponents({
      componentsDir: dir,
      importer: importer(),
      shell: withoutExtension,
    });
    expect(found.shell?.source).toEqual({
      export: "default",
      module: "../../components/colander/shell",
    });
  });

  it("is absent when none was named", async () => {
    await write("text.tsx");
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(found.shell).toBeNull();
  });

  it("is refused when the file behind it does not exist", async () => {
    await write("text.tsx");
    await expect(
      discoverComponents({
        componentsDir: dir,
        importer: importer(),
        shell: join(dir, "nowhere"),
      }),
    ).rejects.toThrow(/names no file/);
  });

  it("is required before a mapping can be built from a discovery", async () => {
    await write("text.tsx");
    const found = await discoverComponents({ componentsDir: dir, importer: importer() });
    expect(() => mappingFromDiscovery(found)).toThrow(/no shell was named/);
  });
});

describe("the mapping a discovery implies", () => {
  it("is keyed by the core's own types, with the shell beside them", async () => {
    for (const type of ["text", "number", "choice"]) {
      await write(`${type}.tsx`);
    }
    const shellFile = await write("shell.tsx"),
      found = await discoverComponents({
        componentsDir: dir,
        importer: importer(),
        shell: shellFile,
      }),
      mapping = mappingFromDiscovery(found);
    expect(Object.keys(mapping.components)).toEqual(["text", "number", "choice"]);
    expect(mapping.shell).toEqual({
      export: "default",
      module: "../../components/colander/shell",
    });
  });
});

describe("the specifier a generated module uses", () => {
  it("is relative, so nothing has to resolve an alias", () => {
    expect(relativeSpecifier("/a/src/generated/colander/controls.ts", "/a/src/c/text.tsx")).toBe(
      "../../c/text",
    );
  });

  it("stays inside the project when the file is beside the generated tree", () => {
    expect(relativeSpecifier("/a/gen/controls.ts", "/a/gen/shell.tsx")).toBe("./shell");
  });
});
