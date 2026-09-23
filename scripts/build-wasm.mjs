import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Parser, extract } from "tar";

const CRATE_ARCHIVE_SHA256 = "315c951f0b0e865a00b5a3eaa5e5caf1a5a4fdf41de387d8253cb3d3df9ab2ea",
  CRATE_NAME = "colander",
  CRATE_VERSION = "0.1.0",
  ARCHIVE_ROOT = `${CRATE_NAME}-${CRATE_VERSION}`,
  DOWNLOAD_URL = `https://crates.io/api/v1/crates/${CRATE_NAME}/${CRATE_VERSION}/download`,
  TARGET = "wasm32-unknown-unknown",
  REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url)),
  OUTPUT = join(REPOSITORY_ROOT, "wasm", "colander.wasm"),
  REQUIRED_FUNCTIONS = [
    "colander_content_hash",
    "colander_evaluate_rules",
    "colander_next_version",
    "colander_version_info",
    "colander_abi_version",
    "colander_free_string",
    "colander_validate_schema",
    "colander_alloc",
    "colander_free_buffer",
    "colander_compile",
    "colander_validate_response",
  ],
  temporaryRoot = await mkdtemp(join(tmpdir(), "colander-wasm-")),
  archive = join(temporaryRoot, `${CRATE_NAME}-${CRATE_VERSION}.crate`),
  sourceRoot = join(temporaryRoot, "source"),
  crateRoot = join(sourceRoot, `${CRATE_NAME}-${CRATE_VERSION}`);
try {
  console.log(`Downloading ${CRATE_NAME}@${CRATE_VERSION} from ${DOWNLOAD_URL}`);
  const response = await fetch(DOWNLOAD_URL, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));

  const archiveBytes = await readFile(archive);
  const actualChecksum = createHash("sha256").update(archiveBytes).digest("hex");
  if (actualChecksum !== CRATE_ARCHIVE_SHA256) {
    throw new Error(
      `archive SHA-256 mismatch: expected ${CRATE_ARCHIVE_SHA256}, got ${actualChecksum}`,
    );
  }
  console.log(`Verified archive SHA-256 ${actualChecksum}`);

  assertSafeArchive(archiveBytes);
  await mkdir(sourceRoot);
  extractArchive(archiveBytes, sourceRoot);

  run(
    "cargo",
    [
      "build",
      "--manifest-path",
      join(crateRoot, "Cargo.toml"),
      "--target",
      TARGET,
      "--release",
      "--locked",
    ],
    {
      cwd: temporaryRoot,
      env: { ...process.env, CARGO_TARGET_DIR: join(temporaryRoot, "target") },
    },
  );

  const builtArtifact = join(temporaryRoot, "target", TARGET, "release", `${CRATE_NAME}.wasm`),
    bytes = await readFile(builtArtifact);
  if (!WebAssembly.validate(bytes)) {
    throw new Error(`cargo produced an invalid WebAssembly module at ${builtArtifact}`);
  }
  await verifyModule(bytes);

  await mkdir(dirname(OUTPUT), { recursive: true });
  await copyFile(builtArtifact, OUTPUT);
  console.log(`Copied ${OUTPUT} (${bytes.length} bytes)`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
/**
 * @param {string} command
 * @param {readonly string[]} arguments_
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 */
function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  }
}
/** @param {Buffer} archiveBytes */
function assertSafeArchive(archiveBytes) {
  const validator = createArchiveEntryValidator();
  const parser = new Parser({
    filter: validator,
    gzip: true,
    maxMetaEntrySize: -1,
    onReadEntry: (entry) => {
      entry.resume();
    },
    onwarn: throwTarWarning,
    strict: true,
  });
  processArchiveStream(parser, archiveBytes);
  if (!validator.hasEntries()) {
    throw new Error("archive contains no file or directory entries");
  }
}
/** @param {Buffer} archiveBytes
 * @param {string} destination */
function extractArchive(archiveBytes, destination) {
  const validator = createArchiveEntryValidator();
  const unpack = extract({
    cwd: destination,
    filter: validator,
    gzip: true,
    maxMetaEntrySize: -1,
    onwarn: throwTarWarning,
    preserveOwner: false,
    strict: true,
    sync: true,
  });
  processArchiveStream(unpack, archiveBytes);
}
/** @param {Parser | import("tar").UnpackSync} reader
 * @param {Buffer} archiveBytes */
