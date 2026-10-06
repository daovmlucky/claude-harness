# Changelog

Every released `harnessVersion` needs an entry below. Classify each change:

- patch: bug fix or wording tweak, no behaviour change
- minor: additive and backward compatible (optional stage or command, report-only checks)
- major: breaks a product that is mid-pipeline (changes the shape of a state file,
  renames a command, needs new settings/env/Claude Code version, changes the
  execution model). Sync refuses major jumps.

## 1.0.0
- Initial product bootstrap: `new-product.js`, `sync-harness.js`, `product-template/`, `/product-brainstorm`.
