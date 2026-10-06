# Phase 0 — Product Bootstrap & Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép `claude-harness` khởi tạo một repo sản phẩm mới (`new-product.js`) và đẩy các cập nhật **không phá vỡ** từ harness sang TẤT CẢ repo sản phẩm đã tạo (`sync-harness.js`) mà không đụng vào thư mục đang làm việc của chúng.

**Architecture:** Harness khai báo phần được phân phối và số phiên bản (`harnessVersion`, semver) trong `harness.manifest.json`. `new-product.js` copy phần đó + sinh phần riêng của sản phẩm từ `product-template/`, ghi checksum và phiên bản vào `.claude/.harness-version`, đăng ký repo vào `.harness/products.json` (gitignored). `sync-harness.js` so checksum để phân loại từng file (add / update / remove / conflict / kept / current), **từ chối nhảy phiên bản major**, mặc định chỉ in kế hoạch, và khi `--apply` thì ghi vào một **git worktree riêng** cạnh repo sản phẩm (không bao giờ vào thư mục đang làm việc), không commit, không push.

**Tech Stack:** Node.js v20 (CommonJS, không dependency), `git` CLI (cần `git worktree`), test tự viết kiểu `check()` như `scripts/check-harness.test.js`.

**Spec:** `docs/superpowers/specs/2026-10-06-idea-to-pr-workflows-design.md` — mục 5.0 (Phase 0), mục 10, mục 11 (quyết định 7–9).

## Global Constraints

- Script là Node CommonJS thuần, **không thêm dependency**; chạy được trên Node v20.15 và Windows (đường dẫn lưu trong manifest/version file luôn dạng posix `/`; chuỗi in ra console chỉ dùng ASCII).
- `new-product.js` **không commit và không tạo remote** (spec 5.0 bước 6).
- `sync-harness.js` **không commit, không push**, và khi `--apply` **không ghi vào thư mục làm việc của repo sản phẩm**; kết quả nằm ở worktree `<product>-sync` trên nhánh `chore/harness-sync-v<version>`.
- Sync **từ chối** khi số major của `harnessVersion` khác nhau giữa harness và sản phẩm; không có migration, không có `--upgrade-major`.
- Phân loại thay đổi ở harness: **patch** = sửa lỗi/chỉnh prompt; **minor** = thêm mới tương thích ngược (command/stage tuỳ chọn, kiểm tra chỉ báo cáo); **major** = làm hỏng sản phẩm đang chạy dở (đổi hình dạng file trạng thái, đổi tên command, cần cờ/quyền/phiên bản Claude Code mới, đổi mô hình chạy). Cổng chặn cứng mới chỉ là minor nếu sản phẩm tự bật cưỡng chế.
- Mỗi `harnessVersion` phải có mục `## <version>` trong `CHANGELOG.md`.
- Sổ đăng ký `.harness/products.json` nằm trong `.gitignore` của harness (chứa đường dẫn máy cá nhân).
- File repo sản phẩm đã tự sửa **không bao giờ bị ghi đè**; được liệt kê là xung đột (spec 5.0).
- `.claude/settings.json` của sản phẩm thuộc về sản phẩm: sync **không bao giờ ghi** vào nó, chỉ in cảnh báo nếu thiếu luật deny của template.
- Repo sản phẩm nằm cùng cấp với claude-harness (`D:\internal_project\<tên>`); GitHub của `daovmlucky` ở chế độ **private**; chỉ tạo remote/push sau khi người dùng xác nhận từng lần (spec quyết định 7–8).
- Nội dung riêng của sản phẩm (brief brainstorm) **không commit vào claude-harness** vì repo này public (spec quyết định 9).
- Mỗi commit kết thúc bằng dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; chỉ `git add` đúng file nêu trong task (working tree đang có file chưa theo dõi của người dùng: `.claude/skills/deep-dive/`, `docs/deep-dives/`, `.claude/commands/deep-dive.md`, `.claude/workflows/study-research.js`, `README.md` đã sửa dở — KHÔNG add các file này).

## Deviations so với spec (có chủ ý)

1. Spec 5.0 nói "in diff trước khi áp dụng". Kế hoạch in **kế hoạch ở mức file** (add/update/remove/conflict) và mặc định là dry-run; `git diff` xem được trong worktree sau `--apply`. Lý do: tránh xây trình diff riêng (YAGNI).
2. Luật deny trong template dùng cú pháp `Bash(gh pr merge *)` cho khớp quy ước trong `.claude/settings.local.json`, thay vì `:*` như spec. Task 8 sửa spec cho khớp.
3. `.claude/settings.json` của sản phẩm không được sync; sync chỉ **in cảnh báo** luật deny còn thiếu để người dùng tự thêm. Lý do: thay đổi cần cờ/quyền mới là thay đổi major, không sync.
4. Spec nói "tạo nhánh `chore/harness-sync-<version>`". Kế hoạch tạo nhánh đó trong một **git worktree riêng** để phiên làm việc đang chạy trong repo sản phẩm không bị đổi file dưới chân. Điều kiện: sản phẩm đã có ≥1 commit và `.claude/` không có thay đổi chưa commit.
5. Spec chưa có quản lý phiên bản. Kế hoạch thêm `harnessVersion` (semver), từ chối major, và `CHANGELOG.md` bắt buộc cho mỗi phiên bản (kết quả thảo luận với người dùng).

## Review Focus

Các đầu vào/điều kiện lỗi mà spec ngầm hiểu nhưng không task nào kiểm thử mặc định; mỗi dòng có test ở task sở hữu:

1. Tên sản phẩm sai (`Ridgo`, `my app`, `../escape`, `a`, `-x`) → bị từ chối TRƯỚC khi ghi bất cứ thứ gì lên đĩa (Task 3).
2. Thư mục đích đã tồn tại và không rỗng → từ chối, file có sẵn không bị đụng vào (Task 3).
3. `settings.local.json`, `.harness/`, và file loại trừ trong manifest không bao giờ được copy sang repo sản phẩm (Task 3).
4. File managed bị sản phẩm sửa → báo conflict, không ghi đè; không bị sửa → update; sản phẩm sửa mà harness không đổi → giữ nguyên (Task 5).
5. Sổ đăng ký trỏ tới thư mục không còn tồn tại, hoặc JSON hỏng → cảnh báo / báo lỗi rõ ràng, các repo còn lại vẫn được sync (Task 6).
6. Nhảy phiên bản major (hoặc sản phẩm mới hơn harness) → `SKIPPED`, không ghi gì (Task 5, 6).
7. `--apply` giữ nguyên từng byte của thư mục làm việc sản phẩm; sản phẩm chưa có commit hoặc `.claude/` đang có thay đổi chưa commit → từ chối, không tạo worktree (Task 6).
8. Git trên Windows với `core.autocrlf=true` checkout file thành CRLF; hash phải bỏ qua khác biệt CRLF/LF, nếu không mọi file sẽ bị coi là "đã sửa" trong worktree (Task 1, kiểm chứng ở Task 5–6).
9. Lỗi giữa chừng khi tạo repo không để lại thư mục dở dang; tên kết thúc bằng `-sync` bị từ chối vì trùng tên worktree (Task 3).
10. File `.harness-version` có khoá trỏ ra ngoài thư mục sản phẩm (`../`) → từ chối, không xoá hay ghi file nào (Task 5).
11. Nhánh sync còn sót từ lần trước → thông báo rõ cách xử lý, không phải lỗi git thô (Task 6).

---

## File Structure

```
harness.manifest.json                    # harnessVersion + phần nào của harness được phân phối (Task 2)
CHANGELOG.md                             # mục cho mỗi harnessVersion (Task 2)
product-template/                        # khung phần "thuộc sản phẩm" (Task 2)
  CLAUDE.md.tmpl   gitignore.tmpl
  docs/gates.json  docs/run-log.md
  .claude/settings.json
scripts/lib/testutil.js                  # helper test dùng chung (Task 1)
scripts/lib/fsutil.js                    # walk, sha256, readManifest, listManaged, copyFile (Task 1)
scripts/lib/version.js                   # semver + đọc CHANGELOG (Task 2)
scripts/lib/git.js                       # gitOut, harnessState (Task 3)
scripts/lib/registry.js                  # đọc/ghi .harness/products.json (Task 3)
scripts/lib/create-product.js            # createProduct() (Task 3)
scripts/lib/sync.js                      # planSync, applySync, hasChanges, formatPlan, createSyncWorktree (Task 5)
scripts/new-product.js                   # CLI (Task 4)
scripts/sync-harness.js                  # CLI (Task 6)
scripts/lib.test.js  scripts/new-product.test.js  scripts/sync-harness.test.js
scripts/check-harness.js (sửa) + check-harness.test.js (sửa)   # Task 7
.gitignore, package.json, README.md, CLAUDE.md, spec (sửa)     # Task 8
```

---

### Task 1: Nền tảng — helper file và danh sách file managed

**Files:**
- Create: `scripts/lib/testutil.js`, `scripts/lib/fsutil.js`, `scripts/lib.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces (fsutil): `sha256(file): string`, `walk(dir): string[]` (đường dẫn tuyệt đối), `toPosix(p): string`, `readManifest(root): object`, `listManaged(root): string[]` (đường dẫn tương đối posix, đã sort, đã bỏ file `exclude`), `copyFile(srcRoot, dstRoot, rel): void`.
- Produces (testutil): `makeChecker(): { check(name, cond), done(label) }`, `mkTmp(prefix): string`, `write(file, text): void`, `rm(dir): void`, `makeFakeHarness(root): void` (manifest `harnessVersion: "1.0.0"`, `CHANGELOG.md` với mục `1.0.0`, template có hai luật deny `Bash(gh pr merge *)` và `Bash(git push -f *)`).

- [ ] **Step 1: Commit spec và plan trước**

```bash
rtk git add docs/superpowers/specs/2026-10-06-idea-to-pr-workflows-design.md docs/superpowers/plans/2026-10-06-phase0-product-bootstrap.md
rtk git commit -m "docs: add idea-to-PR workflows spec and Phase 0 plan" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Viết helper test**

Create `scripts/lib/testutil.js`:

```js
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

module.exports = { makeChecker, mkTmp, write, rm, makeFakeHarness };
```

- [ ] **Step 3: Viết test thất bại**

Create `scripts/lib.test.js`:

```js
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
```

- [ ] **Step 4: Chạy để thấy thất bại**

Run: `node scripts/lib.test.js`
Expected: FAIL — `Error: Cannot find module './lib/fsutil'`

- [ ] **Step 5: Viết `fsutil.js`**

Create `scripts/lib/fsutil.js`:

```js
// fsutil.js — file helpers shared by new-product.js and sync-harness.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const toPosix = (p) => p.split(path.sep).join('/');

// Hash of the file content with CRLF folded to LF. Git on Windows with
// core.autocrlf=true checks files out as CRLF; without this every managed file
// would look "edited by the product" inside a freshly checked-out worktree.
// latin1 round-trips arbitrary bytes, so nothing else is altered.
function sha256(file) {
  const normalized = Buffer.from(fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'harness.manifest.json'), 'utf8'));
}

// Every file the harness distributes: manifest `managed` entries (files or
// directories) minus `exclude`. Returns sorted posix-style relative paths.
function listManaged(root) {
  const manifest = readManifest(root);
  const exclude = new Set(manifest.exclude || []);
  const files = new Set();
  for (const entry of manifest.managed) {
    const abs = path.join(root, entry);
    if (!fs.existsSync(abs)) continue; // check-harness reports missing entries
    const list = fs.statSync(abs).isDirectory() ? walk(abs) : [abs];
    for (const f of list) {
      const rel = toPosix(path.relative(root, f));
      if (!exclude.has(rel)) files.add(rel);
    }
  }
  return [...files].sort();
}

function copyFile(srcRoot, dstRoot, rel) {
  const dst = path.join(dstRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(srcRoot, rel), dst);
}

module.exports = { sha256, walk, toPosix, readManifest, listManaged, copyFile };
```

- [ ] **Step 6: Chạy để thấy thành công**

Run: `node scripts/lib.test.js`
Expected: `PASS (lib)`

- [ ] **Step 7: Nối vào `npm test`**

Edit `package.json` — thay dòng `"test"`:

