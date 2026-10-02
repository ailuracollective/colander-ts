/**
 * Type-checking the generated tree.
 *
 * A control written as JSX is a string, so nothing about it is checked while the
 * file is being written: the editor cannot see inside it, and a development server
 * that only strips types never learns that `props.minLenght` is not a property of
 * a `text` field. The field then simply loses its constraint, and nothing says so
 * until a build runs.
 *
 * The generated tree is a real module in the consumer's own project, compiled by
 * the consumer's own TypeScript with the consumer's own settings. Checking it
 * here is therefore not a second opinion — it is the same one, asked earlier.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** What a check found. */
export type CheckOutcome = { readonly ok: true } | { readonly ok: false; readonly output: string };

/** How to reach the consumer's TypeScript. */
export interface CheckOptions {
  /** The directory holding the generated tree, resolved to its project. */
  readonly outDir: string;
  /** Files to check. Defaults to every module in the tree. */
  readonly files?: readonly string[];
  /**
   * The `tsc` binary. Defaults to the project's own TypeScript, which is where a
   * process a bundler started will not find it on PATH.
   */
  readonly tsc?: string;
  /** Milliseconds before the check is abandoned. Defaults to 20 seconds. */
  readonly timeoutMs?: number;
  /**
   * The TypeScript project that covers the tree. Defaults to the nearest
   * `tsconfig.json` above it, which in a project built around a solution file is
   * not the one that includes sources — so a project file that includes nothing is
   * reported rather than trusted.
   */
  readonly project?: string;
}

/**
 * Whether a TypeScript project lists sources of its own, and so checks anything.
 *
 * A project built around project references keeps a solution file at the root
 * whose `files` is empty and whose sources live in the projects it references.
 * Asking a checker to compile that reports success without reading a line, which
 * is why the shape of the file is inspected rather than trusted.
 *
 * @param path the project file
 * @returns `{ project }` when it lists sources, `null` when it does not
 */
function sourcesIn(path: string): { readonly project: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as { include?: unknown; files?: unknown };
  const includes = Array.isArray(record.include)
    ? record.include.filter((e) => typeof e === "string")
    : [];
  const files = Array.isArray(record.files)
    ? record.files.filter((e) => typeof e === "string")
    : [];
  return includes.length > 0 || files.length > 0 ? { project: path } : null;
}

/** TypeScript allows comments in a config file, and they are not JSON. */
/**
 * Make a TypeScript config file readable as JSON.
 *
 * Comments and trailing commas are both allowed in one and are both written by
 * hand, so a file that uses either still has to be understood here.
 */
function stripJsonComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|[^:])\/\/.*$/gm, "$1")
    .replaceAll(/,(\s*[}\]])/g, "$1");
}

/**
 * The TypeScript project a directory's files are compiled under.
 *
 * Walking up finds the nearest `tsconfig.json`, but a project built with project
 * references keeps a solution file at the root that names other files and
 * includes nothing of its own. Pointing a check at that checks nothing and
 * reports success, which is the most dangerous outcome available here, so it is
 * reported instead.
 *
 * @param outDir the directory whose files will be checked
 * @param named a project the consumer named, which is used as given
 * @returns the project file, or the reason there is none to use
 */
export function findCheckProject(
  outDir: string,
  named?: string,
): { readonly project: string } | { readonly reason: string } {
  if (named !== undefined) {
    return { project: isAbsolute(named) ? named : resolve(process.cwd(), named) };
  }

  let directory = resolve(outDir);
  for (;;) {
    const candidate = join(directory, "tsconfig.json");
    if (existsSync(candidate)) {
      const found = sourcesIn(candidate);
      return (
        found ?? {
          reason: `${candidate} lists no sources of its own, so checking against it would check nothing and report success. Point the check at the project that covers the generated tree, such as \`checkProject: "tsconfig.app.json\``,
        }
      );
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return {
        reason:
          "no tsconfig.json was found above the generated tree, so there is nothing to check it against",
      };
    }
    directory = parent;
  }
}

/**
 * Check the generated tree with the project's own TypeScript.
 *
 * The result is reported, never thrown: a generated file that does not compile is
 * a finding about the consumer's mapping, and it has to reach them in the shape
 * they can act on rather than as a build that died somewhere else.
 *
 * @param options which files to check and with what
 * @returns whether the tree compiles, and the compiler's own output when it does not
 */
/**
 * The TypeScript a project installed, found without a PATH lookup.
 *
 * A bundler starts its plugins with an environment that does not include
 * `node_modules/.bin`, so `tsc` is usually not runnable by name. Most projects
 * that have a TypeScript at all have this exact file.
 *
 * @param cwd the project to look in
 * @returns the binary to run, or `tsc` when nothing better is installed
 */
export function projectTypeScript(cwd: string = process.cwd()): string {
  const local = resolve(cwd, "node_modules/typescript/bin/tsc");
  return existsSync(local) ? local : "tsc";
}

export async function checkGeneratedTree(options: CheckOptions): Promise<CheckOutcome> {
  const files = options.files ?? [];
  const tsc = options.tsc ?? projectTypeScript();
  const found = findCheckProject(options.outDir, options.project);
  if ("reason" in found) {
    return { ok: false, output: found.reason };
  }
  const args = ["--noEmit", "--pretty", "false", "--project", found.project, ...files];

  return new Promise<CheckOutcome>((resolve) => {
    // No shell. The arguments are paths and the command is the consumer's own,
    // And a file name carrying a shell metacharacter must not be able to run
    // Anything; the consumer can point `tsc` at a wrapper script of their own.
    const child = spawn(tsc, args, { cwd: process.cwd() });
    let output = "";
    child.stdout?.on("data", (chunk: unknown) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk: unknown) => {
      output += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill();
      resolve({
        ok: false,
        output: `The check of ${options.outDir} did not finish in time and was stopped. The tree has not been verified.`,
      });
    }, options.timeoutMs ?? 20_000);

    child.on("error", (error: Error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: `Could not run \`${tsc}\`: ${error.message}. Install TypeScript in this project, or point the check at it with \`checkTsc\`.`,
      });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true } : { ok: false, output: output.trim() });
    });
  });
}

/**
 * A one-line, actionable rendering of a failed check.
 *
 * @param outcome what the check found
 * @returns a message to print, or `null` when there is nothing to report
 */
export function describeCheck(outcome: CheckOutcome): string | null {
  if (outcome.ok) {
    return null;
  }
  return [
    "[colander-compiler] the generated tree does not type-check.",
    "  The property names it uses are the core's, so this is almost always a name the core",
    "  does not declare for that type, or a control that draws a label the shell already draws.",
    outcome.output,
  ].join("\n");
}
