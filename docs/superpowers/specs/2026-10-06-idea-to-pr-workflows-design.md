# Idea-to-PR Dynamic Workflows — Design

> Date: 2026-10-06 · Status: DRAFT v2, chờ người dùng duyệt · Phạm vi: bộ workflow cho harness, KHÔNG phải app phượt.
> Quy ước: **[D]** = quyết định mặc định chưa được người dùng xác nhận. **[U]** = người dùng đã quyết định.
> v2: áp dụng quyết định của người dùng về mô hình Agile (Epic → Story → Task, PR theo Task), tranh luận có giải thích + trade-off + functional/non-functional, và công cụ thiết kế UI/UX.

## 1. Mục tiêu
Đưa một ý tưởng sản phẩm đến các Pull Request đã kiểm thử, bằng dynamic workflow, trong đó **con người giữ mọi quyết định không thể đảo ngược**: chọn hướng, duyệt spec, duyệt thiết kế + backlog, merge. Agent chỉ nghiên cứu, thiết kế, viết code, test, mở PR.

Thành công khi: (1) không workflow nào chạy tiếp khi cổng trước chưa được duyệt; (2) không agent nào merge được PR; (3) mỗi task có test và review độc lập trước khi có PR; (4) mọi quyết định thiết kế đều có lý do, trade-off và truy vết về yêu cầu functional/non-functional; (5) toàn bộ bằng chứng nằm trong `docs/`.

## 2. Ràng buộc từ runtime (nguồn: https://code.claude.com/docs/en/workflows)
- Workflow **không nhận input giữa chừng** → mỗi cổng duyệt nằm GIỮA hai workflow, không nằm trong script.
- Script không đọc file/chạy shell; chỉ agent làm được → mọi việc chạm filesystem/git/gh do agent làm.
- Không `import()`, không `Date.now()/Math.random()/new Date()` trong script; ngày giờ truyền qua `args`.
- Tối đa 16 agent đồng thời mặc định, 1.000 agent/lần chạy; `meta` phải là object literal; tên `phase()` khớp `meta.phases`.
- `agent()` hỗ trợ `schema` (JSON có kiểm tra), `label`, `model`, `isolation: "worktree"`.

## 3. Tổng quan pipeline

```
/brainstorm ─► G0 ─► /spec ─► G1 ─► /architect ─► /spike ─► /backlog ─► G2
                                                                          │
      /beta ◄─ /verify ◄─ G3b(merge từng PR theo wave) ◄─ /features ◄─ G3a(merge) ◄─ /foundation
```

| Workflow | Việc chính | Đầu ra | Cổng người dùng |
|---|---|---|---|
| `/brainstorm` | Nghiên cứu 7 góc song song → kiểm chứng chéo → brief + kế hoạch kiểm chứng người dùng | `docs/brainstorm/<slug>.md` | **G0:** chọn hướng, ghi kết quả phỏng vấn người dùng thật vào `docs/validation.md`, quyết định chiến lược nội dung cold-start |
| `/spec` | Phân rã **Feature → Epic → Story** + requirements (functional **và** non-functional định lượng) + luồng UX/danh sách màn hình; tạo hoặc nhận thiết kế UI (xem 5.2) | `docs/spec.md`, `docs/ux/` | **G1:** duyệt spec và thiết kế UI |
| `/architect` | Đóng khung vấn đề → agent kiến trúc song song → tranh luận → tổng hợp, mọi quyết định có lý do + trade-off (5.3) | `docs/design.md`, `docs/adr/` | — |
| `/spike` | Prototype vứt đi cho từng rủi ro | `docs/spikes.md` | — |
| `/backlog` | Phân rã Story → **Task** kỹ thuật có phụ thuộc, nhóm thành wave | `docs/backlog.md` | **G2:** duyệt thiết kế + báo cáo spike + backlog |
| `/foundation` | Dựng khung dự án, CI, module dùng chung; mở PR | 1 PR | **G3a:** bạn merge |
| `/features` | Mỗi wave: các task độc lập chạy song song trong worktree riêng; **mỗi task một PR** | N PR | **G3b:** bạn merge từng PR, rồi mở wave kế |
| `/verify` | Kiểm tra theo Story (tiêu chí chấp nhận) và theo Epic (tích hợp) sau khi merge | `docs/verify-<n>.md` | đọc báo cáo |
| `/beta` | TestFlight/Play internal, crash reporting, analytics theo chỉ số của spec | `docs/beta.md` | bạn tự upload và thu phản hồi |