```json
    "test": "node scripts/check-harness.test.js && node scripts/lib.test.js",
```

Run: `npm test`
Expected: hai dòng `PASS (test suite)` và `PASS (lib)`.

- [ ] **Step 8: Commit**

```bash
rtk git add scripts/lib/testutil.js scripts/lib/fsutil.js scripts/lib.test.js package.json
rtk git commit -m "feat: add fs helpers and managed-file listing for product bootstrap" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Manifest thật, phiên bản, CHANGELOG và khung `product-template/`

**Files:**
- Create: `harness.manifest.json`, `CHANGELOG.md`, `scripts/lib/version.js`, `product-template/CLAUDE.md.tmpl`, `product-template/gitignore.tmpl`, `product-template/docs/gates.json`, `product-template/docs/run-log.md`, `product-template/.claude/settings.json`
- Modify: `scripts/lib.test.js`
- Stage thêm: `.claude/workflows/product-brainstorm.js` (đang untracked; manifest sẽ phân phối nó)

**Interfaces:**
- Consumes: `listManaged`, `readManifest` (Task 1).
- Produces (`version.js`): `parse(v): [major, minor, patch]` (ném `invalid version "<v>": expected MAJOR.MINOR.PATCH`), `major(v): number`, `compare(a, b): -1|0|1`, `changelogBetween(text, from, to): Array<{version, body}>` (các mục có `from < version <= to`, sắp tăng dần), `hasChangelogEntry(text, version): boolean`. Mục changelog là các đoạn bắt đầu bằng `## <semver>`.
- Produces: template mà `createProduct` (Task 3) copy sang sản phẩm. Quy ước: file `*.tmpl` được render (`{{NAME}}` → tên sản phẩm) và bỏ đuôi `.tmpl`; riêng `gitignore.tmpl` thành `.gitignore`.

- [ ] **Step 1: Thêm test thất bại**

Thêm vào đầu `scripts/lib.test.js` (cạnh các `require` khác):

```js
const { major, compare, changelogBetween, hasChangelogEntry } = require('./lib/version');
```

Chèn ngay trước dòng `rm(root);`:

```js
// --- version helpers ---
check('major parses', major('2.3.4') === 2);
check('compare orders numerically', compare('1.2.0', '1.10.0') === -1 && compare('2.0.0', '1.9.9') === 1 && compare('1.0.0', '1.0.0') === 0);
let verr = '';
try { major('1.0'); } catch (e) { verr = e.message; }
check('rejects a malformed version', /invalid version/.test(verr));
const log = '# Changelog\n\n## 1.2.0\n- minor\n\n## 1.1.0\n- added quality check\n\n## 1.0.0\n- initial\n';
const between = changelogBetween(log, '1.0.0', '1.2.0');
check('changelogBetween returns (from, to] ascending', between.map((e) => e.version).join() === '1.1.0,1.2.0');
check('changelogBetween keeps the body', /quality check/.test(between[0].body));
check('changelogBetween is empty when from == to', changelogBetween(log, '1.2.0', '1.2.0').length === 0);
check('hasChangelogEntry finds only real entries', hasChangelogEntry(log, '1.1.0') && !hasChangelogEntry(log, '1.3.0'));

// --- real manifest + template ---
const repo = path.resolve(__dirname, '..');
const real = listManaged(repo);
check('real manifest includes explore command', real.includes('.claude/commands/explore.md'));
check('real manifest includes reviewer agent', real.includes('.claude/agents/reviewer.md'));
check('real manifest includes harness skill', real.includes('.claude/skills/harness/SKILL.md'));
check('real manifest includes product-brainstorm workflow', real.includes('.claude/workflows/product-brainstorm.js'));
check('real manifest excludes interview-prep workflow', !real.includes('.claude/workflows/study-research.js'));
check('real manifest excludes deep-dive command', !real.includes('.claude/commands/deep-dive.md'));
check('real manifest never lists settings.local.json', !real.some((f) => f.includes('settings.local')));
const realManifest = JSON.parse(fs.readFileSync(path.join(repo, 'harness.manifest.json'), 'utf8'));
check('real manifest has harnessVersion 1.0.0', realManifest.harnessVersion === '1.0.0');
check('real CHANGELOG has an entry for the manifest version',
  hasChangelogEntry(fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'), realManifest.harnessVersion));
for (const t of ['CLAUDE.md.tmpl', 'gitignore.tmpl', 'docs/gates.json', 'docs/run-log.md', '.claude/settings.json']) {
  check(`template has ${t}`, fs.existsSync(path.join(repo, 'product-template', t)));
}
const gates = JSON.parse(fs.readFileSync(path.join(repo, 'product-template/docs/gates.json'), 'utf8'));
check('template gates.json lists G0..G3b as null',
  ['G0', 'G1', 'G2', 'G3a', 'G3b'].every((g) => g in gates && gates[g] === null));
const deny = JSON.parse(fs.readFileSync(path.join(repo, 'product-template/.claude/settings.json'), 'utf8')).permissions.deny;
check('template denies gh pr merge', deny.includes('Bash(gh pr merge *)'));
check('template denies push to main', deny.includes('Bash(git push origin main *)'));
check('template denies force push', deny.includes('Bash(git push --force *)'));
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `node scripts/lib.test.js`
Expected: FAIL — `Cannot find module './lib/version'`

- [ ] **Step 3: Viết `version.js`**

Create `scripts/lib/version.js`:

```js
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
```

- [ ] **Step 4: Tạo manifest và CHANGELOG**

Create `harness.manifest.json`:

```json
{
  "harnessVersion": "1.0.0",
  "managed": [
    ".claude/commands",
    ".claude/agents",
    ".claude/skills/harness",
    ".claude/workflows"
  ],
  "exclude": [
    ".claude/commands/deep-dive.md",
    ".claude/workflows/study-research.js"
  ]
}
```

Create `CHANGELOG.md`:

```markdown
# Changelog

Every released `harnessVersion` needs an entry below. Classify each change:

- patch: bug fix or wording tweak, no behaviour change
- minor: additive and backward compatible (optional stage or command, report-only checks)
- major: breaks a product that is mid-pipeline (changes the shape of a state file,
  renames a command, needs new settings/env/Claude Code version, changes the
  execution model). Sync refuses major jumps.

## 1.0.0
- Initial product bootstrap: `new-product.js`, `sync-harness.js`, `product-template/`, `/product-brainstorm`.
```

- [ ] **Step 5: Tạo template**

Create `product-template/CLAUDE.md.tmpl`:

```markdown
# {{NAME}} — Operating Model

Bootstrapped from claude-harness. The workflow definitions in `.claude/`
(commands, workflows, the reviewer agent, the harness skill) are **managed by
the harness**: change them in claude-harness, then pull them in with

    node <path-to-claude-harness>/scripts/sync-harness.js <this-repo> --apply

A sync never touches this working directory. It writes to a separate worktree
(`<this-repo>-sync`) on a `chore/harness-sync-v<version>` branch; review it,
commit, open a PR, and **merge it only between two stages**, never in the
middle of one. Local edits to a managed file are kept but are reported as
conflicts. `.claude/settings.json` and everything under `docs/` belong to this
product and are never written by a sync. A major harness version is never
synced; this repo stays on its current line until you migrate it on purpose.

## Pipeline
brainstorm → spec → architect → spike → backlog → foundation → features → verify → beta

Available now: `/product-brainstorm`. The other stages arrive through
`sync-harness` as the harness ships them.

## Human gates
- G0 — direction chosen, user validation recorded in `docs/validation.md`
- G1 — spec and UI design approved
- G2 — design, spike results and backlog approved
- G3a / G3b — you merge every PR yourself

Gate state lives in `docs/gates.json` (`null` = not approved).

## Rules
- Agents never merge PRs and never push to `main` (denied in `.claude/settings.json`).
- One PR per Task. Never two unmerged PRs touching the same file.
- Independent review runs in the `reviewer` subagent; fix-loop is capped at 5.
- Decisions need a reason and the trade-off accepted (an ADR in `docs/adr/`).

## Source-of-truth files
- `docs/spec.md` — scope, Epics, Stories, acceptance criteria, NFRs
- `docs/design.md` and `docs/adr/` — architecture decisions
- `docs/backlog.md` — Tasks, dependencies, waves
- `docs/run-log.md` — evidence for each run
```

Create `product-template/gitignore.tmpl`:

```
node_modules/
.DS_Store
Thumbs.db
*.log
.idea/
.vscode/
# personal Claude Code settings must never be committed
.claude/settings.local.json
```

Create `product-template/docs/gates.json`:

```json
{
  "G0": null,
  "G1": null,
  "G2": null,
  "G3a": null,
  "G3b": null
}
```

Create `product-template/docs/run-log.md`:

```markdown
# Run log

Appended evidence for each workflow run.
```

Create `product-template/.claude/settings.json`:

```json
{
  "permissions": {
    "deny": [
      "Bash(gh pr merge)",
      "Bash(gh pr merge *)",
      "Bash(git push origin main)",
      "Bash(git push origin main *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)"
    ]
  }
}
```

- [ ] **Step 6: Chạy để thấy thành công**

Run: `node scripts/lib.test.js`
Expected: `PASS (lib)`

- [ ] **Step 7: Commit**

```bash
rtk git add harness.manifest.json CHANGELOG.md product-template scripts/lib/version.js scripts/lib.test.js .claude/workflows/product-brainstorm.js
rtk git commit -m "feat: add harness manifest, versioning, changelog and product template" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `createProduct()` — tạo repo sản phẩm

**Files:**
- Create: `scripts/lib/git.js`, `scripts/lib/registry.js`, `scripts/lib/create-product.js`, `scripts/new-product.test.js`
- Modify: `scripts/lib.test.js`, `package.json`

**Interfaces:**
- Consumes: `listManaged`, `readManifest`, `copyFile`, `sha256`, `walk`, `toPosix` (Task 1); template (Task 2).
- Produces:
  - `git.js`: `gitOut(args: string[], cwd: string): string | null`, `harnessState(harnessRoot): { commit: string, dirty: boolean }` (`commit` là `'unknown'` khi harness không phải repo git).
  - `registry.js`: `readRegistry(harnessRoot): Array<{name, path}>` (ném lỗi chứa chuỗi `not valid JSON` khi file hỏng), `registerProduct(harnessRoot, { name, path }): void` (thay thế mục cùng `path`).
  - `create-product.js`: `createProduct({ harnessRoot, name, parentDir, seed?, register? = true }): { target: string }`; ném `Error` với thông điệp chứa `invalid name`, `not empty`, `seed file not found`, hoặc `harnessVersion`.
  - File `.claude/.harness-version` trong sản phẩm: `{ harnessVersion, harnessCommit, harnessDirty, syncedAt, files: { [relPosix]: sha256 } }`.

- [ ] **Step 1: Viết test thất bại**

Create `scripts/new-product.test.js`:

