import { assertCompleteMapping, assertGeneratedTreeIsCurrent } from "@ailura/colander-compiler";
import { discoverComponents, mappingFromDiscovery } from "@ailura/colander-compiler/discover";
import { describe, expect, it } from "vitest";

import { colanderOptions } from "./colander-options";

/**
 * The generated mapping is a build artifact, so a fresh checkout has none until
 * `pnpm generate` has run. That only stays honest while the bytes a run would
 * write are the bytes on disk, and both halves of that are checks the library
 * ships rather than a byte comparison written here.
 */
const generatedDir = ".colander";
const importer = `${generatedDir}/controls.ts`;

/** The same options the plugin call uses, so this test cannot drift from it. */
async function currentMapping() {
  const discovery = await discoverComponents({
    componentsDir: colanderOptions.componentsDir,
    shell: colanderOptions.shell,
    importer,
  });
  return mappingFromDiscovery(discovery);
}

describe("the generated component tree", () => {
  it("is exactly what the directory of controls and the core produce today", async () => {
    await expect(
      assertGeneratedTreeIsCurrent({ outDir: generatedDir, ...(await currentMapping()) }),
    ).resolves.toBeUndefined();
  });

  it("covers every type the core can materialize", async () => {
    const mapping = await currentMapping();
    expect(() => assertCompleteMapping(mapping)).not.toThrow();
  });

  it("has a control file for every type, so no type is silently unrendered", async () => {
    const discovery = await discoverComponents({
      componentsDir: colanderOptions.componentsDir,
      shell: colanderOptions.shell,
      importer,
    });
    expect(discovery.missing).toEqual([]);
  });
});
