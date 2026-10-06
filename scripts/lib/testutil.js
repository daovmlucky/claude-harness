// testutil.js — tiny shared helpers for the self-written test scripts.
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeChecker() {
  let ok = true;
  return {
    check(name, cond) { if (!cond) { console.error(`FAIL: ${name}`); ok = false; } },
    done(label) { if (!ok) process.exit(1); console.log(`PASS (${label})`); },
  };
}

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

// A minimal stand-in for claude-harness: a versioned manifest, a few managed
// files, a personal settings file that must never be copied, a product
// template and a changelog.
function makeFakeHarness(root) {
  write(path.join(root, 'harness.manifest.json'), JSON.stringify({
    harnessVersion: '1.0.0',
    managed: ['.claude/commands', '.claude/workflows'],
    exclude: ['.claude/commands/skip.md'],
  }));
  write(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0\n- initial\n');
  write(path.join(root, '.claude/commands/a.md'), 'a v1\n');
  write(path.join(root, '.claude/commands/skip.md'), 'skip\n');
  write(path.join(root, '.claude/workflows/w.js'), 'w v1\n');
  write(path.join(root, '.claude/settings.local.json'), '{"personal":true}');
  write(path.join(root, 'product-template/CLAUDE.md.tmpl'), '# {{NAME}}\n');
  write(path.join(root, 'product-template/gitignore.tmpl'), 'node_modules/\n');
  write(path.join(root, 'product-template/docs/gates.json'), '{"G0":null}\n');
  write(path.join(root, 'product-template/.claude/settings.json'),
    '{"permissions":{"deny":["Bash(gh pr merge *)","Bash(git push -f *)"]}}\n');
}

// Copy the CLI scripts into a fake harness, so a CLI run WITHOUT --harness-root
// defaults to that fake harness and can never reach the real one.
function installScripts(root) {
  const src = path.join(__dirname, '..');
  for (const f of ['new-product.js', 'sync-harness.js']) write(path.join(root, 'scripts', f), fs.readFileSync(path.join(src, f), 'utf8'));
  for (const f of fs.readdirSync(__dirname)) {
    if (f.endsWith('.js')) write(path.join(root, 'scripts', 'lib', f), fs.readFileSync(path.join(__dirname, f), 'utf8'));
  }
}

module.exports = { makeChecker, mkTmp, write, rm, makeFakeHarness, installScripts };
