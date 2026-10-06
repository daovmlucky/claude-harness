// version.js — tiny semver helpers and CHANGELOG slicing (no dependency).
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(v) {
  const m = SEMVER.exec(String(v));
  if (!m) throw new Error(`invalid version "${v}": expected MAJOR.MINOR.PATCH`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const major = (v) => parse(v)[0];

function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// "## <semver>" sections of a CHANGELOG, as { version, body }.
function entries(text) {
  return text.split(/^## /m).slice(1).flatMap((part) => {
    const [head, ...rest] = part.split('\n');
    const version = head.trim().split(/\s/)[0];
    return SEMVER.test(version) ? [{ version, body: rest.join('\n').trim() }] : [];
  });
}

// entries with from < version <= to, ascending
function changelogBetween(text, from, to) {
  return entries(text)
    .filter((e) => compare(e.version, from) > 0 && compare(e.version, to) <= 0)
    .sort((a, b) => compare(a.version, b.version));
}

function hasChangelogEntry(text, version) {
  return entries(text).some((e) => e.version === String(version));
}

module.exports = { parse, major, compare, changelogBetween, hasChangelogEntry };