Lý do tách `/foundation` khỏi `/features`: các task song song đều cần khung chung; nếu cùng sinh khung sẽ xung đột khi merge.

## 4. Cơ chế cổng duyệt
- Trạng thái ở `docs/gates.json`: `{ "G0": "APPROVED <date> <hash>", ... }`. Người dùng ghi bằng lệnh `/approve <gate>` (command markdown nhỏ, chỉ ghi file này).
- Mỗi workflow (trừ `/brainstorm`) bắt đầu bằng một agent kiểm tra cổng tiền đề, trả `{ ok: boolean, reason }` qua `schema`. Nếu `ok=false`, script `log()` lý do và `return []` ngay.
- Spec/thiết kế/backlog đổi sau khi đã duyệt → cổng đó và các cổng sau về trạng thái chưa duyệt (so khớp hash nội dung ghi lúc duyệt).

## 5. Thiết kế từng workflow

### 5.0 Phase 0 — Bootstrap và phân phối từ harness [U]
**Vai trò [U]:** `claude-harness` là nguồn định nghĩa chiến lược pipeline (workflows, commands, agent reviewer, luật an toàn, mẫu `docs/`) và là nơi khởi tạo repo sản phẩm. Toàn bộ công việc từ brainstorming đến delivery diễn ra trong **repo sản phẩm**, không phải trong harness.

**`scripts/new-product.js <tên-repo> [--dir <thư-mục-cha>]`** (script Node thường, có test; không cần agent):
1. Tạo thư mục repo, `git init` (không tạo remote; xem mục quyết định).
2. Copy phần "được quản lý" của harness: `.claude/workflows/`, `.claude/commands/`, `.claude/agents/`, `.claude/skills/harness/`.
3. Sinh phần "của sản phẩm", không bao giờ bị ghi đè về sau: `CLAUDE.md` riêng của sản phẩm, `docs/` (`brainstorm/`, `ux/`, `adr/`, `gates.json`, `run-log.md`), `.claude/settings.json` với luật deny (`gh pr merge`, push lên main, force push).
4. Ghi `.claude/.harness-version` gồm commit hash của harness và danh sách file đã copy kèm checksum.
5. Tuỳ chọn `--seed <file>` để copy brief brainstorm đã có vào `docs/brainstorm/`.
6. In hướng dẫn bước tiếp theo, và không tự commit hay đẩy lên remote nào.

**Cập nhật về sau, `scripts/sync-harness.js <repo-sản-phẩm>`:** so sánh checksum với `.claude/.harness-version`; file nào repo sản phẩm đã tự sửa thì KHÔNG ghi đè mà báo xung đột để bạn quyết định; file mới hoặc file chưa bị sửa thì cập nhật; in diff trước khi áp dụng và chỉ áp dụng khi bạn xác nhận. Cải tiến workflow chỉ được thực hiện ở harness, repo sản phẩm chỉ nhận qua sync.

**Cập nhật toàn bộ repo sản phẩm [U]:** mọi thay đổi về flow hay step ở harness phải lan sang TẤT CẢ repo sản phẩm đã tạo. Cơ chế:
- `new-product.js` ghi đường dẫn repo mới vào sổ đăng ký cục bộ `.harness/products.json` của harness. File này chứa đường dẫn máy cá nhân nên nằm trong `.gitignore`, không đẩy lên GitHub.
- `sync-harness.js --all` đọc sổ đăng ký, xử lý từng repo, và bỏ qua kèm cảnh báo nếu đường dẫn không còn tồn tại.
- Với mỗi repo: `--apply` ghi vào **git worktree riêng** `<repo>-sync` trên nhánh `chore/harness-sync-v<version>` (không bao giờ vào thư mục đang làm việc của repo sản phẩm), **không commit, không push**; bạn xem `git diff` trong worktree, commit, mở PR và chỉ merge giữa hai stage. Yêu cầu: repo sản phẩm đã có ít nhất một commit và `.claude/` không có thay đổi chưa commit. File đã bị repo sản phẩm sửa riêng được liệt kê là xung đột và không bị ghi đè.
- `.claude/settings.json` thuộc sản phẩm: sync không ghi, chỉ cảnh báo luật deny của template mà sản phẩm còn thiếu.
- **Phiên bản:** `harnessVersion` (semver) trong manifest; patch và minor được sync, **major thì sync từ chối** (`SKIPPED ... major upgrade, not applied`). Major = làm hỏng sản phẩm đang chạy dở (đổi hình dạng file trạng thái, đổi tên command, cần cờ/quyền/phiên bản Claude Code mới, đổi mô hình chạy như Sub-agents sang Agent Teams). Cổng chặn cứng mới chỉ là minor nếu sản phẩm tự bật cưỡng chế. Mỗi phiên bản phải có mục trong `CHANGELOG.md`, và sync in các mục giữa phiên bản của sản phẩm và phiên bản mới nhất.
- Repo ở dòng major cũ vẫn được vá lỗi: giữ nhánh `vN` của harness và chạy `sync-harness.js` với `--harness-root` trỏ tới worktree của nhánh đó.
- Ngoại lệ: `sync-harness.js <repo> --apply --in-place` ghi thẳng vào thư mục sản phẩm; chỉ dùng khi khẩn cấp hoặc để kiểm thử, chỉ cho một repo, và bị từ chối khi dùng cùng `--all`.
- Kiểm tra bắt buộc: một thay đổi ở harness mà chưa sync sang repo nào sẽ được `check-harness.js` nhắc ("N repo đang dùng phiên bản cũ").

