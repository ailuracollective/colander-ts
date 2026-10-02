/**
 * The Vite plugin.
 *
 * Development and build get the same bytes: the tree is written to disk in both,
 * and a change to anything the generation reads regenerates it and hands Vite the
 * affected modules so the running app updates without a restart.
 *
 * The plugin is typed against a structural subset of Vite's plugin shape rather
 * than against Vite itself, so this package needs no bundler dependency and a
 * consumer's Vite version is theirs to choose.
 */

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkGeneratedTree, describeCheck } from "./check.js";
import { discoverComponents, mappingFromDiscovery } from "./discover.js";
import type { DiscoveredComponents } from "./discover.js";
import { configError, mappingError } from "./errors.js";
import { generateComponents, generatedModules } from "./generate.js";
import type { GenerateOptions } from "./generate.js";
import { isJsxComponent } from "./plan.js";
import type { ComponentMapping } from "./plan.js";

/**
 * The one directory the generated tree lives in, under the bundler's root.
 *
 * The tree is a build artifact, not source: it is reproduced from the mapping
 * and the core's table on every run, so it is written to one fixed place that a
 * consumer can gitignore and a build can clear, rather than to a directory each
 * call gets to name.
 */
export const GENERATED_DIR_NAME = ".colander";

/** The parts of a Vite module node this plugin touches. */
export interface ViteModuleNode {
  readonly id: string;
}

/** The parts of a Vite dev server this plugin touches. */
export interface ViteDevServer {
  readonly watcher: {
    add(paths: string | readonly string[]): void;
  };
  readonly moduleGraph: {
    getModuleById(id: string): ViteModuleNode | undefined;
    invalidateAll?(): void;
  };
}

/** The parts of Vite's logger this plugin uses. */
export interface ViteLoggerLike {
  warn(message: string): void;
  warnOnce(message: string): void;
}

/** The parts of a Vite plugin this plugin implements. */
export interface VitePluginLike {
  readonly name: string;
  buildStart?(): Promise<void> | void;
  configResolved?(config: {
    readonly root: string;
    /** Vite's build options, where a build in watch mode says so. */
    readonly build?: { readonly watch?: unknown };
    /**
     * The bundler's logger. Optional, because a host may resolve a
     * configuration without one, and the diagnostics fall back to the console.
     */
    readonly logger?: ViteLoggerLike;
  }): Promise<void> | void;
  configureServer?(server: ViteDevServer): void;
  handleHotUpdate?(context: {
    readonly file: string;
    readonly server: ViteDevServer;
  }): Promise<readonly ViteModuleNode[] | undefined> | readonly ViteModuleNode[] | undefined;
}

/**
 * The parts of the configuration that are not the mapping.
 *
 * The generation's own options are the same ones `generateComponents` takes, with
 * two the plugin is better placed to explain. The tree has one fixed home,
 * `<root>/.colander/`, so there is no directory to declare: a call that passes
 * `outDir` anyway is refused rather than quietly ignored, because a consumer
 * reading that tree from somewhere else would look at a stale one.
 */
type PluginOutput = Omit<
  GenerateOptions,
  "shell" | "components" | "outDir" | "checkTsc" | "checkProject"
> & {
  /**
   * The TypeScript binary the development check runs. Defaults to `tsc` on
   * PATH, which is not there for a process a bundler started, so a project that
   * keeps TypeScript in `node_modules` should point at it.
   */
  readonly checkTsc?: string;
  /**
   * The TypeScript project the check compiles the tree under. Defaults to the
   * nearest `tsconfig.json` above it, and a project file that includes nothing
   * is reported rather than trusted, because checking against it would check
   * nothing and report success.
   */
  readonly checkProject?: string;
};

/** A mapping spelled out where the plugin is configured. */
type InlineMapping = ComponentMapping & {
  resolveMapping?: undefined;
  componentsDir?: undefined;
};

/** A mapping read from a module the configuration cannot evaluate itself. */
type LoadedMapping = {
  resolveMapping: () => ComponentMapping | Promise<ComponentMapping>;
} & Partial<ComponentMapping> & { componentsDir?: undefined };

