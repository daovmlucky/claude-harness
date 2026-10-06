// lib.test.js — unit checks for scripts/lib/*.
const fs = require('fs');
const path = require('path');
const { makeChecker, mkTmp, write, rm, makeFakeHarness } = require('./lib/testutil');
const { listManaged, sha256, readManifest } = require('./lib/fsutil');
const { check, done } = makeChecker();

const root = mkTmp('lib-');
makeFakeHarness(root);

const files = listManaged(root);
check('lists managed files, posix style, sorted',
  JSON.stringify(files) === JSON.stringify(['.claude/commands/a.md', '.claude/workflows/w.js']));
check('excludes manifest exclude entries', !files.includes('.claude/commands/skip.md'));
check('never lists settings.local.json', !files.some((f) => f.includes('settings.local')));
check('readManifest returns the parsed manifest', readManifest(root).harnessVersion === '1.0.0');

const a = path.join(root, '.claude/commands/a.md');
const w = path.join(root, '.claude/workflows/w.js');
check('sha256 is content based', sha256(a) === sha256(a) && sha256(a) !== sha256(w));
const crlf = path.join(root, 'crlf.txt');
const lf = path.join(root, 'lf.txt');
write(crlf, 'one\r\ntwo\r\n');
write(lf, 'one\ntwo\n');
check('sha256 ignores CRLF vs LF (core.autocrlf on Windows)', sha256(crlf) === sha256(lf));
check('sha256 still tells different content apart', sha256(lf) !== sha256(a));

rm(root);
done('lib');