**Phương án thay thế (chưa chọn):** đóng gói harness thành plugin để cập nhật bằng cơ chế plugin. Ưu: cập nhật chuẩn, không lệch. Nhược: lệnh bị gắn tên plugin (ví dụ `/tên-plugin:architect`) và tôi chưa kiểm chứng việc cài plugin từ thư mục local. Cân nhắc khi có nhiều sản phẩm.

### 5.1 `/brainstorm`
Mở rộng `product-brainstorm.js` hiện có. Thêm đầu ra: danh sách câu hỏi cần kiểm chứng với người dùng thật và kịch bản phỏng vấn. Args: `{ idea, goal?, audience? }`.

### 5.2 `/spec` — Agile ở cấp sản phẩm, và UI/UX
**Phân cấp [U]:** Feature → Epic → Story → Task. Ở `/spec` tạo đến mức **Story** (giá trị người dùng, tiêu chí chấp nhận dạng kiểm thử được: Given/When/Then). Task là việc kỹ thuật, sinh ở `/backlog` sau khi đã có thiết kế.

**Non-functional requirements [U]:** mỗi Epic phải có NFR định lượng, không viết chung chung. Danh mục bắt buộc cân nhắc: hiệu năng (độ trễ, thời gian khởi động), offline và độ tin cậy, pin và dữ liệu di động, bảo mật, quyền riêng tư và pháp lý, khả năng mở rộng, chi phí vận hành, trợ năng, bản địa hoá. Mục nào không áp dụng phải ghi "N/A + lý do".

**UI/UX:** tool là lựa chọn của người dùng (5.2.1). Phần việc của workflow: luồng người dùng, danh sách màn hình, trạng thái (rỗng/lỗi/offline), design tokens cần có. Một agent phản biện độc lập tìm tiêu chí mơ hồ và trường hợp biên.

#### 5.2.1 Công cụ thiết kế (thay thế hoặc kết hợp Figma)
Thiết kế đồ hoạ là việc của người, và workflow không đợi người giữa chừng, nên bước vẽ diễn ra giữa `/spec` và G1; liên kết thiết kế được ghi vào `docs/ux/design-links.md`. Agent triển khai đọc thiết kế qua MCP.

| Công cụ | Tích hợp Claude Code | Ghi chú |
|---|---|---|
| **Figma** (đề xuất nếu đã quen) | MCP chính thức: `claude plugin install figma@claude-plugins-official` hoặc `claude mcp add --transport http figma https://mcp.figma.com/mcp` | Đọc ngữ cảnh thiết kế miễn phí; ghi ngược vào canvas còn ở dạng beta. Giới hạn của gói miễn phí chưa được kiểm tra |
| **Google Stitch** | Có MCP server; xuất HTML/CSS, React, Flutter, SwiftUI, React Native và xuất sang Figma | Dùng để tạo bản nháp nhanh từ prompt; là sản phẩm Google Labs thử nghiệm |
| **Penpot** | MCP server (5 công cụ, dùng `execute_code`), mã nguồn mở, tự host được | Miễn phí, không bị khoá nhà cung cấp; hệ sinh thái nhỏ hơn Figma |
| **Wireframe HTML** (dự phòng) | Agent tự sinh file HTML tĩnh | Không cần tool ngoài; không phải thiết kế hoàn chỉnh |

