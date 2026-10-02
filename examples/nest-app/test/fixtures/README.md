# Fixture provenance

These fixtures are copied from the golden vectors of the Rust crate `colander@0.1.0`, file
`tests/golden/vectors/rules.json`:

| fixture                | golden vector                         |
| ---------------------- | ------------------------------------- |
| `bmi-calculation.json` | `fixture:evaluate-calculation.json`   |
| `bp-cross-field.json`  | `fixture:evaluate-bp-validation.json` |

Only the `form` and `rules` members of each vector were copied. The request envelopes around them
(the vector's `values`, expected output, and so on) were not.

The values were re-verified against the installed package: the BMI form compiles to the golden
content hash, the calculation yields `body.bmi = 22.86`, and the blood-pressure validation reports
`BP_SYSTOLIC_GT_DIASTOLIC`. Run `pnpm test` in this directory to check that.
