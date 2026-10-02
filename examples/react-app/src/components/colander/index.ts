/**
 * This application's controls, keyed by the semantic type each one materialises.
 *
 * The key is the type rather than the component's name, because the type is what a
 * leaf carries: `text` is the control for a `text` field, whatever the component
 * happens to be called. `colander()` writes the same mapping as data next to this
 * file, so a control added here and a type added there are the same change.
 */
export { default as text } from "./text";
export { default as textarea } from "./textarea";
export { default as number } from "./number";
export { default as integer } from "./integer";
export { default as boolean } from "./boolean";
export { default as date } from "./date";
export { default as datetime } from "./datetime";
export { default as time } from "./time";
export { default as choice } from "./choice";
export { default as shell } from "./shell";