**Gói Figma Starter không dùng được [U + kiểm chứng]:** (1) giới hạn 1 folder, 3 file, 3 trang mỗi file nên không chứa được nhiều phiên bản UI/UX; (2) theo kết quả tìm kiếm, ghế Free/Starter/Viewer chỉ được **6 lượt gọi MCP mỗi tháng** (kể cả ghế Full trên gói Starter), nên agent không đọc thiết kế được. Ghế Full/Dev trên gói Pro được 200 lượt/ngày (10 lượt/phút). Cần kiểm lại trang giá và tài liệu chính thức của Figma trước khi trả tiền.

**Quyết định [U]: không trả phí, hai giai đoạn.**
1. **Khám phá nhiều phiên bản: Google Stitch** (miễn phí, khoảng 350 lượt tạo chuẩn mỗi tháng, có MCP). Lưu ý đây là sản phẩm Labs thử nghiệm, không mua thêm được lượt, và có nguồn nói gói trả phí dự kiến xuất hiện trong Q4 2026.
2. **Phiên bản đã chốt: Penpot**, làm nguồn sự thật cho agent triển khai qua MCP. Ưu tiên tự host hoặc gói miễn phí; giới hạn của gói miễn phí Penpot chưa được kiểm tra.

**Rủi ro chưa kiểm chứng, đưa vào `/spike`:** Stitch xuất sang Figma, HTML/CSS và các framework code, nhưng chưa thấy nguồn nói xuất thẳng sang Penpot. Đường chuyển có thể là import SVG/HTML hoặc vẽ lại thủ công, và độ trung thực của việc chuyển chưa biết. Nếu đường chuyển kém, phương án dự phòng là dùng đầu ra HTML của Stitch làm tham chiếu cho agent và chỉ vẽ lại các màn hình chủ chốt trong Penpot. Wireframe HTML là phương án dự phòng cuối.

### 5.3 `/architect` — tranh luận có truy vết yêu cầu
1. **Đóng khung vấn đề [U]:** với mỗi vấn đề thiết kế (ví dụ đồng bộ offline, lưu trữ lộ trình, xác thực), agent đầu tiên phải viết ra: yêu cầu functional liên quan, NFR liên quan kèm con số, ràng buộc và giả định. Agent đề xuất chỉ được bắt đầu sau khi bước này được một agent khác xác nhận đúng và đủ so với `docs/spec.md`.
2. **Soạn thảo song song:** mỗi agent chuyên môn (backend, mobile, cloud/hạ tầng, dữ liệu, bảo mật và pháp lý, chi phí) đề xuất ít nhất 2 phương án cho miền của mình, theo một mục tiêu riêng và đối nghịch: chi phí vận hành, bảo mật/quyền riêng tư, tốc độ ra MVP, độ tin cậy offline.
3. **Phản biện chéo:** mỗi agent đọc đề xuất của agent khác, nêu tối đa 5 phản đối kèm bằng chứng hoặc kịch bản hỏng.
4. **Phản hồi:** tác giả chấp nhận, bác bỏ có lý do, hoặc sửa.
5. Lặp bước 3–4 tối đa **2 vòng**, dừng sớm khi không còn phản đối chưa giải quyết.
6. **Agent tổng hợp (không thuộc phe nào)** ra thiết kế. Mỗi quyết định lớn là một **ADR [U]** gồm: vấn đề, functional và NFR liên quan, các phương án, **phương án được chọn và lý do**, **trade-off đã chấp nhận** (được gì, mất gì), phương án bị loại và vì sao, điều kiện nên xem lại quyết định.
7. **Ma trận truy vết:** `docs/design.md` có bảng ánh xạ mỗi Functional/NFR → quyết định ADR đáp ứng nó. Một agent kiểm tra độc lập báo lỗi nếu có yêu cầu không được quyết định nào phủ, hoặc quyết định nào không phục vụ yêu cầu nào.
8. Mục **"Bất đồng chưa giải quyết"** dành riêng cho bạn; tổng hợp không được nuốt bất đồng. Bạn là người duyệt cuối **[U]**.
9. Xuất danh sách rủi ro ưu tiên cho `/spike`.