```js
// new-product.test.js — createProduct() acceptance checks (spec 5.0).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeChecker, mkTmp, write, rm, makeFakeHarness } = require('./lib/testutil');
const { createProduct } = require('./lib/create-product');
const { readRegistry } = require('./lib/registry');
const { check, done } = makeChecker();

const REPO = path.resolve(__dirname, '..');
function throws(fn) { try { fn(); return ''; } catch (e) { return e.message; } }
function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

const harness = mkTmp('np-h-');
makeFakeHarness(harness);
const parent = mkTmp('np-p-');
const seed = path.join(parent, 'brief.md');
write(seed, '# brief\n');

// --- happy path ---
const { target } = createProduct({ harnessRoot: harness, name: 'ridgo', parentDir: parent, seed });
const rd = (rel) => fs.readFileSync(path.join(target, rel), 'utf8');
const has = (rel) => fs.existsSync(path.join(target, rel));

check('target is <parent>/<name>', target === path.join(parent, 'ridgo'));
check('copies managed command', rd('.claude/commands/a.md') === 'a v1\n');
check('copies managed workflow', rd('.claude/workflows/w.js') === 'w v1\n');
check('renders {{NAME}} in CLAUDE.md', rd('CLAUDE.md') === '# ridgo\n');
check('gitignore.tmpl becomes .gitignore', rd('.gitignore') === 'node_modules/\n');
check('copies docs skeleton', has('docs/gates.json'));
check('creates docs dirs with .gitkeep', has('docs/adr/.gitkeep') && has('docs/ux/.gitkeep') && has('docs/brainstorm/.gitkeep'));
check('copies product settings with deny rule', /gh pr merge/.test(rd('.claude/settings.json')));
check('seeds the brief', rd('docs/brainstorm/brief.md') === '# brief\n');
check('git init ran', has('.git'));
check('no commit was made', (() => { try { git(['rev-parse', 'HEAD'], target); return false; } catch (e) { return true; } })());
check('no remote was created', git(['remote'], target).trim() === '');

const v = JSON.parse(rd('.claude/.harness-version'));
check('version file records managed hashes only',
  Object.keys(v.files).sort().join() === '.claude/commands/a.md,.claude/workflows/w.js');
check('version file records the harness version', v.harnessVersion === '1.0.0');
check('version file records commit "unknown" outside git', v.harnessCommit === 'unknown' && v.harnessDirty === false);
check('registers the product in the harness registry',
  readRegistry(harness).some((p) => p.name === 'ridgo' && p.path === target));

// --- Review Focus 3: personal / excluded files never copied ---
check('does not copy settings.local.json', !has('.claude/settings.local.json'));
check('does not copy manifest-excluded command', !has('.claude/commands/skip.md'));
check('does not copy the harness registry dir', !has('.harness'));
check('does not copy the manifest itself', !has('harness.manifest.json'));

// --- Review Focus 1: bad names write nothing ---
const before = fs.readdirSync(parent).sort().join();
for (const bad of ['Ridgo', 'my app', '../escape', 'a', '-x', 'foo-sync']) {
  check(`rejects name "${bad}"`, /invalid name/.test(throws(() => createProduct({ harnessRoot: harness, name: bad, parentDir: parent }))));
}
check('rejected names create nothing inside parent', fs.readdirSync(parent).sort().join() === before);
check('rejected names create nothing outside parent', !fs.existsSync(path.join(parent, '..', 'escape')));

// --- Review Focus 2: non-empty target refused, contents untouched ---
write(path.join(parent, 'busy', 'keep.txt'), 'x');
check('refuses a non-empty target',
  /not empty/.test(throws(() => createProduct({ harnessRoot: harness, name: 'busy', parentDir: parent }))));
check('leaves existing files alone', fs.readFileSync(path.join(parent, 'busy', 'keep.txt'), 'utf8') === 'x');
check('refusal did not copy anything in', !fs.existsSync(path.join(parent, 'busy', 'CLAUDE.md')));

// --- missing seed: error, nothing created ---
check('missing seed is an error',
  /seed file not found/.test(throws(() => createProduct({ harnessRoot: harness, name: 'noseed', parentDir: parent, seed: path.join(parent, 'nope.md') }))));
check('missing seed creates nothing', !fs.existsSync(path.join(parent, 'noseed')));

// --- a manifest without harnessVersion is refused before anything is written ---
const h5 = mkTmp('np-h5-');
makeFakeHarness(h5);
const m5 = JSON.parse(fs.readFileSync(path.join(h5, 'harness.manifest.json'), 'utf8'));
delete m5.harnessVersion;
write(path.join(h5, 'harness.manifest.json'), JSON.stringify(m5));
check('refuses a manifest without harnessVersion',
  /harnessVersion/.test(throws(() => createProduct({ harnessRoot: h5, name: 'nover', parentDir: parent, register: false }))));
check('and creates nothing', !fs.existsSync(path.join(parent, 'nover')));
rm(h5);

// --- a failure halfway leaves no half-built directory behind ---
const h6 = mkTmp('np-h6-');
makeFakeHarness(h6);
rm(path.join(h6, 'product-template')); // copying the template will throw
check('a failure halfway is reported', throws(() => createProduct({ harnessRoot: h6, name: 'broken', parentDir: parent, register: false })) !== '');
check('and no half-built directory is left behind', !fs.existsSync(path.join(parent, 'broken')));
rm(h6);

// --- real harness smoke test (register:false keeps the real registry clean) ---
const smoke = createProduct({ harnessRoot: REPO, name: 'smoke', parentDir: parent, register: false });
const sx = (rel) => fs.existsSync(path.join(smoke.target, rel));
check('real: pipeline command copied', sx('.claude/commands/explore.md'));
check('real: reviewer agent copied', sx('.claude/agents/reviewer.md'));
check('real: personal settings not copied', !sx('.claude/settings.local.json'));
check('real: interview-prep workflow not copied', !sx('.claude/workflows/study-research.js'));
check('real: deep-dive skill not copied', !sx('.claude/skills/deep-dive'));
check('real: version file carries the real harnessVersion',
  JSON.parse(fs.readFileSync(path.join(smoke.target, '.claude/.harness-version'), 'utf8')).harnessVersion === '1.0.0');
check('real: registry untouched when register:false', !readRegistry(REPO).some((p) => p.name === 'smoke'));

rm(harness);
rm(parent);
done('new-product');
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `node scripts/new-product.test.js`
Expected: FAIL — `Cannot find module './lib/create-product'`

- [ ] **Step 3: Viết `git.js`**

Create `scripts/lib/git.js`:

```js
// git.js — thin wrappers around the git CLI.
const { execFileSync } = require('child_process');

// stdout of a git command, trimmed; null if git fails (not a repo, no git...).
function gitOut(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

function harnessState(harnessRoot) {
  const commit = gitOut(['rev-parse', 'HEAD'], harnessRoot);
  if (!commit) return { commit: 'unknown', dirty: false };
  return { commit, dirty: gitOut(['status', '--porcelain'], harnessRoot) !== '' };
}

module.exports = { gitOut, harnessState };
```

- [ ] **Step 4: Viết `registry.js`**

Create `scripts/lib/registry.js`:

```js
// registry.js — local list of product repos created from this harness.
// Lives in <harness>/.harness/products.json (gitignored: holds machine paths).
const fs = require('fs');
const path = require('path');

function registryFile(harnessRoot) {
  return path.join(harnessRoot, '.harness', 'products.json');
}

function readRegistry(harnessRoot) {
  const f = registryFile(harnessRoot);
  if (!fs.existsSync(f)) return [];
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`registry is not valid JSON: ${f} (${e.message})`);
  }
}

function registerProduct(harnessRoot, entry) {
  const list = readRegistry(harnessRoot).filter((p) => p.path !== entry.path);
  list.push(entry);
  fs.mkdirSync(path.dirname(registryFile(harnessRoot)), { recursive: true });
  fs.writeFileSync(registryFile(harnessRoot), JSON.stringify(list, null, 2) + '\n');
}

module.exports = { readRegistry, registerProduct };
```

- [ ] **Step 5: Viết `create-product.js`**

Create `scripts/lib/create-product.js`:

```js
// create-product.js — bootstrap a product repo from claude-harness (spec 5.0).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { listManaged, readManifest, copyFile, sha256, walk, toPosix } = require('./fsutil');
const { harnessState } = require('./git');
const { registerProduct } = require('./registry');

const NAME_RE = /^[a-z][a-z0-9-]{1,39}$/;

function copyTemplate(templateRoot, target, name) {
  for (const f of walk(templateRoot)) {
    let rel = toPosix(path.relative(templateRoot, f));
    const rendered = rel.endsWith('.tmpl');
    if (rendered) rel = rel.slice(0, -'.tmpl'.length);
    if (path.posix.basename(rel) === 'gitignore') rel = path.posix.join(path.posix.dirname(rel), '.gitignore');
    const out = path.join(target, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (rendered) fs.writeFileSync(out, fs.readFileSync(f, 'utf8').split('{{NAME}}').join(name));
    else fs.copyFileSync(f, out);
  }
}

function buildProduct({ harnessRoot, name, parentDir, seed, register = true }) {
  // Validate everything BEFORE touching the disk.
  if (!NAME_RE.test(name)) {
    throw new Error(`invalid name "${name}": use lowercase letters, digits and dashes, 2-40 chars, starting with a letter`);
  }
  if (name.endsWith('-sync')) {
    throw new Error(`invalid name "${name}": the suffix -sync is reserved for sync worktrees`);
  }
  const target = path.join(parentDir, name);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`target exists and is not empty: ${target}`);
  }
  if (seed && !fs.existsSync(seed)) throw new Error(`seed file not found: ${seed}`);
  const harnessVersion = readManifest(harnessRoot).harnessVersion;
  if (!harnessVersion) throw new Error('harness.manifest.json has no harnessVersion');

  fs.mkdirSync(target, { recursive: true });

  const files = {};
  for (const rel of listManaged(harnessRoot)) {
    copyFile(harnessRoot, target, rel);
    files[rel] = sha256(path.join(target, rel));
  }

  copyTemplate(path.join(harnessRoot, 'product-template'), target, name);
  for (const d of ['docs/brainstorm', 'docs/ux', 'docs/adr']) {
    fs.mkdirSync(path.join(target, d), { recursive: true });
    fs.writeFileSync(path.join(target, d, '.gitkeep'), '');
  }
  if (seed) fs.copyFileSync(seed, path.join(target, 'docs', 'brainstorm', path.basename(seed)));

  const state = harnessState(harnessRoot);
  fs.writeFileSync(path.join(target, '.claude', '.harness-version'), JSON.stringify({
    harnessVersion,
    harnessCommit: state.commit,
    harnessDirty: state.dirty,
    syncedAt: new Date().toISOString(),
    files,
  }, null, 2) + '\n');

  execFileSync('git', ['init', '-b', 'main'], { cwd: target, stdio: 'ignore' });
  if (register) registerProduct(harnessRoot, { name, path: target });
  return { target };
}