/**
 * What a consumer configures the plugin with.
 *
 * The mapping arrives one of three ways, and the first is the one to reach for:
 * `componentsDir` and `shell` name a directory holding one file per type, each
 * exporting its control by default. A file named after a type the core does not
 * declare is a mistake, and a type with no file is one too, so a convention is
 * checked where a hand-written list is not.
 *
 * The other two are for what a directory cannot express: a mapping spelled out
 * here, which cannot carry JSX because a bundler configuration is the wrong place
 * for UI code, and a loader, which is what a mapping in its own module needs to be
 * worth watching.
 *
 * There is no logging switch, because there is nothing to narrate. A run that
 * worked says so by being quiet, and a bundler's log is not where a consumer
 * looks for what is wrong with their own project. The warnings that do get
 * through are about their files and their types, and they go through the
 * bundler's own logger, so `logLevel: 'silent'` silences them and Vite's
 * formatting is what they read like. A host that resolves a configuration
 * without a logger gets them on `console.warn` instead.
 */
export type ColanderPluginOptions = PluginOutput &
  (InlineMapping | LoadedMapping | DiscoveredMapping) & {
    /** The repository root the paths are resolved against. Defaults to `process.cwd()`. */
    readonly root?: string;
  };

/**
 * A mapping read from a directory of files named after the types.
 *
 * The convention is the default because a hand-written mapping can be wrong in
 * ways nothing notices: a type misspelled produces no control, and the field is
 * then simply never rendered.
 */
interface DiscoveredMapping {
  resolveMapping?: undefined;
  components?: undefined;
  /** The directory holding one file per type, each exporting a control by default. */
  componentsDir: string;
  /** The shell's file. It has no type name of its own, so it is named. */
  shell: string;
  /** Types the consumer deliberately does not materialise. */
  omit?: readonly string[];
}

/**
 * Refuse a control written as JSX in the bundler configuration.
 *
 * The configuration is bundled and executed by Node, which is the last place UI
 * code belongs: it cannot resolve a bundler-only alias, it drags a component tree
 * into the config, and the JSX there is outside every type checker that matters. A
 * control belongs in a file, and the directory is where the compiler looks.
 *
 * @param mapping the mapping declared inline in the plugin call
 * @returns nothing; it throws naming the type that carries JSX
 */
function requireNoBundlerConfigJsx(mapping: ComponentMapping): void {
  if (isJsxComponent(mapping.shell)) {
    throw mappingError(
      "the field shell",
      "the shell is written as JSX in the bundler configuration, which is not a place for UI code; put it in a file and point `shell` at it",
    );
  }
  for (const [type, source] of Object.entries(mapping.components)) {
    if (source !== undefined && isJsxComponent(source)) {
      throw mappingError(
        `the \`${type}\` control`,
        "it is written as JSX in the bundler configuration, which is not a place for UI code; put it in a file named after the type, in the directory `componentsDir` names",
      );
    }
  }
}

/**
 * Build the plugin.
 *
 * The mapping is the one thing a call cannot leave out. The tree has one fixed
 * home — a gitignored build artifact under `<root>/.colander/` — so there is no
 * directory to declare, and a call that declares one stops with that said.
 *
 * @param options where the controls are, where the tree goes, and how to generate it
 * @returns a Vite plugin
 */