function processArchiveStream(reader, archiveBytes) {
  /** @type {Error | false} */
  let failure = false;
  reader.on("error", (error) => {
    failure = error instanceof Error ? error : new Error(String(error));
  });
  /** @type {(entry: TarReadEntry) => void} */
  const rejectIgnoredEntry = (entry) => {
    reader.abort(new Error(`unsupported archive entry type: ${entry.type}`));
  };
  reader.on("ignoredEntry", rejectIgnoredEntry);
  reader.on("meta", () => {
    reader.abort(new Error("archive metadata entries are not allowed"));
  });
  try {
    reader.end(archiveBytes);
  } catch (error) {
    if (!failure) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (failure !== false) {
    throw failure;
  }
}
function createArchiveEntryValidator() {
  const seen = new Set();
  let entrySeen = false;
  /** @type {ArchiveValidator} */
  const validator = (path, entry) => {
    if (!("header" in entry)) {
      throw new Error("archive filter received filesystem metadata instead of an entry");
    }
    const normalizedPath = normalizeArchivePath(path, entry);
    if (entry.type !== "File" && entry.type !== "Directory") {
      throw new Error(`unsupported archive entry type for ${JSON.stringify(path)}: ${entry.type}`);
    }
    const canonicalPath = normalizedPath.normalize("NFKD").toLowerCase();
    if (seen.has(canonicalPath)) {
      throw new Error(`duplicate archive entry: ${JSON.stringify(path)}`);
    }
    if (normalizedPath === ARCHIVE_ROOT) {
      if (entry.type !== "Directory") {
        throw new Error(`archive root is not a directory: ${JSON.stringify(path)}`);
      }
    } else if (!normalizedPath.startsWith(`${ARCHIVE_ROOT}/`)) {
      throw new Error(`unsafe archive path: ${JSON.stringify(path)}`);
    }
    seen.add(canonicalPath);
    entrySeen = true;
    return true;
  };
  validator.hasEntries = () => entrySeen;
  return validator;
}
/**
 * @param {string} rawPath
 * @param {string} entryType
 */
function validatePortableSegments(rawPath, entryType) {
  const parts = rawPath.split("/");
  if (parts.at(-1) === "" && entryType === "Directory") {
    parts.pop();
  }
  for (const part of parts) {
    let invalidWindowsCharacter = false;
    for (const character of part) {
      const code = character.codePointAt(0) ?? 0;
      if (code <= 31 || (code >= 127 && code <= 159) || '<>:"|?*\\'.includes(character)) {
        invalidWindowsCharacter = true;
        break;
      }
    }
    if (
      part === "" ||
      part === "." ||
      part === ".." ||
      invalidWindowsCharacter ||
      /[ .]$/u.test(part) ||
      /^(?:aux|clock\$|con|conin\$|conout\$|nul|prn|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu.test(part)
    ) {
      throw new Error(`unsafe archive path: ${JSON.stringify(rawPath)}`);
    }
  }
}
/**
 * @param {string} path
 * @param {TarReadEntry} entry
 * @returns {string}
 */
function normalizeArchivePath(path, entry) {
  for (const rawPath of [
    path,
    entry.header.path,
    entry.extended?.path,
    entry.globalExtended?.path,
  ]) {
    if (typeof rawPath === "string") {
      if (
        rawPath.includes("\0") ||
        rawPath.includes("\\") ||
        rawPath.startsWith("/") ||
        /^[A-Za-z]:/u.test(rawPath)
      ) {
        throw new Error(`unsafe archive path: ${JSON.stringify(rawPath)}`);
      }
      validatePortableSegments(rawPath, entry.type);
      const rawNormalizedPath = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
      if (rawNormalizedPath !== ARCHIVE_ROOT && !rawNormalizedPath.startsWith(`${ARCHIVE_ROOT}/`)) {
        throw new Error(`unsafe archive path: ${JSON.stringify(rawPath)}`);
      }
    }
  }
  if (path.length === 0) {
    throw new Error("unsafe archive path: empty path");
  }
  const hasTrailingSlash = path.endsWith("/");
  if (hasTrailingSlash && entry.type !== "Directory") {
    throw new Error(`unsafe archive path: ${JSON.stringify(path)}`);
  }
  const normalizedPath = hasTrailingSlash ? path.slice(0, -1) : path;
  if (normalizedPath.length === 0 || normalizedPath.endsWith("/")) {
    throw new Error(`unsafe archive path: ${JSON.stringify(path)}`);
  }
  return normalizedPath;
}
/**
 * @param {string} code
 * @param {string | Error} message
 */
function throwTarWarning(code, message) {
  throw new Error(`archive warning ${code}: ${message}`);
}
/** @typedef {import("tar").ReadEntry} TarReadEntry */
/** @typedef {((path: string, entry: TarReadEntry | import("node:fs").Stats) => boolean) & { hasEntries: () => boolean }} ArchiveValidator */
/**
 * @param {BufferSource} bytes
 */
async function verifyModule(bytes) {
  const compiledModule = await WebAssembly.compile(bytes),
    imports = WebAssembly.Module.imports(compiledModule);
  if (imports.length > 0) {
    throw new Error(
      `built module unexpectedly imports: ${imports.map(({ module: importModule, name }) => `${importModule}.${name}`).join(", ")}`,
    );
  }
  const exports = new Set(WebAssembly.Module.exports(compiledModule).map(({ name }) => name));
  for (const name of REQUIRED_FUNCTIONS) {
    if (!exports.has(name)) {
      throw new Error(`built module does not export ${name}()`);
    }
  }
  if (exports.has("colander_last_panic")) {
    throw new Error("built module unexpectedly exports the removed colander_last_panic()");
  }
}