// If anything fails halfway, do not leave a half-built directory behind.
// Only clean up when the name was valid and the directory did not exist before,
// so a bad name such as "../x" can never make us delete somebody else's folder.
function createProduct(opts) {
  const target = path.join(opts.parentDir, opts.name);
  const existed = fs.existsSync(target);
  try {
    return buildProduct(opts);
  } catch (e) {
    if (!existed && NAME_RE.test(opts.name) && fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    throw e;
  }
}

module.exports = { createProduct, NAME_RE };
```

- [ ] **Step 6: Thêm test cho `registry` và `harnessState` vào `lib.test.js`**

Thêm vào đầu `scripts/lib.test.js` (cạnh các `require` khác):

```js
const { harnessState } = require('./lib/git');
const { readRegistry, registerProduct } = require('./lib/registry');
```

Chèn ngay trước dòng `rm(root);`:

```js
// --- git state + registry ---
check('harnessState outside git is unknown', harnessState(root).commit === 'unknown' && harnessState(root).dirty === false);
check('empty registry reads as []', JSON.stringify(readRegistry(root)) === '[]');
registerProduct(root, { name: 'p1', path: '/x/p1' });
registerProduct(root, { name: 'p1-renamed', path: '/x/p1' });
registerProduct(root, { name: 'p2', path: '/x/p2' });
check('registerProduct replaces the entry with the same path',
  readRegistry(root).map((p) => p.name).join() === 'p1-renamed,p2');
write(path.join(root, '.harness/products.json'), 'not json');
let regErr = '';
try { readRegistry(root); } catch (e) { regErr = e.message; }
check('corrupt registry gives a clear error', /not valid JSON/.test(regErr) && /products\.json/.test(regErr));
```

- [ ] **Step 7: Chạy để thấy thành công**

Run: `node scripts/lib.test.js && node scripts/new-product.test.js`
Expected: `PASS (lib)` rồi `PASS (new-product)`

- [ ] **Step 8: Nối vào `npm test`**

Edit `package.json`:

```json
    "test": "node scripts/check-harness.test.js && node scripts/lib.test.js && node scripts/new-product.test.js",
```

Run: `npm test`
Expected: ba dòng PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add scripts/lib/git.js scripts/lib/registry.js scripts/lib/create-product.js scripts/new-product.test.js scripts/lib.test.js package.json
rtk git commit -m "feat: add createProduct to bootstrap product repos from the harness" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CLI `new-product.js`

**Files:**
- Create: `scripts/new-product.js`
- Modify: `scripts/new-product.test.js`, `package.json`

**Interfaces:**
- Consumes: `createProduct` (Task 3).
- Produces: lệnh `node scripts/new-product.js <name> [--dir <parent>] [--seed <file>] [--harness-root <dir>]`. Thoát 0 khi tạo xong (in `created <path>`), thoát 1 kèm `new-product failed: <lý do>` khi lỗi hoặc thiếu tên. `--harness-root` chỉ dùng cho test.

- [ ] **Step 1: Thêm test thất bại**

Trong `scripts/new-product.test.js`, chèn ngay trước dòng `rm(harness);`:

```js
// --- CLI ---
const CLI = path.join(__dirname, 'new-product.js');
function runCli(args) {
  try { return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
const ok = runCli(['cli-demo', '--dir', parent, '--harness-root', harness]);
check('CLI creates the product and exits 0', ok.code === 0 && fs.existsSync(path.join(parent, 'cli-demo', 'CLAUDE.md')));
check('CLI prints the created path', ok.out.includes(path.join(parent, 'cli-demo')));
check('CLI says no remote was created', /no remote/i.test(ok.out));
check('CLI registers into the harness it was given', readRegistry(harness).some((p) => p.name === 'cli-demo'));
const bad = runCli(['Bad Name', '--dir', parent, '--harness-root', harness]);
check('CLI exits 1 on an invalid name', bad.code === 1 && /new-product failed: invalid name/.test(bad.out));
const none = runCli(['--dir', parent, '--harness-root', harness]);
check('CLI exits 1 and prints usage without a name', none.code === 1 && /usage/i.test(none.out));
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `node scripts/new-product.test.js`
Expected: FAIL — `CLI creates the product and exits 0` (file `new-product.js` chưa tồn tại).

- [ ] **Step 3: Viết CLI**

Create `scripts/new-product.js`:

```js
#!/usr/bin/env node
// new-product.js — bootstrap a product repo from claude-harness.
// Usage: node scripts/new-product.js <name> [--dir <parent>] [--seed <file>]
// Creates <parent>/<name> (default parent: the folder that contains this harness),
// copies the managed workflows, runs `git init`. Never commits, never creates a remote.
const path = require('path');
const { createProduct } = require('./lib/create-product');

function opt(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function main() {
  const name = process.argv[2];
  if (!name || name.startsWith('--')) {
    console.error('usage: new-product.js <name> [--dir <parent>] [--seed <file>]');
    process.exit(1);
  }
  const harnessRoot = path.resolve(opt('--harness-root') || path.join(__dirname, '..'));
  const parentDir = path.resolve(opt('--dir') || path.dirname(harnessRoot));
  const seed = opt('--seed') ? path.resolve(opt('--seed')) : undefined;
  try {
    const { target } = createProduct({ harnessRoot, name, parentDir, seed });
    console.log(`created ${target}`);
    console.log('next: open it in Claude Code, review, and make the first commit yourself.');
    console.log('no remote was created and nothing was committed.');
  } catch (e) {
    console.error(`new-product failed: ${e.message}`);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 4: Chạy để thấy thành công**

Run: `node scripts/new-product.test.js`
Expected: `PASS (new-product)`

- [ ] **Step 5: Thêm script npm**

Edit `package.json` — thêm vào `scripts`:

```json
    "new-product": "node scripts/new-product.js",
```

- [ ] **Step 6: Commit**

```bash
rtk git add scripts/new-product.js scripts/new-product.test.js package.json
rtk git commit -m "feat: add new-product CLI" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Lõi sync — `planSync`, `applySync`, worktree cô lập

**Files:**
- Create: `scripts/lib/sync.js`, `scripts/sync-harness.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `listManaged`, `readManifest`, `copyFile`, `sha256` (Task 1); `major` (Task 2); `harnessState`, `gitOut` (Task 3).
- Produces (`sync.js`):
  - `class MajorVersionError extends Error` — ném bởi `planSync` khi số major của `harnessVersion` khác nhau (cả hai chiều); thông điệp bắt đầu bằng `major upgrade, not applied:` và chứa cả hai phiên bản.
  - `planSync(harnessRoot, productRoot): { add, update, remove, conflict, kept, current, refresh, versionFrom, versionTo, settingsMissing }` — sáu mảng đầu và `refresh` là đường dẫn tương đối posix; `settingsMissing` là danh sách luật deny của template mà `settings.json` sản phẩm còn thiếu. Ném lỗi chứa `.harness-version` nếu thư mục không phải repo sản phẩm. **Không ghi gì lên đĩa.**
  - `hasChanges(plan): boolean` — true nếu có add/update/remove/refresh hoặc `versionFrom !== versionTo`.
  - `applySync(harnessRoot, productRoot, plan): void` — thực hiện add/update/remove, cập nhật `.claude/.harness-version` (conflict/kept giữ nguyên hash cũ; `harnessVersion` = `plan.versionTo`).
  - `formatPlan(name, plan): string` (chỉ ASCII).
  - `createSyncWorktree(productRoot, version): { dir, branch, reused }` — tạo worktree `<parent>/<name>-sync` trên nhánh `chore/harness-sync-v<version>`; ném lỗi nếu `.claude/` có thay đổi chưa commit (`uncommitted changes under .claude/`), nếu chưa có commit nào (`no commits yet`), hoặc nếu thư mục đã tồn tại trên nhánh khác.
- Quy tắc phân loại cho mỗi file `rel` trong danh sách managed của harness (`src` = hash harness, `dst` = hash trong sản phẩm hoặc `null` nếu thiếu, `rec` = hash ghi trong version file):
  1. `dst === src` → `current` (và vào `refresh` nếu `rec !== dst`).
  2. `rec === src` (harness không đổi từ lần sync trước, sản phẩm tự khác) → `kept`.
  3. `dst === null` → `rec` có thì `conflict` (sản phẩm đã xoá), không thì `add`.
  4. `rec` có và `dst === rec` (sản phẩm không đụng) → `update`; ngược lại → `conflict`.
  - File có trong `rec` nhưng harness không còn quản lý: `dst === rec` → `remove`; sản phẩm đã sửa → `conflict`; đã bị xoá → bỏ qua.

- [ ] **Step 1: Viết test thất bại**

Create `scripts/sync-harness.test.js`:

```js
// sync-harness.test.js — sync planning/apply checks (spec 5.0, Review Focus 4, 6 and 7).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeChecker, mkTmp, write, rm, makeFakeHarness } = require('./lib/testutil');
const { createProduct } = require('./lib/create-product');
const { planSync, applySync, hasChanges, formatPlan, MajorVersionError } = require('./lib/sync');
const { check, done } = makeChecker();

function throws(fn) { try { fn(); return ''; } catch (e) { return e.message; } }

const harness = mkTmp('sy-h-');
makeFakeHarness(harness);
write(path.join(harness, '.claude/commands/old.md'), 'old\n');
write(path.join(harness, '.claude/commands/kept.md'), 'kept v1\n');
const parent = mkTmp('sy-p-');
const { target } = createProduct({ harnessRoot: harness, name: 'demo', parentDir: parent, register: false });
const prod = (rel) => path.join(target, rel);
const read = (rel) => fs.readFileSync(prod(rel), 'utf8');

// the harness evolves...
write(path.join(harness, '.claude/commands/a.md'), 'a v2\n');       // product untouched      -> update
write(path.join(harness, '.claude/workflows/w.js'), 'w v2\n');      // product edited too     -> conflict
write(path.join(harness, '.claude/commands/b.md'), 'b v1\n');       // brand new              -> add
fs.rmSync(path.join(harness, '.claude/commands/old.md'));           // dropped, untouched     -> remove
// ...and the product diverges
write(prod('.claude/workflows/w.js'), 'w mine\n');
write(prod('.claude/commands/kept.md'), 'kept mine\n');             // harness unchanged      -> kept

const plan = planSync(harness, target);
check('update for an untouched file', plan.update.join() === '.claude/commands/a.md');
check('add for a new harness file', plan.add.join() === '.claude/commands/b.md');
check('remove for a file the harness dropped', plan.remove.join() === '.claude/commands/old.md');
check('conflict for a file both sides changed', plan.conflict.join() === '.claude/workflows/w.js');
check('kept for a local edit when the harness did not change', plan.kept.join() === '.claude/commands/kept.md');
check('planSync alone writes nothing', read('.claude/commands/a.md') === 'a v1\n' && fs.existsSync(prod('.claude/commands/old.md')));
check('plan carries both versions', plan.versionFrom === '1.0.0' && plan.versionTo === '1.0.0');
check('hasChanges is true when files would change', hasChanges(plan));

const text = formatPlan('demo', plan);
check('formatPlan names the product and counts', /^demo \(1\.0\.0\): 1 add, 1 update, 1 remove, 1 conflict, 1 kept/.test(text));
check('formatPlan flags the conflict', /CONFLICT\s+\.claude\/workflows\/w\.js/.test(text));
check('formatPlan announces a new command', /new: \/b - see CHANGELOG/.test(text));

applySync(harness, target, plan);
check('apply performs update', read('.claude/commands/a.md') === 'a v2\n');
check('apply performs add', read('.claude/commands/b.md') === 'b v1\n');
check('apply performs remove', !fs.existsSync(prod('.claude/commands/old.md')));
check('apply never overwrites a conflicted file', read('.claude/workflows/w.js') === 'w mine\n');
check('apply never overwrites a kept file', read('.claude/commands/kept.md') === 'kept mine\n');

const again = planSync(harness, target);
check('second plan has nothing left to apply', again.add.length + again.update.length + again.remove.length === 0 && !hasChanges(again));
check('the conflict is still reported next time', again.conflict.join() === '.claude/workflows/w.js');
check('the kept file stays kept', again.kept.join() === '.claude/commands/kept.md');
check('an up-to-date product prints "up to date"', /up to date/.test(formatPlan('x', planSync(harness, createProduct({ harnessRoot: harness, name: 'fresh', parentDir: parent, register: false }).target))));

// the human resolves the conflict by taking the harness version
write(prod('.claude/workflows/w.js'), 'w v2\n');
const resolved = planSync(harness, target);
check('resolved conflict becomes current', resolved.conflict.length === 0 && resolved.current.includes('.claude/workflows/w.js'));
check('resolved conflict needs its record refreshed', resolved.refresh.includes('.claude/workflows/w.js') && hasChanges(resolved));
applySync(harness, target, resolved);
check('after resolving, a later harness change updates cleanly', (() => {
  write(path.join(harness, '.claude/workflows/w.js'), 'w v3\n');
  return planSync(harness, target).update.join() === '.claude/workflows/w.js';
})());
// put the harness back to what the product has, so later sections do not inherit a pending update
write(path.join(harness, '.claude/workflows/w.js'), 'w v2\n');

// a managed file the product deleted while the harness changed it is a conflict, not a silent re-add
fs.rmSync(prod('.claude/commands/b.md'));
write(path.join(harness, '.claude/commands/b.md'), 'b v2\n');
check('locally deleted + harness changed is a conflict', planSync(harness, target).conflict.includes('.claude/commands/b.md'));

// settings.json is the product's: only report missing deny rules, never write
check('no missing deny rules at first', planSync(harness, target).settingsMissing.length === 0);
const settingsBefore = '{"permissions":{"deny":["Bash(gh pr merge *)"]}}';
write(prod('.claude/settings.json'), settingsBefore);
check('reports a deny rule the product lacks', planSync(harness, target).settingsMissing.join() === 'Bash(git push -f *)');
check('formatPlan prints the missing deny rule', /settings: missing deny rule "Bash\(git push -f \*\)"/.test(formatPlan('demo', planSync(harness, target))));
applySync(harness, target, planSync(harness, target));
check('apply never writes settings.json', read('.claude/settings.json') === settingsBefore);

check('rejects a directory that is not a product repo',
  /\.harness-version/.test(throws(() => planSync(harness, parent))));

// a version file with a key that escapes the product directory is refused
const vf = prod('.claude/.harness-version');
const vOrig = fs.readFileSync(vf, 'utf8');
const vBad = JSON.parse(vOrig);
vBad.files['../evil.txt'] = 'x';
fs.writeFileSync(vf, JSON.stringify(vBad));
check('refuses a version file with an unsafe path', /unsafe path/.test(throws(() => planSync(harness, target))));
fs.writeFileSync(vf, vOrig);

// Review Focus 6: major jump refused (both directions), minor/patch accepted
const manifestPath = path.join(harness, 'harness.manifest.json');
const original = fs.readFileSync(manifestPath, 'utf8');
const m = JSON.parse(original);
m.harnessVersion = '2.0.0';
write(manifestPath, JSON.stringify(m));
let majorErr = null;
try { planSync(harness, target); } catch (e) { majorErr = e; }
check('refuses a major jump', majorErr instanceof MajorVersionError && /^major upgrade, not applied:/.test(majorErr.message));
check('the refusal names both versions', /1\.0\.0/.test(majorErr.message) && /2\.0\.0/.test(majorErr.message));
check('a major refusal writes nothing', read('.claude/workflows/w.js') === 'w v2\n');
m.harnessVersion = '1.4.2';
write(manifestPath, JSON.stringify(m));
const bumped = planSync(harness, target);
check('a minor/patch jump is planned', bumped.versionFrom === '1.0.0' && bumped.versionTo === '1.4.2' && hasChanges(bumped));
check('formatPlan shows the version change', /^demo \(1\.0\.0 -> 1\.4\.2\)/.test(formatPlan('demo', bumped)));
applySync(harness, target, bumped);
check('apply records the new harnessVersion', JSON.parse(read('.claude/.harness-version')).harnessVersion === '1.4.2');
m.harnessVersion = '0.9.0'; // product newer than harness is also a major mismatch
write(manifestPath, JSON.stringify(m));
check('refuses when the product is ahead of the harness', /major upgrade/.test(throws(() => planSync(harness, target))));
write(manifestPath, original);

rm(harness);
rm(parent);
done('sync-core');
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `node scripts/sync-harness.test.js`
Expected: FAIL — `Cannot find module './lib/sync'`

- [ ] **Step 3: Viết `sync.js`**

Create `scripts/lib/sync.js`:

```js
// sync.js — decide and apply harness -> product updates (spec 5.0).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { listManaged, readManifest, copyFile, sha256 } = require('./fsutil');
const { harnessState, gitOut } = require('./git');
const { major } = require('./version');

class MajorVersionError extends Error {}

function versionPath(productRoot) {
  return path.join(productRoot, '.claude', '.harness-version');
}

function readVersion(productRoot) {
  const f = versionPath(productRoot);
  if (!fs.existsSync(f)) {
    throw new Error(`not a harness product (missing .claude/.harness-version): ${productRoot}`);
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

// Deny rules the template ships that the product's settings.json lacks.
// Report only: settings.json belongs to the product and is never written.
function settingsMissing(harnessRoot, productRoot) {
  const deny = (o) => ((o || {}).permissions || {}).deny || [];
  const want = deny(readJson(path.join(harnessRoot, 'product-template', '.claude', 'settings.json')));
  const have = new Set(deny(readJson(path.join(productRoot, '.claude', 'settings.json'))));
  return want.filter((r) => !have.has(r));
}

function planSync(harnessRoot, productRoot) {
  const version = readVersion(productRoot);
  const versionTo = readManifest(harnessRoot).harnessVersion;
  const versionFrom = version.harnessVersion;
  if (!versionFrom) throw new Error(`.harness-version has no harnessVersion: ${productRoot}`);
  if (major(versionFrom) !== major(versionTo)) {
    throw new MajorVersionError(`major upgrade, not applied: product is on ${versionFrom}, harness is ${versionTo}`);
  }

  const recorded = version.files || {};
  for (const rel of Object.keys(recorded)) {
    // a tampered or corrupt version file must never make us touch files outside the product
    if (path.isAbsolute(rel) || rel.split('/').includes('..')) {
      throw new Error(`unsafe path in .harness-version: ${rel}`);
    }
  }
  const wanted = listManaged(harnessRoot);
  const plan = {
    add: [], update: [], remove: [], conflict: [], kept: [], current: [], refresh: [],
    versionFrom, versionTo, settingsMissing: [],
  };

  for (const rel of wanted) {
    const src = sha256(path.join(harnessRoot, rel));
    const dstPath = path.join(productRoot, rel);
    const dst = fs.existsSync(dstPath) ? sha256(dstPath) : null;
    const rec = recorded[rel];

    if (dst === src) {
      plan.current.push(rel);
      if (rec !== dst) plan.refresh.push(rel);             // identical now, but the record is stale
    } else if (rec === src) plan.kept.push(rel);            // harness unchanged; product diverged on purpose
    else if (dst === null) (rec ? plan.conflict : plan.add).push(rel);
    else if (rec && dst === rec) plan.update.push(rel);     // product never touched it
    else plan.conflict.push(rel);                           // product edited it (or created it differently)
  }

  for (const rel of Object.keys(recorded)) {
    if (wanted.includes(rel)) continue;
    const dstPath = path.join(productRoot, rel);
    if (!fs.existsSync(dstPath)) continue;
    (sha256(dstPath) === recorded[rel] ? plan.remove : plan.conflict).push(rel);
  }

  plan.settingsMissing = settingsMissing(harnessRoot, productRoot);
  return plan;
}

function hasChanges(plan) {
  return plan.add.length + plan.update.length + plan.remove.length + plan.refresh.length > 0
    || plan.versionFrom !== plan.versionTo;
}

function applySync(harnessRoot, productRoot, plan) {
  const files = { ...readVersion(productRoot).files };
  for (const rel of [...plan.add, ...plan.update]) {
    copyFile(harnessRoot, productRoot, rel);
    files[rel] = sha256(path.join(productRoot, rel));
  }
  for (const rel of plan.remove) {
    fs.rmSync(path.join(productRoot, rel));
    delete files[rel];
  }
  // identical files: refresh the record so a resolved conflict stops being one
  for (const rel of plan.current) files[rel] = sha256(path.join(productRoot, rel));
  // conflict + kept keep their old recorded hash on purpose

  const state = harnessState(harnessRoot);
  fs.writeFileSync(versionPath(productRoot), JSON.stringify({
    harnessVersion: plan.versionTo,
    harnessCommit: state.commit,
    harnessDirty: state.dirty,
    syncedAt: new Date().toISOString(),
    files,
  }, null, 2) + '\n');
}

function newCommands(plan) {
  return plan.add.flatMap((rel) => {
    const m = /^\.claude\/(?:commands\/([^/]+)\.md|workflows\/([^/]+)\.js)$/.exec(rel);
    return m ? [`/${m[1] || m[2]}`] : [];
  });
}

function formatPlan(name, plan) {
  const head = plan.versionFrom === plan.versionTo
    ? `${name} (${plan.versionTo})`
    : `${name} (${plan.versionFrom} -> ${plan.versionTo})`;
  const counts = ['add', 'update', 'remove', 'conflict', 'kept']
    .filter((k) => plan[k].length)
    .map((k) => `${plan[k].length} ${k}`);
  const lines = [counts.length ? `${head}: ${counts.join(', ')}` : `${head}: up to date`];
  for (const k of ['add', 'update', 'remove']) for (const f of plan[k]) lines.push(`  ${k.padEnd(8)} ${f}`);
  for (const f of plan.conflict) lines.push(`  CONFLICT ${f}  (edited in the product, not overwritten)`);
  for (const f of plan.kept) lines.push(`  kept     ${f}  (local edit, harness unchanged)`);
  for (const c of newCommands(plan)) lines.push(`  new: ${c} - see CHANGELOG`);
  for (const r of plan.settingsMissing) {
    lines.push(`  settings: missing deny rule "${r}" - add it to .claude/settings.json by hand`);
  }
  return lines.join('\n');
}

// Apply happens in a separate worktree so a Claude Code session running in the
// product's own directory never sees files change under it. Never commits.
function createSyncWorktree(productRoot, version) {
  const status = gitOut(['status', '--porcelain', '--', '.claude'], productRoot);
  if (status === null) throw new Error(`not a git repository: ${productRoot}`);
  if (gitOut(['rev-parse', 'HEAD'], productRoot) === null) {
    throw new Error(`product has no commits yet; make the first commit before syncing: ${productRoot}`);
  }
  if (status !== '') {
    throw new Error('product has uncommitted changes under .claude/; commit or stash them before syncing');
  }
  const branch = `chore/harness-sync-v${version}`;
  const dir = path.join(path.dirname(productRoot), `${path.basename(productRoot)}-sync`);
  if (fs.existsSync(dir)) {
    const current = gitOut(['branch', '--show-current'], dir);
    if (current === branch) return { dir, branch, reused: true };
    throw new Error(`${dir} already exists (${current ? `on branch "${current}"` : 'not a git worktree'}); move it away or remove it, then retry`);
  }
  if (gitOut(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], productRoot)) {
    throw new Error(`branch ${branch} already exists from an earlier sync; delete it with: git branch -D ${branch} (or bump harnessVersion) and retry`);
  }
  try {
    execFileSync('git', ['worktree', 'add', '-b', branch, dir], { cwd: productRoot, stdio: 'pipe' });
  } catch (e) {
    throw new Error(`could not create worktree ${dir} on ${branch}: ${String(e.stderr || e.message).trim()}`);
  }
  return { dir, branch, reused: false };
}

module.exports = { MajorVersionError, planSync, hasChanges, applySync, formatPlan, createSyncWorktree };
```

- [ ] **Step 4: Chạy để thấy thành công**

Run: `node scripts/sync-harness.test.js`
Expected: `PASS (sync-core)`

- [ ] **Step 5: Nối vào `npm test`**

Edit `package.json`:

```json
    "test": "node scripts/check-harness.test.js && node scripts/lib.test.js && node scripts/new-product.test.js && node scripts/sync-harness.test.js",
```

Run: `npm test`
Expected: bốn dòng PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add scripts/lib/sync.js scripts/sync-harness.test.js package.json
rtk git commit -m "feat: add sync planning with major-version refusal and isolated worktree" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: CLI `sync-harness.js` — một repo hoặc `--all`

**Files:**
- Create: `scripts/sync-harness.js`
- Modify: `scripts/sync-harness.test.js`, `package.json`

**Interfaces:**
- Consumes: `planSync`, `hasChanges`, `applySync`, `formatPlan`, `createSyncWorktree`, `MajorVersionError` (Task 5); `readRegistry` (Task 3); `changelogBetween` (Task 2).
- Produces: `node scripts/sync-harness.js <product-dir>|--all [--apply] [--in-place] [--harness-root <dir>]`.
  - Mặc định là dry-run: in kế hoạch, các mục CHANGELOG giữa hai phiên bản, rồi dòng `dry run: nothing written. Re-run with --apply to write.`
  - `--apply`: ghi vào worktree `<product>-sync` (xem `createSyncWorktree`), in lệnh xem diff và lệnh dọn `git worktree remove`. `--in-place` (chỉ để thử/khẩn cấp, không khuyến khích) ghi thẳng vào thư mục sản phẩm. Không bao giờ commit hay push.
  - Major mismatch → in `SKIPPED <name>: major upgrade, not applied: ...`, KHÔNG phải lỗi (thoát 0, không ghi gì).
  - `--all`: duyệt `.harness/products.json`; thư mục không còn → `WARN <name>: missing directory <path> (skipped)` và đi tiếp; lỗi ở một repo không chặn repo khác; thoát 1 nếu có lỗi (conflict và SKIPPED không phải lỗi).
  - Tham số đầu tiên (sau tên script) phải là `<product-dir>` hoặc `--all`.

- [ ] **Step 1: Thêm test thất bại**

Trong `scripts/sync-harness.test.js`, chèn ngay trước dòng `rm(harness);`:

```js
// --- CLI: in-place mode, --all, registry (Review Focus 5) ---
const { registerProduct } = require('./lib/registry');
const CLI = path.join(__dirname, 'sync-harness.js');
function run(args) {
  try { return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
function commitAll(dir) {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}
const gitIn = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

const h2 = mkTmp('sy-h2-');
makeFakeHarness(h2);
const p2 = mkTmp('sy-p2-');
const cli = createProduct({ harnessRoot: h2, name: 'cli-demo', parentDir: p2 }).target; // registers in h2
registerProduct(h2, { name: 'ghost', path: path.join(p2, 'ghost') });                    // directory never created
const cliRead = (rel) => fs.readFileSync(path.join(cli, rel), 'utf8');

write(path.join(h2, '.claude/commands/a.md'), 'a v2\n');
write(path.join(h2, '.claude/commands/quality-check.md'), 'qc\n');
const dry = run([cli, '--harness-root', h2]);
check('dry run exits 0 and lists the update', dry.code === 0 && /update\s+\.claude\/commands\/a\.md/.test(dry.out));
check('dry run announces the new command', /new: \/quality-check - see CHANGELOG/.test(dry.out));
check('dry run says nothing was written', /dry run: nothing written/.test(dry.out));
check('dry run leaves the product untouched', cliRead('.claude/commands/a.md') === 'a v1\n');

// a minor release: version bump + changelog is shown to the human
const mp = path.join(h2, 'harness.manifest.json');
const mj = JSON.parse(fs.readFileSync(mp, 'utf8'));
mj.harnessVersion = '1.1.0';
write(mp, JSON.stringify(mj));
write(path.join(h2, 'CHANGELOG.md'), '# Changelog\n\n## 1.1.0\n- added quality check stage\n\n## 1.0.0\n- initial\n');
const minor = run([cli, '--harness-root', h2]);
check('dry run shows the version change', /cli-demo \(1\.0\.0 -> 1\.1\.0\)/.test(minor.out));
check('dry run prints the changelog entries in range', /changelog 1\.1\.0:/.test(minor.out) && /added quality check stage/.test(minor.out));
check('dry run does not print entries at or below the current version', !/changelog 1\.0\.0:/.test(minor.out));

const applied = run([cli, '--apply', '--in-place', '--harness-root', h2]);
check('--apply --in-place writes the update', applied.code === 0 && cliRead('.claude/commands/a.md') === 'a v2\n');
check('--in-place records the new version', JSON.parse(cliRead('.claude/.harness-version')).harnessVersion === '1.1.0');

write(path.join(h2, '.claude/commands/a.md'), 'a v3\n');
const allDry = run(['--all', '--harness-root', h2]);
check('--all names the processed product', allDry.code === 0 && /cli-demo \(1\.1\.0\): 1 update/.test(allDry.out));
check('--all warns about a missing directory and goes on', /WARN ghost: missing directory/.test(allDry.out));
const allApply = run(['--all', '--apply', '--in-place', '--harness-root', h2]);
check('--all --apply updates the product despite the ghost entry', allApply.code === 0 && cliRead('.claude/commands/a.md') === 'a v3\n');

check('rejects a missing target argument', (() => { const r = run(['--harness-root', h2]); return r.code === 1 && /usage/i.test(r.out); })());
check('rejects a directory that is not a product', (() => { const r = run([p2, '--harness-root', h2]); return r.code === 1 && /\.harness-version/.test(r.out); })());

// Review Focus 5: corrupt registry -> clear error
write(path.join(h2, '.harness', 'products.json'), 'not json');
const corrupt = run(['--all', '--harness-root', h2]);
check('corrupt registry exits 1 with a clear message', corrupt.code === 1 && /not valid JSON/.test(corrupt.out));
rm(h2);
rm(p2);

// --- CLI: isolated worktree (Review Focus 7) ---
const h3 = mkTmp('sy-h3-');
makeFakeHarness(h3);
const p3 = mkTmp('sy-p3-');
const wt = createProduct({ harnessRoot: h3, name: 'wt-demo', parentDir: p3, register: false }).target;
commitAll(wt);
const wtDir = path.join(p3, 'wt-demo-sync');
const mainFile = (rel) => fs.readFileSync(path.join(wt, rel), 'utf8');
write(path.join(h3, '.claude/commands/a.md'), 'a v2\n');

const first = run([wt, '--apply', '--harness-root', h3]);
check('--apply exits 0', first.code === 0);
check('--apply leaves the product working directory untouched',
  mainFile('.claude/commands/a.md') === 'a v1\n' && gitIn(wt, ['status', '--porcelain']) === '');
check('--apply writes into <product>-sync', fs.readFileSync(path.join(wtDir, '.claude/commands/a.md'), 'utf8') === 'a v2\n');
check('--apply uses branch chore/harness-sync-v1.0.0', gitIn(wtDir, ['branch', '--show-current']) === 'chore/harness-sync-v1.0.0');
check('--apply made no commit', gitIn(wtDir, ['rev-parse', 'HEAD']) === gitIn(wt, ['rev-parse', 'HEAD']));
check('--apply tells the human how to review and clean up',
  /git -C .*diff/.test(first.out) && /git worktree remove/.test(first.out) && /between two stages/.test(first.out));

write(path.join(h3, '.claude/commands/a.md'), 'a v3\n');
const second = run([wt, '--apply', '--harness-root', h3]);
check('a second --apply reuses the same worktree',
  second.code === 0 && fs.readFileSync(path.join(wtDir, '.claude/commands/a.md'), 'utf8') === 'a v3\n' && mainFile('.claude/commands/a.md') === 'a v1\n');

// major jump: SKIPPED, exit 0, nothing written anywhere
const m3 = JSON.parse(fs.readFileSync(path.join(h3, 'harness.manifest.json'), 'utf8'));
m3.harnessVersion = '2.0.0';
write(path.join(h3, 'harness.manifest.json'), JSON.stringify(m3));
const skipped = run([wt, '--apply', '--harness-root', h3]);
check('major jump is SKIPPED with exit 0', skipped.code === 0 && /SKIPPED wt-demo: major upgrade, not applied/.test(skipped.out));
check('major jump writes nothing', fs.readFileSync(path.join(wtDir, '.claude/commands/a.md'), 'utf8') === 'a v3\n');

// refusals: dirty .claude/ and no commits create no worktree
const h4 = mkTmp('sy-h4-');
makeFakeHarness(h4);
const p4 = mkTmp('sy-p4-');
const dirty = createProduct({ harnessRoot: h4, name: 'dirty-demo', parentDir: p4, register: false }).target;
commitAll(dirty);
// create the no-commit product BEFORE the harness changes, so that it is really up to date
// and the only thing that can stop it is the missing commit
const fresh = createProduct({ harnessRoot: h4, name: 'fresh-demo', parentDir: p4, register: false }).target;
write(path.join(dirty, '.claude/workflows/w.js'), 'w local edit\n'); // uncommitted change under .claude/
write(path.join(h4, '.claude/commands/a.md'), 'a v2\n');
const dirtyRun = run([dirty, '--apply', '--harness-root', h4]);
check('refuses when .claude/ has uncommitted changes', dirtyRun.code === 1 && /uncommitted changes under \.claude\//.test(dirtyRun.out));
check('refusal creates no worktree', !fs.existsSync(path.join(p4, 'dirty-demo-sync')));
const freshRun = run([fresh, '--apply', '--harness-root', h4]);
check('refuses a product with no commits', freshRun.code === 1 && /no commits yet/.test(freshRun.out));
check('no-commit refusal creates no worktree', !fs.existsSync(path.join(p4, 'fresh-demo-sync')));

// a leftover branch from an earlier sync gets a clear message, not a raw git error
execFileSync('git', ['worktree', 'remove', '--force', wtDir], { cwd: wt, stdio: 'ignore' });
write(path.join(h3, 'harness.manifest.json'), JSON.stringify({ ...m3, harnessVersion: '1.0.0' }));
write(path.join(h3, '.claude/commands/a.md'), 'a v4\n');
const leftover = run([wt, '--apply', '--harness-root', h3]);
check('a leftover sync branch is explained',
  leftover.code === 1 && /already exists from an earlier sync/.test(leftover.out) && /git branch -D/.test(leftover.out));
check('the leftover-branch refusal creates no worktree', !fs.existsSync(wtDir));
rm(h3); rm(p3); rm(h4); rm(p4);
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `node scripts/sync-harness.test.js`
Expected: FAIL — `dry run exits 0 and lists the update` (file `sync-harness.js` chưa tồn tại).

- [ ] **Step 3: Viết CLI**

Create `scripts/sync-harness.js`:

```js
#!/usr/bin/env node
// sync-harness.js — push harness workflow updates into product repos.
// Usage: node scripts/sync-harness.js <product-dir> | --all  [--apply] [--in-place]
//   default is a dry run. --apply writes into a separate worktree
//   (<product>-sync), never into the product's own working directory, and
//   never commits or pushes. --in-place writes straight into the product
//   directory (emergency/testing only). Major version jumps are never applied.
const fs = require('fs');
const path = require('path');
const {
  planSync, hasChanges, applySync, formatPlan, createSyncWorktree, MajorVersionError,
} = require('./lib/sync');
const { readRegistry } = require('./lib/registry');
const { changelogBetween } = require('./lib/version');

const flag = (name) => process.argv.includes(name);
function opt(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function printChangelog(harnessRoot, plan) {
  if (plan.versionFrom === plan.versionTo) return;
  const f = path.join(harnessRoot, 'CHANGELOG.md');
  if (!fs.existsSync(f)) return;
  for (const e of changelogBetween(fs.readFileSync(f, 'utf8'), plan.versionFrom, plan.versionTo)) {
    console.log(`  changelog ${e.version}:`);
    for (const line of e.body.split('\n')) console.log(`    ${line}`);
  }
}

function syncOne(harnessRoot, name, dir, { apply, inPlace }) {
  let plan;
  try {
    plan = planSync(harnessRoot, dir);
  } catch (e) {
    if (e instanceof MajorVersionError) {
      console.log(`SKIPPED ${name}: ${e.message}`);
      return;
    }
    throw e;
  }
  console.log(formatPlan(name, plan));
  printChangelog(harnessRoot, plan);
  if (!apply || !hasChanges(plan)) return;

  if (inPlace) {
    applySync(harnessRoot, dir, plan);
    console.log('  applied in place (nothing committed)');
    return;
  }
  const wt = createSyncWorktree(dir, plan.versionTo);
  applySync(harnessRoot, wt.dir, planSync(harnessRoot, wt.dir));
  console.log(`  applied in ${wt.dir} on branch ${wt.branch}`);
  console.log(`  nothing was committed and ${dir} was not touched`);
  console.log(`  review:   git -C "${wt.dir}" diff`);
  console.log('  then commit, open a PR, and merge it between two stages, never in the middle of one');
  console.log(`  clean up: git worktree remove "${wt.dir}"`);
}

function main() {
  const target = process.argv[2];
  if (!target || (target.startsWith('--') && target !== '--all')) {
    console.error('usage: sync-harness.js <product-dir> | --all [--apply] [--in-place]');
    process.exit(1);
  }
  const harnessRoot = path.resolve(opt('--harness-root') || path.join(__dirname, '..'));
  const options = { apply: flag('--apply'), inPlace: flag('--in-place') };
  let failed = false;

  if (target === '--all') {
    let products;
    try {
      products = readRegistry(harnessRoot);
    } catch (e) {
      console.error(`sync failed: ${e.message}`);
      process.exit(1);
    }
    if (!products.length) console.log('no product repos registered');
    for (const p of products) {
      if (!fs.existsSync(p.path)) {
        console.log(`WARN ${p.name}: missing directory ${p.path} (skipped)`);
        continue;
      }
      try {
        syncOne(harnessRoot, p.name, p.path, options);
      } catch (e) {
        console.error(`sync failed for ${p.name}: ${e.message}`);
        failed = true;
      }
    }
  } else {
    const dir = path.resolve(target);
    try {
      syncOne(harnessRoot, path.basename(dir), dir, options);
    } catch (e) {
      console.error(`sync failed: ${e.message}`);
      process.exit(1);
    }
  }

  if (!options.apply) console.log('dry run: nothing written. Re-run with --apply to write.');
  process.exit(failed ? 1 : 0);
}

main();
```

- [ ] **Step 4: Chạy để thấy thành công**

Run: `node scripts/sync-harness.test.js`
Expected: `PASS (sync-core)`

- [ ] **Step 5: Thêm script npm**

Edit `package.json` — thêm vào `scripts`:

```json
    "sync": "node scripts/sync-harness.js",
```

Run: `npm test`
Expected: bốn dòng PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add scripts/sync-harness.js scripts/sync-harness.test.js package.json
rtk git commit -m "feat: add sync-harness CLI with dry-run default, worktree apply and --all" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `check-harness` kiểm tra manifest, phiên bản, CHANGELOG, template và nhắc repo lỗi thời

**Files:**
- Modify: `scripts/check-harness.js`, `scripts/check-harness.test.js`

**Interfaces:**
- Consumes: `readRegistry` (Task 3), `planSync`, `hasChanges`, `MajorVersionError` (Task 5), `parse`, `hasChangelogEntry` (Task 2).
- Produces: `check-harness.js` thêm các lỗi mới: `missing harness.manifest.json`, `manifest entry not found: <path>`, `manifest harnessVersion invalid: ...`, `missing CHANGELOG.md`, `CHANGELOG.md has no entry for <version>`, `product template settings.json must deny "gh pr merge"`, `missing template file: product-template/<file>`; và dòng `note: <name>: behind harness <from> -> <to> (<n> file(s)); run: ...` (hoặc `note: <name>: major upgrade, not applied: ...`) in SAU `harness OK`, không đổi exit code. Export `staleNotes(root): string[]`.

- [ ] **Step 1: Thêm test thất bại**

Trong `scripts/check-harness.test.js`, thêm cạnh các require khác:

```js
const { staleNotes } = require('./check-harness');
const { createProduct } = require('./lib/create-product');
const { makeFakeHarness, write } = require('./lib/testutil');
```

Chèn ngay trước dòng `if (!ok) process.exit(1);`:

```js
// Helper: a fixture with everything check-harness verifies.
function fullFixture() {
  const f = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-full-'));
  copyDir(path.join(REPO, '.claude'), path.join(f, '.claude'));
  copyDir(path.join(REPO, 'product-template'), path.join(f, 'product-template'));
  for (const file of ['harness.manifest.json', 'CHANGELOG.md']) fs.copyFileSync(path.join(REPO, file), path.join(f, file));
  return f;
}

// AC3: complete fixture passes
const full = fullFixture();
const fullRun = run(full);
check('AC3 complete fixture exits 0', fullRun.code === 0);

// AC4: template that no longer denies gh pr merge → exit 1, says so
write(path.join(full, 'product-template/.claude/settings.json'), '{"permissions":{"deny":[]}}');
const noDeny = run(full);
check('AC4 template without merge deny exits 1', noDeny.code === 1 && /gh pr merge/.test(noDeny.out));
write(path.join(full, 'product-template/.claude/settings.json'), '{"permissions":{"allow":["Bash(gh pr merge *)"],"deny":[]}}');
const allowOnly = run(full);
check('AC4 a merge rule under allow does not count', allowOnly.code === 1 && /must deny/.test(allowOnly.out));
fs.rmSync(full, { recursive: true, force: true });

// AC5: manifest entry that does not exist → exit 1, names it
const brokenManifest = fullFixture();
write(path.join(brokenManifest, 'harness.manifest.json'), JSON.stringify({ harnessVersion: '1.0.0', managed: ['.claude/nope'], exclude: [] }));
const bm = run(brokenManifest);
check('AC5 manifest entry not found exits 1', bm.code === 1 && /manifest entry not found: \.claude\/nope/.test(bm.out));
fs.rmSync(brokenManifest, { recursive: true, force: true });

// AC7: a version without a CHANGELOG entry, and a malformed version → exit 1
const noEntry = fullFixture();
const nm = JSON.parse(fs.readFileSync(path.join(noEntry, 'harness.manifest.json'), 'utf8'));
nm.harnessVersion = '1.1.0';
write(path.join(noEntry, 'harness.manifest.json'), JSON.stringify(nm));
const ne = run(noEntry);
check('AC7 version without changelog entry exits 1', ne.code === 1 && /CHANGELOG\.md has no entry for 1\.1\.0/.test(ne.out));
nm.harnessVersion = 'one';
write(path.join(noEntry, 'harness.manifest.json'), JSON.stringify(nm));
const bad = run(noEntry);
check('AC7 malformed version exits 1', bad.code === 1 && /harnessVersion invalid/.test(bad.out));
fs.rmSync(noEntry, { recursive: true, force: true });

// AC6: stale product repos are reported as notes
const fakeHarness = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stale-'));
makeFakeHarness(fakeHarness);
const staleParent = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stale-p-'));
createProduct({ harnessRoot: fakeHarness, name: 'old-one', parentDir: staleParent });
check('AC6 up-to-date product yields no note', staleNotes(fakeHarness).length === 0);
write(path.join(fakeHarness, '.claude/commands/a.md'), 'a v2\n');
const notes = staleNotes(fakeHarness);
check('AC6 stale product yields one note naming it',
  notes.length === 1 && /old-one: behind harness 1\.0\.0 -> 1\.0\.0 \(1 file\(s\)\)/.test(notes[0]));
write(path.join(fakeHarness, '.claude/commands/a.md'), 'a v1\n'); // files identical again: only the version differs
const fm = JSON.parse(fs.readFileSync(path.join(fakeHarness, 'harness.manifest.json'), 'utf8'));
fm.harnessVersion = '1.0.1';
write(path.join(fakeHarness, 'harness.manifest.json'), JSON.stringify(fm));
const versionOnly = staleNotes(fakeHarness);
check('AC6 a version-only bump is reported as such', versionOnly.length === 1 && /\(version only\)/.test(versionOnly[0]));
fm.harnessVersion = '2.0.0';
write(path.join(fakeHarness, 'harness.manifest.json'), JSON.stringify(fm));
const majorNotes = staleNotes(fakeHarness);
check('AC6 a major-behind product is reported as not applied', majorNotes.length === 1 && /old-one: major upgrade, not applied/.test(majorNotes[0]));
fs.rmSync(path.join(staleParent, 'old-one'), { recursive: true, force: true });
check('AC6 a registered but deleted product is skipped quietly', staleNotes(fakeHarness).length === 0);
fs.rmSync(fakeHarness, { recursive: true, force: true });
fs.rmSync(staleParent, { recursive: true, force: true });
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `node scripts/check-harness.test.js`
Expected: lỗi `staleNotes is not a function` (hoặc `FAIL: AC4 ...`), vì `check-harness.js` chưa export và chưa có kiểm tra mới.

- [ ] **Step 3: Sửa `check-harness.js`**

Ở đầu file, sau dòng `const path = require('path');`, thêm:

```js
const { readRegistry } = require('./lib/registry');
const { planSync, hasChanges, MajorVersionError } = require('./lib/sync');
const { parse, hasChangelogEntry } = require('./lib/version');
```

Thêm hàm này ngay trước `function main()`:

```js
// Informational only: product repos created from this harness that lag behind it.
function staleNotes(root) {
  try {
    return readRegistry(root)
      .filter((p) => fs.existsSync(p.path))
      .flatMap((p) => {
        try {
          const plan = planSync(root, p.path);
          if (!hasChanges(plan)) return [];
          const n = plan.add.length + plan.update.length + plan.remove.length + plan.refresh.length;
          const what = n ? `${n} file(s)` : 'version only';
          return [`${p.name}: behind harness ${plan.versionFrom} -> ${plan.versionTo} (${what}); run: node scripts/sync-harness.js "${p.path}"`];
        } catch (e) {
          if (e instanceof MajorVersionError) return [`${p.name}: ${e.message}`];
          throw e;
        }
      });
  } catch (e) {
    return [`could not check product repos: ${e.message}`];
  }
}
```

Trong `main()`, ngay trước khối `if (problems.length) {`, thêm:

```js
  const manifestPath = path.join(root, 'harness.manifest.json');
  if (!fs.existsSync(manifestPath)) problems.push('missing harness.manifest.json');
  else {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { problems.push(`harness.manifest.json is not valid JSON: ${e.message}`); }
    if (manifest) {
      for (const m of manifest.managed || []) {
        if (!fs.existsSync(path.join(root, m))) problems.push(`manifest entry not found: ${m}`);
      }
      let versionOk = true;
      try { parse(manifest.harnessVersion); }
      catch (e) { versionOk = false; problems.push(`manifest harnessVersion invalid: ${e.message}`); }
      if (versionOk) {
        const cl = path.join(root, 'CHANGELOG.md');
        if (!fs.existsSync(cl)) problems.push('missing CHANGELOG.md');
        else if (!hasChangelogEntry(fs.readFileSync(cl, 'utf8'), manifest.harnessVersion)) {
          problems.push(`CHANGELOG.md has no entry for ${manifest.harnessVersion}`);
        }
      }
    }
  }

  const tplSettings = path.join(root, 'product-template', '.claude', 'settings.json');
  if (!fs.existsSync(tplSettings)) problems.push('missing product-template/.claude/settings.json');
  else {
    // parse the JSON: a merge rule sitting under "allow" or in a comment must not count
    let denyOk = false;
    try {
      denyOk = (JSON.parse(fs.readFileSync(tplSettings, 'utf8')).permissions.deny || []).some((r) => /gh pr merge/.test(r));
    } catch (e) { /* reported below */ }
    if (!denyOk) problems.push('product template settings.json must deny "gh pr merge"');
  }
  for (const t of ['CLAUDE.md.tmpl', path.join('docs', 'gates.json')]) {
    if (!fs.existsSync(path.join(root, 'product-template', t))) problems.push(`missing template file: product-template/${t}`);
  }
```

Thay dòng `console.log('harness OK');` bằng:

```js
  console.log('harness OK');
  for (const n of staleNotes(root)) console.log(`note: ${n}`);
```

Thay dòng cuối `main();` bằng:

```js
if (require.main === module) main();
module.exports = { staleNotes };
```

- [ ] **Step 4: Chạy để thấy thành công**

Run: `npm test`
Expected: bốn dòng PASS (`PASS (test suite)`, `PASS (lib)`, `PASS (new-product)`, `PASS (sync-core)`).

Run: `node scripts/check-harness.js`
Expected: `harness OK` (không có `note:` nếu chưa có repo sản phẩm nào).

- [ ] **Step 5: Commit**

```bash
rtk git add scripts/check-harness.js scripts/check-harness.test.js
rtk git commit -m "feat: check-harness validates manifest, version, changelog, template and stale products" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Tài liệu, `.gitignore`, và sửa spec cho khớp

**Files:**
- Modify: `.gitignore`, `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-06-idea-to-pr-workflows-design.md`

**Interfaces:** không có (tài liệu). `README.md` đang có thay đổi dở của người dùng — chỉ **thêm** một mục mới ở cuối, không sửa phần đang có; nếu `git diff README.md` cho thấy thay đổi dở thì dừng lại hỏi người dùng có muốn gộp vào commit này hay không.

- [ ] **Step 1: `.gitignore`**

Thêm cuối `.gitignore`:

```
# local registry of product repos (machine-specific paths)
.harness/
# product briefs live in the product repo; this repo is public
docs/brainstorm/
```

Run: `git check-ignore -v .harness/products.json docs/brainstorm/x.md`
Expected: cả hai đường dẫn đều được báo là bị ignore.

- [ ] **Step 2: CLAUDE.md của harness**

Thêm cuối `CLAUDE.md`:

```markdown

## Product repos
This repo is the source of truth for how a new product is built, and the place
product repos are created from.
- `node scripts/new-product.js <name>` creates `../<name>` (copies the managed
  workflows listed in `harness.manifest.json`, runs `git init`, no commit, no remote).
- Change a flow or add a step **only here**, then bump `harnessVersion` in
  `harness.manifest.json`, add a `## <version>` entry to `CHANGELOG.md`, and run
  `node scripts/sync-harness.js --all` (dry run) before `--all --apply`.
- A sync never commits, never pushes, never touches a product's working
  directory (it writes to `<product>-sync`), never overwrites a file the product
  edited (reported as a conflict), and never writes `.claude/settings.json`.
- Product-specific material (briefs, specs, designs) belongs in the product repo,
  never here: this repo is public.

### Classifying a harness change (decides the version bump)
A change is **not breaking** only if all four hold:
1. State files a product already has (`gates.json`, `spec.md`, `backlog.md`) stay valid unchanged.
2. Existing commands and workflows keep their names and meaning.
3. No new settings, env flag or Claude Code version is needed to run.
4. Whatever is added does not block a stage the product is in the middle of.

| Bump | What | Synced? |
|---|---|---|
| patch | bug fix, prompt wording | yes |
| minor | additive, e.g. an optional stage or a report-only quality check | yes |
| major | breaks any of the four (e.g. Sub-agents -> Agent Teams, new `gates.json` shape, renamed command) | **never**: sync refuses |

A new blocking quality gate is minor only if products opt in to enforcement
themselves; switching it on for every repo is major. Products on an old major
line are patched by keeping a `vN` branch of this repo and running
`sync-harness.js` with `--harness-root` pointing at a worktree of that branch.
```

- [ ] **Step 3: README**

Thêm cuối `README.md` (không sửa phần có sẵn):

```markdown

## Bootstrapping a product repo
Create a new repo for a product, next to this one:

    node scripts/new-product.js ridgo --seed path/to/brief.md

This copies the workflows listed in `harness.manifest.json`, writes the
product's own `CLAUDE.md`, `docs/` skeleton and `.claude/settings.json` (which
denies merging PRs and pushing to `main`), runs `git init`, and records the repo
in `.harness/products.json`. It does not commit and does not create a remote.

When this harness changes, roll it out to every product repo:

    node scripts/sync-harness.js --all            # dry run: add / update / remove / conflict + changelog
    node scripts/sync-harness.js --all --apply    # writes into <product>-sync on chore/harness-sync-v<version>

A sync never commits or pushes and never touches the product's own working
directory: review `git -C <product>-sync diff`, commit there, open a PR, merge it
between two stages, then `git worktree remove <product>-sync`. The product needs
at least one commit and a clean `.claude/`. Files the product edited are
reported as conflicts and left alone. A major harness version is never synced
(`SKIPPED ... major upgrade, not applied`). `.claude/settings.json` belongs to
the product: a sync only warns about deny rules from the template that are
missing, so add those by hand.
```

- [ ] **Step 4: Sửa spec cho khớp (cú pháp deny, worktree, phiên bản)**

Run: `grep -n ':\*)' docs/superpowers/specs/2026-10-06-idea-to-pr-workflows-design.md`
Expected: các dòng ở mục 6 (và có thể mục 5.0) nhắc `Bash(gh pr merge:*)` v.v.

```bash
sed -i 's/:\*)/ *)/g' docs/superpowers/specs/2026-10-06-idea-to-pr-workflows-design.md
grep -n 'gh pr merge' docs/superpowers/specs/2026-10-06-idea-to-pr-workflows-design.md
```

Expected: các dòng giờ ghi `Bash(gh pr merge *)`.

Run: `grep -n 'Với mỗi repo: tạo nhánh' docs/superpowers/specs/2026-10-06-idea-to-pr-workflows-design.md`
Expected: một dòng trong mục 5.0. Thay đúng bullet đó (cả dòng) bằng bốn bullet sau, dùng công cụ Edit:

```markdown
- Với mỗi repo: `--apply` ghi vào **git worktree riêng** `<repo>-sync` trên nhánh `chore/harness-sync-v<version>` (không bao giờ vào thư mục đang làm việc của repo sản phẩm), **không commit, không push**; bạn xem `git diff` trong worktree, commit, mở PR và chỉ merge giữa hai stage. Yêu cầu: repo sản phẩm đã có ít nhất một commit và `.claude/` không có thay đổi chưa commit. File đã bị repo sản phẩm sửa riêng được liệt kê là xung đột và không bị ghi đè.
- `.claude/settings.json` thuộc sản phẩm: sync không ghi, chỉ cảnh báo luật deny của template mà sản phẩm còn thiếu.
- **Phiên bản:** `harnessVersion` (semver) trong manifest; patch và minor được sync, **major thì sync từ chối** (`SKIPPED ... major upgrade, not applied`). Major = làm hỏng sản phẩm đang chạy dở (đổi hình dạng file trạng thái, đổi tên command, cần cờ/quyền/phiên bản Claude Code mới, đổi mô hình chạy như Sub-agents sang Agent Teams). Cổng chặn cứng mới chỉ là minor nếu sản phẩm tự bật cưỡng chế. Mỗi phiên bản phải có mục trong `CHANGELOG.md`, và sync in các mục giữa phiên bản của sản phẩm và phiên bản mới nhất.
- Repo ở dòng major cũ vẫn được vá lỗi: giữ nhánh `vN` của harness và chạy `sync-harness.js` với `--harness-root` trỏ tới worktree của nhánh đó.
```

- [ ] **Step 5: Kiểm tra tổng**

Run: `npm test && node scripts/check-harness.js`
Expected: bốn dòng PASS rồi `harness OK`.

- [ ] **Step 6: Commit (chỉ file thuộc task này)**

```bash
rtk git add .gitignore CLAUDE.md README.md docs/superpowers/specs/2026-10-06-idea-to-pr-workflows-design.md
rtk git commit -m "docs: document product bootstrap, sync policy and version classification" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Bàn giao — tạo repo `ridgo` (cần người dùng xác nhận từng bước ra ngoài)

**Files:** không sửa file nào trong harness. Tạo ngoài repo: `D:\internal_project\ridgo`.

**Interfaces:**
- Consumes: `new-product.js` (Task 4), `sync-harness.js` (Task 6).

- [ ] **Step 1: Tạo repo local**

```bash
node scripts/new-product.js ridgo --seed docs/brainstorm/app-du-lich-phuot-xe-may.md
```

Expected: `created D:\internal_project\ridgo` và dòng `no remote was created and nothing was committed.`

- [ ] **Step 2: Kiểm tra nội dung**

```bash
ls /d/internal_project/ridgo /d/internal_project/ridgo/.claude /d/internal_project/ridgo/docs
git -C /d/internal_project/ridgo status --short
cat /d/internal_project/ridgo/.claude/.harness-version | head -12
```

Expected: có `CLAUDE.md`, `.gitignore`, `.claude/{commands,agents,skills,workflows,settings.json,.harness-version}`, `docs/{brainstorm,ux,adr,gates.json,run-log.md}`; `docs/brainstorm/app-du-lich-phuot-xe-may.md` có mặt; `.harness-version` ghi `"harnessVersion": "1.0.0"`; **không** có `.claude/settings.local.json`, `study-research.js`, `deep-dive`.

- [ ] **Step 3: Xác nhận vòng cập nhật khép kín (dry run)**

```bash
node scripts/sync-harness.js --all
node scripts/check-harness.js
```

Expected: `ridgo (1.0.0): up to date`, `dry run: nothing written...`, `harness OK`, và **không** có dòng `note:`.

- [ ] **Step 4: HỎI NGƯỜI DÙNG trước khi commit đầu tiên trong `ridgo`**

Hỏi: "Bạn muốn tôi tạo commit đầu tiên trong `ridgo` không (`chore: bootstrap from claude-harness`)? Cần commit này thì sau này `sync --apply` mới tạo được worktree." Chỉ làm khi có câu trả lời đồng ý. Nếu đồng ý:

```bash
git -C /d/internal_project/ridgo add -A
git -C /d/internal_project/ridgo commit -m "chore: bootstrap from claude-harness" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: HỎI NGƯỜI DÙNG trước khi tạo repo GitHub (hành động công khai)**

Hỏi: "Tạo repo GitHub **private** `daovmlucky/ridgo` và push `main`?" Chỉ làm khi đồng ý rõ ràng. Nếu đồng ý:

```bash
gh repo create daovmlucky/ridgo --private --source /d/internal_project/ridgo --remote origin
git -C /d/internal_project/ridgo push -u origin main
```

Nếu `gh repo create` bị từ chối vì token (`github_pat_`) thiếu quyền tạo repo: dừng, báo người dùng, nhờ họ tạo repo private trống `ridgo` trên web rồi chạy `git -C /d/internal_project/ridgo remote add origin https://github.com/daovmlucky/ridgo.git` và push.

- [ ] **Step 6: Kiểm chứng luật deny (an toàn, không merge thật)**

Trong một phiên Claude Code mở tại `D:\internal_project\ridgo`, nhờ agent chạy lệnh vô hại `gh pr merge --help`.
Expected: bị chặn bởi luật deny `Bash(gh pr merge *)`. Nếu lệnh chạy được, luật deny sai cú pháp: sửa `product-template/.claude/settings.json` ở harness, thêm test, rồi sửa tay `ridgo/.claude/settings.json` (file thuộc sản phẩm, sync không đụng tới).

- [ ] **Step 7: Thử vòng sync thật với worktree (sau khi Step 4 đã commit)**

Thêm tạm một dòng vào `CHANGELOG.md` của harness là không cần; thay vào đó chỉ chạy dry-run để xác nhận không có gì để áp dụng, và nói với người dùng rằng lần cập nhật harness đầu tiên (ví dụ Phase A) sẽ là lần thử `--apply` thật vào `ridgo-sync`.

```bash
node scripts/sync-harness.js /d/internal_project/ridgo
```

Expected: `ridgo (1.0.0): up to date`.

---

## Self-Review

**1. Spec coverage (mục 5.0, 10, 11):**
- Tạo thư mục + `git init`, không commit/remote → Task 3, 4.
- Copy phần managed (`workflows/ commands/ agents/ skills/harness`) → Task 2 (manifest), Task 3.
- Sinh phần thuộc sản phẩm: `CLAUDE.md`, `docs/`, `.claude/settings.json` với deny → Task 2, 3.
- `.claude/.harness-version` với phiên bản + commit + checksum → Task 3.
- `--seed` → Task 3, 4.
- In hướng dẫn bước tiếp theo → Task 4.
- Sync: so checksum, không ghi đè file đã sửa, báo xung đột → Task 5; `--all`, sổ đăng ký, bỏ qua đường dẫn mất → Task 6; worktree cô lập, nhánh `chore/harness-sync-v<version>`, không commit/push → Task 5, 6.
- Phiên bản: `harnessVersion`, từ chối major, CHANGELOG, in changelog khi sync, `new:` cho command mới → Task 2, 5, 6, 7.
- `settings.json` chỉ cảnh báo → Task 5.
- `.harness/products.json` trong `.gitignore` → Task 8.
- `check-harness.js` nhắc repo lỗi thời + kiểm tra manifest/phiên bản/changelog/deny → Task 7.
- Test cho cả hai script → Task 3–7.
- Cập nhật CLAUDE.md/README/spec (kèm bảng phân loại thay đổi) → Task 8. (Cập nhật `CLAUDE.md` về các cổng G0–G3 thuộc Phase A, nằm ngoài kế hoạch này.)
- Quyết định 7–9 (tên Ridgo, private, brief không vào harness) → Task 8 (`docs/brainstorm/` ignored), Task 9.
- Phương án plugin, migration, gộp settings, tự động bắt phân loại sai: **chủ ý không làm** (đã thảo luận, để dành).

**2. Placeholder scan:** không có TBD/TODO; mọi bước code có mã đầy đủ; Task 9 là bước vận hành có lệnh cụ thể và hai điểm dừng hỏi người dùng.

**3. Type consistency:** `listManaged/readManifest/sha256/walk/toPosix/copyFile` (Task 1) dùng nguyên tên ở Task 3 và 5; `major/parse/compare/changelogBetween/hasChangelogEntry` (Task 2) dùng ở Task 5, 6, 7; `readRegistry/registerProduct` (Task 3) dùng ở Task 6, 7; `planSync` trả `{add, update, remove, conflict, kept, current, refresh, versionFrom, versionTo, settingsMissing}` (Task 5) và `hasChanges`, `formatPlan`, `applySync`, CLI, `staleNotes` đều dùng đúng các khoá đó; `MajorVersionError` xuất ở Task 5 và dùng ở Task 6, 7; `createProduct({ harnessRoot, name, parentDir, seed, register })` khớp giữa Task 3–7; `createSyncWorktree(productRoot, version)` trả `{dir, branch, reused}` khớp giữa Task 5 và 6; thông điệp lỗi `invalid name` / `not empty` / `seed file not found` / `harnessVersion` / `not valid JSON` / `.harness-version` / `major upgrade, not applied` / `uncommitted changes under .claude/` / `no commits yet` khớp giữa mã và test.

**4. Review Focus:** 7 dòng đều có test ở task sở hữu (1–3 ở Task 3, 4 ở Task 5, 5 ở Task 6, 6 ở Task 5 và 6, 7 ở Task 6).
