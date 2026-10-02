import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAPPING_JSON } from "../src/generate.js";
import type { ComponentMapping, ImportedComponent } from "../src/plan.js";
import { colander } from "../src/plugin.js";
import type { ViteDevServer, VitePluginLike } from "../src/plugin.js";

/**
 * The plugin exercised through the paths a bundler uses: it resolves a root, a
 * development server asks it to watch, and an edit to one of its inputs asks it
 * to regenerate.
 */
const SHELL: ImportedComponent = { export: "default", module: "@/components/colander/shell" };

function control(name: string): ImportedComponent {
  return { export: "default", module: `@/components/colander/${name}` };
}

const fullMapping = (): ComponentMapping => ({
  components: {
    boolean: control("boolean"),
    choice: control("choice"),
    date: control("date"),
    datetime: control("datetime"),
    integer: control("integer"),
    number: control("number"),
    text: control("text"),
    textarea: control("textarea"),
    time: control("time"),
  },
  shell: SHELL,
});

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "colander-vite-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

function fakeServer(): { server: ViteDevServer; watched: string[] } {
  const watched: string[] = [];
  return {
    server: {
      moduleGraph: { getModuleById: (id) => ({ id }) },
      watcher: { add: (paths) => watched.push(...(Array.isArray(paths) ? paths : [paths])) },
    },
    watched,
  };
}

function build(options: { withLoader?: boolean } = {}): VitePluginLike {
  return colander({
    components: fullMapping().components,
    root,
    shell: SHELL,
    ...(options.withLoader === true ? { resolveMapping: () => fullMapping() } : {}),
  });
}

describe("a mapping spelled out in the plugin call", () => {
  it("writes the mapping, and nothing else", async () => {
    await build().configResolved?.({ root });
    const written = await readdir(join(root, ".colander"));
    expect(written.sort()).toEqual([MAPPING_JSON]);
  });

  it("names the shell and every type in the mapping it wrote", async () => {
    await build().configResolved?.({ root });
    const map = JSON.parse(await readFile(join(root, ".colander", MAPPING_JSON), "utf8")) as {
      shell: { module: string };
      types: Record<string, { export: string }>;
    };
    expect(map.shell.module).toBe("@/components/colander/shell");
    expect(Object.keys(map.types)).toHaveLength(9);
  });

  it("watches the core's semantic table without being told where it is", () => {
    const plugin = build(),
      { server, watched } = fakeServer();
    plugin.configureServer?.(server);
    expect(watched.some((path) => path.includes("colander-client"))).toBe(true);
  });

  it("refuses a call that still declares `outDir`, naming the fixed directory", async () => {
    const plugin = colander({
      components: fullMapping().components,
      outDir: join("src", "generated", "colander"),
      root,
      shell: SHELL,
    } as never);
    await expect(plugin.configResolved?.({ root })).rejects.toThrow(/\.colander/);
  });
});

describe("a mapping read through a loader", () => {
  it("is asked for the mapping on every run, so an edit is seen", async () => {
    let calls = 0;
    const mapping = join(root, "mapping.json");
    await writeFile(mapping, "{}", "utf8");
    const plugin = colander({
      dependencies: [mapping],
      resolveMapping: () => {
        calls += 1;
        return fullMapping();
      },
      root,
    });
    await plugin.configResolved?.({ root });
    // The edit comes through a hot update, which is the only way a running server
    // Learns about one, so that is where the loader is asked again.
    const { server } = fakeServer();
    await plugin.handleHotUpdate?.({ file: mapping, server });
    expect(calls).toBe(2);
  });
});

describe("a framework that builds more than one bundle", () => {
  it("is given the tree once, because the second run would only repeat it", async () => {
    let calls = 0;
    const plugin = colander({
      resolveMapping: () => {
        calls += 1;
        return fullMapping();
      },
      root,
    });
    // One configuration per environment, then one build per bundle: the same tree,
    // Asked for again by every one of them.
    await plugin.configResolved?.({ root });
    await plugin.configResolved?.({ build: { watch: null }, root });
    await plugin.buildStart?.();
    await plugin.buildStart?.();
    expect(calls).toBe(1);
  });

  it("is given the tree again on every rebuild of a build in watch mode", async () => {
    let calls = 0;
    const plugin = colander({
      resolveMapping: () => {
        calls += 1;
        return fullMapping();
      },
      root,
    });
    // A watched build can have its inputs changed between two rebuilds, so the
    // Second rebuild cannot be answered with what the first one produced.
    await plugin.configResolved?.({ build: { watch: {} }, root });
    await plugin.buildStart?.();
    expect(calls).toBe(2);
  });

  it("still refuses a run that failed, rather than remembering a tree that is not there", async () => {
    const plugin = colander({
      components: fullMapping().components,
      outDir: join("src", "generated", "colander"),
      root,
      shell: SHELL,
    } as never);
    await expect(plugin.configResolved?.({ root })).rejects.toThrow(/\.colander/);
    await expect(plugin.configResolved?.({ root })).rejects.toThrow(/\.colander/);
  });
});

describe("a run that succeeded", () => {
  it("says nothing at all, because nothing is wrong with the project", async () => {
    const lines: string[] = [],
      { warn } = console,
      { info } = console;
    console.warn = (line: string) => lines.push(String(line));
    console.info = (line: string) => lines.push(String(line));
    try {
      await build().configResolved?.({ root });
    } finally {
      console.warn = warn;
      console.info = info;
    }
    expect(lines).toEqual([]);
  });
});
