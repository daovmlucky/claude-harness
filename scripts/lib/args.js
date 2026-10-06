// args.js — strict command-line parsing shared by the CLIs.
// Throws Error with a usage-style message on a missing option value (absent or
// starting with "--"), an unknown option, or (via `positional`) extra arguments.
function parseArgs(args, { values = [], flags = [] }) {
  const out = { values: {}, flags: new Set(), positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { out.positional.push(a); continue; }
    if (values.includes(a)) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`option ${a} requires a value`);
      out.values[a] = v;
      i++;
    } else if (flags.includes(a)) {
      out.flags.add(a);
    } else {
      throw new Error(`unknown option ${a}`);
    }
  }
  return out;
}

module.exports = { parseArgs };
