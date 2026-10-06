# Changelog

Every released `harnessVersion` needs an entry below. Classify each change:

- patch: bug fix or wording tweak, no behaviour change
- minor: additive and backward compatible (optional stage or command, report-only checks)
- major: breaks a product that is mid-pipeline (changes the shape of a state file,
  renames a command, needs new settings/env/Claude Code version, changes the
  execution model). Sync refuses major jumps.

## 1.0.0
- Initial product bootstrap: `new-product.js`, `sync-harness.js`, `product-template/`, `/product-brainstorm`.
- `/product-brainstorm` ships with prompts written for a motorbike-touring app; it is replaced by a generic `/brainstorm` in a later phase.
- Renaming a managed file only by case (Explore.md -> explore.md) removes the old file and reports the new path as a conflict on Windows; rename via a new name instead.