Tech stack do các agent chọn qua quy trình này **[U]**, và phải có ADR như mọi quyết định khác.

### 5.4 `/spike`
Pipeline một agent mỗi rủi ro, chạy trong worktree riêng, code vứt đi (thư mục `spikes/`, không merge). Mỗi agent trả `{ risk, verdict: PASS|FAIL|INCONCLUSIVE, evidence, design_impact }`. Có FAIL → báo cáo nêu điều khoản thiết kế phải sửa; bạn quyết định chạy lại `/architect` hay chấp nhận.

### 5.5 `/backlog` [U: mô hình Agile]
- Phân rã mỗi Story thành **Task** kỹ thuật theo thiết kế đã có. Mỗi Task: tiêu đề, Story/Epic mẹ, tiêu chí hoàn thành (Definition of Done) kiểm thử được, ước lượng cỡ (S/M/L), `depends_on`, `files_touched` (đường dẫn dự kiến sửa), các NFR phải giữ.
- Task phải đủ nhỏ để thành **một PR dễ review**; Task cỡ L bị buộc tách.
- Nhóm Task thành **wave** theo đồ thị phụ thuộc: wave n chỉ gồm các task mà mọi phụ thuộc nằm ở wave nhỏ hơn.
- Đầu ra `docs/backlog.md`, và là một phần bạn duyệt ở G2.

### 5.6 `/foundation`
Tuần tự, một nhánh: scaffold theo design.md → CI → lint/test chạy được → reviewer độc lập → fix-loop ≤5 → `gh pr create`. Dừng.

### 5.7 `/features` — một Task, một PR [U]
- Args: `{ wave: number, tasks?: string[], maxTasks?: number }`. Chạy **một wave mỗi lần**, và từ chối chạy nếu các PR của wave trước chưa được merge (agent kiểm tra bằng `gh`).
- `pipeline(tasks, ...)`, mỗi task trong `isolation: "worktree"`, nhánh `task/<id>-<slug>`:
  1. **Test-từ-tiêu-chí:** test được viết từ Definition of Done của task TRƯỚC khi có code. Task cỡ M/L hoặc chạm bảo mật, dữ liệu vị trí, hiệu năng: do **agent test riêng**. Task cỡ S không chạm các mục đó: do **cùng một agent làm TDD** (viết test trước rồi code) **[U]**.
  2. **Implement:** agent viết code cho đến khi test đạt (TDD), đối chiếu thiết kế UI qua MCP khi task có giao diện.
  3. **Kiểm tra NFR liên quan** của task (ví dụ độ trễ, bộ nhớ) khi đo được.
  4. **Review độc lập:** agent `reviewer` đối chiếu `docs/spec.md` và `docs/design.md`.
  5. **Fix-loop:** lặp test → review tối đa **5** vòng; vòng 5 vẫn hỏng thì task BLOCKED kèm báo cáo, KHÔNG mở PR. Dừng sớm: cùng một lỗi lặp lại hai vòng liên tiếp thì BLOCKED ngay.
  6. `/security-review`, rồi `gh pr create`. Mô tả PR nêu Task/Story/Epic mẹ, tiêu chí đã đạt, bằng chứng test.
- Kết quả: `{ task, status: PR_OPENED|BLOCKED, pr_url?, iterations, evidence }`, ghi vào `docs/run-log.md`.

**Hệ quả của PR theo Task:** số PR nhiều và nhỏ, và vì merge là thủ công nên các wave phụ thuộc nhau phải đợi bạn merge. Đây là nhịp đúng của Agile nhưng chậm hơn chạy một mạch.

**Quy tắc xếp chồng PR [U]:** mặc định KHÔNG xếp chồng; chạy theo wave và đợi merge. Xếp chồng (task B rẽ nhánh từ nhánh của task A chưa merge) chỉ được phép khi **tập file dự kiến sửa của A và B không giao nhau** và B thuộc task khác A. Không bao giờ có hai PR chưa merge cùng sửa một file. Cơ chế kiểm tra: mỗi task ở `/backlog` khai báo `files_touched`, một **script tất định** (không phải agent) báo lỗi nếu hai task cùng wave hoặc cùng chuỗi xếp chồng có file trùng, và task vi phạm bị đẩy sang wave sau **[U]**. Trước khi mở PR, agent đối chiếu `git diff --name-only` với `files_touched`; sửa ngoài khai báo thì dừng và báo cáo.