export function colander(
  options: ColanderPluginOptions = {} as ColanderPluginOptions,
): VitePluginLike {
  let root = resolve(options.root ?? process.cwd());
  /**
   * Where the tree goes: the one fixed directory, under the bundler's root.
   *
   * `outDir` is not in the option type any more, so a call that still declares
   * it is read off the options defensively — a JavaScript consumer, or a test
   * using `as never`, would otherwise pass it and expect it to be honoured.
   */
  const resolveGeneratedDir = (): string => {
    const declared = (options as { readonly outDir?: unknown }).outDir;
    if (declared !== undefined) {
      throw configError(
        root,
        `\`outDir\` is no longer a plugin option. The generated tree has one fixed home, \`${GENERATED_DIR_NAME}/\`, under the root the bundler resolved, and is a gitignored build artifact: remove \`outDir\` and gitignore that directory`,
      );
    }
    outDir = join(root, GENERATED_DIR_NAME);
    return outDir;
  };
  let outDir = join(root, GENERATED_DIR_NAME);
  // The table this plugin reads is an input whether or not anyone says so, and a
  // Consumer cannot reasonably be expected to know the path of a file inside a
  // Dependency. Resolving it here means upgrading the core regenerates the tree,
  // Instead of leaving a consumer's controls quietly out of date with the
  // Properties their types now declare.
  const coreInputs = coreSemanticInputs();
  let dependencies = [
    ...(options.dependencies ?? []).map((path) => resolve(root, path)),
    ...coreInputs,
  ];

  let server: ViteDevServer | undefined;
  let logger: ViteLoggerLike | undefined;
  let checkInDev = false;
  let checkedThisSession = false;
  // A framework that ships more than one bundle — a client one and a server one —
  // Resolves a configuration per environment and builds each of them, so the same
  // Plugin instance is asked for the same tree several times in a single process.
  // The tree is a function of its inputs, and nothing moves those inputs between
  // Two builds of one process, so the first run answers for all of them and the
  // Rest are told the tree is already there. A build in watch mode is a different
  // Question: its inputs can change between rebuilds, so it is asked every time.
  // A development server is asked through `handleHotUpdate`, which always
  // Regenerates.
  let generated = false;
  let watching = false;
  // A check runs the project's own TypeScript, and `tsc` is not on PATH for a
  // Process a bundler started. A project that keeps it in node_modules can point
  // At the binary; without this the check reports that it could not run, which is
  // Honest but useless.

  // Every path is resolved against the root Vite reports, not the one the
  // Process happened to start in: a monorepo package resolves them differently.
  const applyRoot = (next: string): void => {
    root = resolve(next);
    dependencies = [
      ...(options.dependencies ?? []).map((path) => resolve(root, path)),
      ...coreInputs,
    ];
  };

  /**
   * One diagnostic, through Vite's logger when the host gave one.
   *
   * The logger is what makes a plugin's output obey the consumer's `logLevel`
   * and share the dev server's formatting; `console.warn` bypasses both. It is
   * absent in a test and in a host that resolves a config without one, and
   * there is nothing to fall back to but the console.
   *
   * @param message what to say
   * @param once true for a fact about the project's files, which does not change
   *   between runs and would otherwise repeat on every hot update
   */
  const warn = (message: string, once: boolean): void => {
    if (logger === undefined) {
      console.warn(message);
      return;
    }
    if (once) {
      logger.warnOnce(message);
      return;
    }
    logger.warn(message);
  };

  /**
   * Where the mapping comes from, and therefore whether it may carry JSX.
   */
  /**
   * Where the mapping comes from: a loader, the plugin call, or the directory.
   *
   * A discovered directory is resolved on every run, so a control added while a
   * server is up is picked up the next time anything regenerates.
   */
  const readMapping = async (): Promise<{
    mapping: ComponentMapping;
    discovery: DiscoveredComponents | null;
  }> => {
    if (options.resolveMapping !== undefined) {
      const mapping = await options.resolveMapping();
      return { discovery: null, mapping };
    }

    if (options.shell !== undefined && options.components !== undefined) {
      const mapping: ComponentMapping = { components: options.components, shell: options.shell };
      requireNoBundlerConfigJsx(mapping);
      return { discovery: null, mapping };
    }

    if (options.componentsDir === undefined) {
      throw configError(
        root,
        "no mapping was given. Pass `componentsDir` and `shell` to find one file per type, or a mapping in the plugin call, or a `resolveMapping` loader",
      );
    }

    const discovery = await discoverComponents({
      componentsDir: resolve(root, options.componentsDir),
      shell: options.shell === undefined ? undefined : resolve(root, options.shell),
      omit: options.omit,
      // The generated module that will import them, so every specifier is
      // Relative and nothing has to resolve an alias.
      importer: join(resolveGeneratedDir(), "controls.ts"),
    });

    if (discovery.missing.length > 0) {
      throw mappingError(
        discovery.missing.map((type) => `\`${type}\``).join(", "),
        `no control file in \`${options.componentsDir}\` declares ${discovery.missing.length === 1 ? "it" : "them"}, and a type with no control renders nothing at all. Add the file, or list the type in \`omit\``,
      );
    }

    return {
      discovery,
      mapping: mappingFromDiscovery(discovery),
    };
  };

  const regenerate = async (): Promise<boolean> => {
    const { mapping } = await readMapping();
    resolveGeneratedDir();
    if (server !== undefined) {
      // The watcher needs the directory, and a development server can ask before
      // The first run has resolved the root the bundler reported.
      server.watcher.add(outDir);
    }
    const { dependencies } = options;
    const { prune } = options;
    const { onUnmapped } = options;
    const result = await generateComponents({
      components: mapping.components,
      outDir,
      shell: mapping.shell,
      ...(dependencies === undefined
        ? {}
        : { dependencies: dependencies.map((path) => resolve(root, path)) }),
      ...(prune === undefined ? {} : { prune }),
      ...(onUnmapped === undefined ? {} : { onUnmapped }),
    });
    // Checked on the first run of a session as well as on every change: a tree
    // That is already on disk may have been broken by a change made while no
    // Server was running, and that is exactly when a developer needs to hear.
    if (checkInDev && (result.changed || !checkedThisSession)) {
      checkedThisSession = true;
      // In development nothing else would: a bundler strips types without reading
      // Them, so a property the core does not declare would be dropped silently
      // Until a build. The tree is a real module, so the same `tsc` can be asked
      // Now, and a finding is printed where the developer is already looking.
      const tsc = options.checkTsc;
      const project = options.checkProject;
      const outcome = await checkGeneratedTree({
        outDir,
        ...(tsc === undefined ? {} : { tsc }),
        ...(project === undefined ? {} : { project }),
      });
      const described = describeCheck(outcome);
      if (described !== null) {
        warn(described, false);
      }
    }
    const named = new Set(Object.keys(mapping.components));
    for (const rejection of result.rejected) {
      // A type that holds other fields rather than an answer — `group`,
      // `repeater`, `component-ref` — is declined by every mapping, so warning
      // About it would put the same three lines in every consumer's terminal
      // Forever. It is only worth saying when the mapping named a component for
      // One, because then the consumer wrote something and the core ignored it.
      if (rejection.kind === "not-materializable" && !named.has(rejection.type)) {
        continue;
      }
      warn(`[colander]   ${rejection.type}: ${rejection.reason}`, true);
    }
    return result.changed;
  };

  /**
   * The tree, produced once for a process that asks for it more than once.
   *
   * Only the success is remembered: a run that refused, because the mapping is
   * wrong or a call still declares `outDir`, has to be able to fail the same way the
   * next time it is asked, rather than being remembered as a tree that exists.
   *
   * @returns whether the tree on disk changed
   */
  const regenerateIfUnasked = async (): Promise<boolean> => {
    if (generated && !watching) {
      return false;
    }
    const changed = await regenerate();
    generated = true;
    return changed;
  };

  return {
    async buildStart() {
      // A build must not depend on whatever the last development run left on
      // Disk, so the tree is produced again from the current inputs.
      await regenerateIfUnasked();
    },

    async configResolved(config) {
      applyRoot(config.root);
      logger = config.logger;
      watching = config.build?.watch != null;
      await regenerateIfUnasked();
    },

    configureServer(devServer) {
      server = devServer;
      checkInDev = true;
      // A mapping or a core semantics module usually lives outside the project
      // Root when the core is a linked workspace package, and Vite does not
      // Watch what it was not told about.
      devServer.watcher.add([...dependencies, outDir]);
    },

    async handleHotUpdate(context) {
      const isDependency = dependencies.includes(resolve(context.file));
      const isGenerated = (await generatedModules(outDir)).includes(resolve(context.file));
      if (!isDependency && !isGenerated) {
        return;
      }

      const changed = await regenerate();
      if (!changed || server === undefined) {
        return;
      }

      // Only the modules whose bytes moved are handed back. Vite propagates from
      // Them, and the consumer's own refresh boundary decides what to re-render.
      const paths = await generatedModules(outDir);
      const modules = paths
        .map((path) => server?.moduleGraph.getModuleById(path))
        .filter((module): module is ViteModuleNode => module !== undefined);
      if (modules.length === 0) {
        // The tree changed but nothing had imported it yet, so there is no
        // Module to invalidate. A full reload is the honest fallback: it is
        // Visible, and pretending the change landed would not be.
        context.server.moduleGraph.invalidateAll?.();
      }
      return modules;
    },

    name: "colander",
  };
}

/**
 * The files the core's semantic table is read from, resolved where they really are.
 *
 * A development server watches paths, not packages, and the table lives inside a
 * dependency. Resolving the module this package already imports is the only way
 * to know the path without asking the consumer to look it up.
 *
 * @returns absolute paths, empty when the runtime cannot resolve them
 */
function coreSemanticInputs(): readonly string[] {
  const resolved: string[] = [];
  for (const specifier of ["@ailura/colander-client/semantics"]) {
    try {
      const url = import.meta.resolve(specifier);
      if (url.startsWith("file://")) {
        resolved.push(fileURLToPath(url));
      }
    } catch {
      // A runtime that cannot resolve it is not a reason to refuse to generate.
    }
  }
  return resolved;
}
