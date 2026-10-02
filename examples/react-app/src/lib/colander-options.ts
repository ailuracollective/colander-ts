/**
 * Everything the Colander plugin needs, in one place.
 *
 * The controls are found by convention: one file per type, in the directory
 * `componentsDir` names, each exporting its control by default, plus a `shell`
 * for the frame around them. There is no mapping to write and no configuration
 * file to keep in step, and a type whose file is missing fails the build rather
 * than rendering nothing.
 *
 * This lives in its own module rather than in `vite.config.ts` because the drift
 * guard reads the same values, and a bundler configuration cannot be imported
 * for its named exports: a test that imports it receives the configuration
 * object alone, so `colanderOptions` would be `undefined` there. One module, read
 * by both, is what keeps the guard from drifting.
 *
 * There is no destination here: the tree has one fixed home, `.colander/` at the
 * root, and a call that passed `outDir` would be refused.
 */
export const colanderOptions = {
  componentsDir: "src/components/colander",
  shell: "src/components/colander/shell",
  // This project keeps its sources in tsconfig.app.json; its root tsconfig is a
  // solution file that lists none, and checking against that would report success
  // without reading a line.
  checkProject: "tsconfig.app.json",
};