### 5.8 `/verify`
- **Theo Story:** khi mọi Task của một Story đã merge, chạy tiêu chí chấp nhận cấp Story trên main.
- **Theo Epic:** khi mọi Story của Epic xong, chạy e2e và kiểm tra NFR của Epic, tìm lỗi tương tác giữa các task (điều worktree riêng không thấy).
- Lỗi → nêu rõ task nào gây ra, đề xuất mở lại.

### 5.9 `/beta`
Checklist phát hành, cấu hình crash reporting/analytics ánh xạ từ "Chỉ số thành công", nháp thông tin store. Upload và thu phản hồi là việc của bạn.

## 5.10 Chế độ thực thi theo stage [U]
Nguyên tắc: chỉ dùng nhiều agent độc lập ở chỗ tính độc lập làm đổi kết quả (review, kiểm chứng số liệu, tranh luận, công việc song song độc lập); chỗ cần một tư duy xuyên suốt dùng một agent; chỗ kiểm tra được bằng máy thì dùng script. Phân tầng model: mạnh cho tổng hợp, review, phán đoán; tầm trung cho viết code cơ học và spike; rẻ cho thu thập web (chọn bằng tham số `model` của `agent()`).

| # | Stage | Chế độ | Ghi chú tiết kiệm |
|---|---|---|---|
| 0 | Bootstrap | Script, không agent | |
| 1 | Brainstorm | Nhiều agent: 7 góc song song + 1 người kiểm chứng | 7 góc dùng model rẻ hơn; kiểm chứng và tổng hợp dùng model mạnh |
| 2 | Spec | Một agent viết + 1 reviewer độc lập | |
| 3 | Architect | Nhiều agent (chi nhiều nhất) | Tối đa 2 vòng, dừng sớm; chỉ gọi agent chuyên môn có liên quan; model mạnh cho tổng hợp và truy vết |
| 4 | Spike | Nhiều agent song song, mỗi rủi ro một agent, worktree riêng | Kết quả dựa vào đo đạc; model tầm trung |
| 5 | Backlog | Một agent phân rã + **script** kiểm tra `files_touched` và tính wave | |
| 6 | Foundation | Một agent implement + 1 reviewer độc lập (model mạnh) | |
| 7 | Features | Nhiều agent song song theo Task; phân tầng theo rủi ro (xem 5.7); reviewer luôn độc lập, model mạnh | Dừng sớm khi lỗi lặp lại |
| 8 | Verify | Script chạy test và e2e; 1 agent chỉ phân tích khi có lỗi | |
| 9 | Beta | Một agent | |

Chưa đo chi phí thực tế; chỉnh lại sau lần chạy đầu tiên của từng workflow (xem mức dùng token trong `/workflows`).

## 6. An toàn và kiểm soát
- `.claude/settings.json` deny: `Bash(gh pr merge *)`, `Bash(git push origin main *)`, `Bash(git push --force *)`, cùng các biến thể `git push -u origin main`, `git push origin HEAD:main`, `git push --force-with-lease`. Đây là chốt chặn best-effort cho "manual merge", độc lập với prompt, không phải đảm bảo tuyệt đối (ví dụ `git push` trần khi đang đứng trên `main` không thể chặn mà không chặn mọi lần push). Cần bật thêm branch protection trên remote GitHub.
- Agent chỉ được tạo nhánh `task/*`, `spike/*`, `foundation/*`.
- Kiểm soát chi phí: `args.maxTasks`, số vòng tranh luận ≤2, fix-loop ≤5, cờ `args.dryRun` chỉ chạy bước lập kế hoạch.
- Chạy thử `/features` với 1 task trước khi chạy cả wave.

## 7. Cấu trúc file
```
.claude/workflows/{brainstorm,spec,architect,spike,backlog,foundation,features,verify,beta}.js
.claude/commands/approve.md
docs/{brainstorm,ux,adr}/ docs/{spec,design,backlog,spikes,beta,validation,run-log}.md docs/gates.json
```
`study-research.js` và `product-brainstorm.js` giữ nguyên; `brainstorm.js` mới tái dùng `product-brainstorm.js`.

