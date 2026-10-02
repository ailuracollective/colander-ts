/**
 * Finding a consumer's controls by convention.
 *
 * A mapping written by hand repeats a module on every line and can be wrong in
 * ways nothing notices: a type misspelled produces no control and the field is
 * simply never rendered. A directory of files named after the types removes both
 * problems at once. `text.tsx` is the control for `text`, because the file says
 * so and the core says what types exist — so a file the core does not recognise
 * is visible rather than decorative, and a type with no file is a decision
 * instead of an accident.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { SEMANTIC_TYPE_DESCRIPTORS } from "@ailura/colander-client/semantics";

import { mappingError } from "./errors.js";
import type { ComponentSource, ImportedComponent, MaterializableFieldType } from "./plan.js";

/** One control the convention found. */
export interface DiscoveredControl {
  /** The semantic type the file's name declares. */
  readonly type: MaterializableFieldType;
  /** The file, as an absolute path. */
  readonly file: string;
  /** How the generated module should name it. */
  readonly source: ImportedComponent;
}

/** What one discovery found, and what it did not. */
export interface DiscoveredComponents {
  /** One entry per type the core materializes, in the core's own order. */
  readonly controls: readonly DiscoveredControl[];
  /** The shell, when one was named. */
  readonly shell: DiscoveredControl | null;
  /** Files in the directory that name no type, which are none of the compiler's business. */
  readonly ignored: readonly string[];
  /** Types the core materializes that no file declares. */
  readonly missing: readonly MaterializableFieldType[];
}

const MATERIALIZABLE = new Map<string, MaterializableFieldType>(
  SEMANTIC_TYPE_DESCRIPTORS.filter((descriptor) => descriptor.materializable).map((descriptor) => [
    descriptor.type,
    descriptor.type,
  ]),
);

/** The extensions a control file may have. */
const CONTROL_EXTENSIONS = [".tsx", ".ts"] as const;

/**
 * The specifier a generated module uses to reach a file.
 *
 * Relative to the importing module, so the generated code needs no bundler
 * alias and no `baseUrl`: what resolves in the editor resolves in the bundler
 * and in `tsc`, from the same text. It names a module rather than a file, so the
 * extension is dropped.
 *
 * @param fromFile the file that will import it
 * @param target the file being imported
 * @returns a specifier, with forward slashes
 */
export function relativeSpecifier(fromFile: string, target: string): string {
  const path = relative(resolve(fromFile, ".."), resolve(target));
  const withoutExtension = path.replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, "");
  const posix = withoutExtension.split(sep).join("/");
  return posix.startsWith(".") ? posix : `./${posix}`;
}

/**
 * Find the file behind a module specifier, which may carry no extension.
 *
 * @param specifier a path as it would be imported
 * @returns the file that exists, or `null` when none does
 */
async function findModuleFile(specifier: string): Promise<string | null> {
  const base = resolve(specifier);
  for (const candidate of [base, ...CONTROL_EXTENSIONS.map((extension) => `${base}${extension}`)]) {
    try {
      // The file itself, not the directory around it: a shell that is named but
      // Absent would otherwise be found, and every control would import nothing.
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Not this one; the next candidate is just as likely.
    }
  }
  return null;
}

/** A control reference that imports a file's default export. */
function fromFile(file: string, from: string): ImportedComponent {
  return { export: "default", module: relativeSpecifier(from, file) };
}

/**
 * Find every control in a directory, and the shell if one was named.
 *
 * A file is a control when its name, without an extension, is exactly a type the
 * core materializes. Anything else in the directory is left alone and reported,
 * so a misspelled control is visible without every helper file being an error.
 *
 * @param options the directory, the shell's file, the types to leave out, and the file that will import them
 * @returns what was found, what was ignored, and what no file declares
 */
export async function discoverComponents(options: {
  /** The directory the controls live in. */
  readonly componentsDir: string;
  /** The shell's file, which has no type name of its own. */
  readonly shell?: string | undefined;
  /** Types the consumer deliberately does not materialise. */
  readonly omit?: readonly string[] | undefined;
  /** The generated module the imports are written for. */
  readonly importer: string;
}): Promise<DiscoveredComponents> {
  const dir = resolve(options.componentsDir);
  const omitted = new Set(options.omit ?? []);
  for (const type of omitted) {
    if (!MATERIALIZABLE.has(type) && type !== "shell") {
      throw mappingError(
        `the omitted type \`${type}\``,
        "it names no type the core materializes, so there is nothing to omit",
      );
    }
  }

  const found = new Map<MaterializableFieldType, DiscoveredControl>();
  const ignored: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw mappingError(
      `the components directory \`${options.componentsDir}\``,
      `it could not be read (${reason}). Point \`componentsDir\` at the directory that holds one file per type`,
    );
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const extension = CONTROL_EXTENSIONS.find((candidate) => entry.name.endsWith(candidate));
    if (extension === undefined) {
      continue;
    }
    const stem = entry.name.slice(0, -extension.length);
    const type = MATERIALIZABLE.get(stem);
    if (type === undefined) {
      ignored.push(entry.name);
      continue;
    }
    if (found.has(type)) {
      throw mappingError(
        `the \`${type}\` control`,
        `two files declare it (\`${found.get(type)?.file}\` and \`${join(dir, entry.name)}\`). One type, one file`,
      );
    }
    const file = join(dir, entry.name);
    found.set(type, { file, source: fromFile(file, options.importer), type });
  }

  // The shell is named the way a module is imported, without an extension, so
  // The file behind it is found rather than assumed.
  const shellFile = options.shell === undefined ? null : await findModuleFile(options.shell);
  if (options.shell !== undefined && shellFile === null) {
    throw mappingError(
      "the field shell",
      `\`${options.shell}\` names no file. The shell is the component that renders a field's label, description and messages, and every generated control imports it`,
    );
  }

  const controls = SEMANTIC_TYPE_DESCRIPTORS.filter((descriptor) => descriptor.materializable)
    .map((descriptor) => found.get(descriptor.type))
    .filter((control): control is DiscoveredControl => control !== undefined);

  const missing = SEMANTIC_TYPE_DESCRIPTORS.filter(
    (descriptor) => descriptor.materializable && !found.has(descriptor.type),
  )
    .map((descriptor) => descriptor.type as MaterializableFieldType)
    .filter((type) => !omitted.has(type));

  return {
    controls,
    ignored,
    missing,
    shell:
      shellFile === null
        ? null
        : {
            file: shellFile,
            source: fromFile(shellFile, options.importer),
            type: "shell" as never,
          },
  };
}

/** The mapping a discovery implies, in the shape the planner already accepts. */
export function mappingFromDiscovery(discovery: DiscoveredComponents): {
  shell: ComponentSource;
  components: Partial<Record<MaterializableFieldType, ComponentSource>>;
} {
  if (discovery.shell === null) {
    throw mappingError(
      "the field shell",
      "no shell was named. Every generated control wraps itself in one, so `shell` is required",
    );
  }
  const components: Partial<Record<MaterializableFieldType, ComponentSource>> = {};
  for (const control of discovery.controls) {
    components[control.type] = control.source;
  }
  return { components, shell: discovery.shell.source };
}