## 8. Quan hệ với harness hiện tại
- Pipeline lệnh cũ (`/explore → /deliver`) giữ nguyên cho dự án nhỏ; bộ workflow mới là đường cho sản phẩm lớn. `docs/plan.md` của harness cũ tương ứng `docs/backlog.md` ở đây.
- CLAUDE.md ghi hai cổng duyệt; thiết kế này có G0–G3. Cần cập nhật CLAUDE.md sau khi spec được duyệt. "Reviewer độc lập" và "fix-loop ≤5" được giữ nguyên.
- `scripts/check-harness.js` sẽ được mở rộng để kiểm tra: `meta` hợp lệ, tên phase khớp, có luật deny `gh pr merge`.

## 9. Kiểm thử bộ workflow
- Kiểm tra tĩnh bằng `check-harness.js` (cú pháp, `meta`, phase, không dùng API bị cấm).
- Chạy thử trên repo mẫu nhỏ: 1 Epic, 1 Story, 2 Task phụ thuộc nhau, để xác nhận đường đi G1→PR và việc wave 2 bị từ chối khi wave 1 chưa merge.
- Cố tình chạy workflow khi cổng chưa duyệt để xác nhận nó dừng.
- Yêu cầu agent merge và quan sát bị chặn bởi luật deny.
- Kiểm tra ma trận truy vết: xoá một NFR khỏi thiết kế và xác nhận agent kiểm tra báo lỗi.

## 10. Thứ tự xây (mỗi phase là một chu kỳ spec → plan → implement riêng)
- **Phase 0 (bootstrap):** `scripts/new-product.js`, `scripts/sync-harness.js`, mẫu `CLAUDE.md`/`docs/` cho sản phẩm, test cho cả hai script. Làm TRƯỚC để có repo sản phẩm sớm; ban đầu repo này chỉ chạy được `/product-brainstorm`, các stage sau xuất hiện dần qua `sync-harness` khi xây xong từng phase.
- **Phase A (lập kế hoạch):** `/approve` + cơ chế cổng, `/brainstorm`, `/spec`, `/architect`.
- **Phase B (xây dựng):** `/spike`, `/backlog`, `/foundation`, `/features`, `/verify`.
- **Phase C:** `/beta`.
Lý do: Phase A cho giá trị ngay và rủi ro thấp; Phase B là phần khó và tốn token nên cần cơ chế cổng đã vững.

## 11. Quyết định
1. **[U]** Phân cấp Feature → Epic → Story → Task; **mỗi Task một PR**.
2. **[U]** Agent tranh luận và chọn tech stack, có giải thích lý do + trade-off, có functional + non-functional cho từng vấn đề; người dùng duyệt.
3. **[U]** Công cụ UI/UX không tốn phí: Stitch để khám phá nhiều phiên bản, Penpot cho bản chốt; không mua Figma Pro (5.2.1). Đường chuyển Stitch → Penpot là rủi ro cần spike.
4. **[U]** Tách `/foundation` và `/features`; chạy `/features` theo wave, đợi merge giữa các wave; chỉ xếp chồng PR khi file không giao nhau và khác task (5.7).
5. **[D]** Tranh luận 2 vòng, mỗi agent có mục tiêu đối nghịch.
6. **[D]** `/backlog` nằm trước G2 và được duyệt cùng thiết kế.

7. **[U]** Repo sản phẩm nằm cùng cấp với claude-harness (`D:\internal_project\<tên-repo>`), tên tiếng Anh gợi du lịch/phượt/road trip. Tên sản phẩm **[U]: Ridgo**, repo `ridgo` tại `D:\internal_project\ridgo`. Đã kiểm tra: không có app trùng hoặc bắt đầu bằng "Ridgo" trên App Store (store Mỹ) và repo `daovmlucky/ridgo` còn trống. Chưa kiểm tra: Google Play, tên miền, nhãn hiệu.
8. **[D]** Remote GitHub: tài khoản `daovmlucky`, repo **private** (claude-harness đang là public, và tài liệu ý tưởng sản phẩm không nên nằm ở repo public). Chỉ tạo remote và push sau khi người dùng xác nhận từng lần.
9. **[D]** Nội dung riêng của sản phẩm (như brief brainstorm hiện ở `docs/brainstorm/`) KHÔNG commit vào claude-harness vì repo này public; chuyển sang repo sản phẩm qua `--seed`.

## 12. Ngoài phạm vi
Tự động merge/deploy, tự upload lên store, thay thế bước phỏng vấn người dùng thật, tự vẽ thiết kế đồ hoạ hoàn chỉnh thay người thiết kế, bản thân app phượt.
