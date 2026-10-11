# Generic `/flow` Workflow — Design

> Date: 2026-10-11 · Status: DRAFT, chờ người dùng duyệt · Phạm vi: harness (`claude-harness`), KHÔNG phải một sản phẩm cụ thể.
> Quy ước: **[U]** = người dùng đã quyết định. **[D]** = mặc định tôi đề xuất, chưa xác nhận.

## 1. Mục tiêu
Một workflow chung (`/flow`) chạy chuỗi 8 bước của harness hiện có: explore → requirements → design → blueprint → breakdown → implement → fix-loop → deliver. Giữ nguyên kỷ luật của harness: hai cổng người duyệt, review độc lập, fix-loop tối đa 5 vòng. **[U]**
Phần đặc thù từng repo do repo tự định nghĩa; phần chung nằm ở harness. **[U]** Các lệnh `/explore`…`/deliver`, skill `harness` và agent `reviewer` hiện có **không bị sửa**. **[U]**

Thành công khi: (1) `/flow` chạy tới cổng kế tiếp rồi dừng, và chỉ tiếp tục sau khi người dùng duyệt; (2) không có đường nào đi qua cổng mà chưa duyệt; (3) fix-loop không bao giờ báo xanh nếu test hoặc review chưa đạt; (4) không bao giờ tự push, mở PR hay merge; (5) nội dung từng bước luôn trùng với file lệnh tương ứng.

## 2. Ngoài phạm vi (cố ý, chuyển sang sau) **[U]**
Plugin và bước tự định nghĩa; giao diện chỉnh pipeline; chạy các bước song song; chọn model theo bước; đường ý-tưởng-đến-PR (G0–G3, spec `2026-10-06-idea-to-pr-workflows-design.md`); sửa lệnh hoặc skill cũ.

## 3. Ràng buộc từ runtime (nguồn: https://code.claude.com/docs/en/workflows)
- Script không nạp được mã ngoài (`import()` làm workflow lỗi) và không tự đọc/ghi file hay chạy shell: **chỉ agent** làm được.
- Workflow **không nhận input giữa chừng** → mỗi cổng là điểm dừng giữa hai lần chạy.
- Trong script `Date.now()`, `Math.random()` và `new Date()` không tham số bị chặn; `meta` phải là object literal ở đầu file.
- `agent()` có `label`, `phase`, `schema`, `model`, `isolation`. Chưa thấy tùy chọn chọn loại subagent, nên review độc lập dựa vào **agent mới với ngữ cảnh sạch** đọc `.claude/agents/reviewer.md`, không dựa vào định nghĩa subagent.
- Điều chưa kiểm chứng trên máy này: hành vi `schema` khi agent trả sai định dạng ngoài quy định thử lại của runtime; chi phí token thực tế.

## 4. Thiết kế

### 4.1 Một workflow, một lệnh **[U]**
Tệp `.claude/workflows/flow.js`, tên `flow`. Đầu vào là chuỗi `args`:

| Lệnh | Việc |
|---|---|
| `/flow <mô tả việc>` | Bắt đầu một việc mới: ghi trạng thái, chạy từ `explore` tới cổng kế tiếp. Từ chối nếu đang có việc dở. |
| `/flow` | Tiếp tục việc đang làm, từ bước chưa xong, tới cổng kế tiếp. Từ chối nếu bước vừa xong là cổng chưa duyệt. |
| `/flow status` | Chỉ đọc: việc hiện tại, bước đã xong, bước kế, cổng đang chờ. Không ghi gì. |
| `/flow approve <bước>` | Ghi duyệt cho một cổng. Không chạy bước nào. Từ chối nếu bước đó chưa xong hoặc không phải cổng. |

Không có `/flow reset`: muốn bỏ việc dở thì sửa tay `docs/flow-state.json`. **[D]**

### 4.2 Cổng duyệt **[U]**
- Cổng **bắt buộc**: sau `requirements` (duyệt phạm vi) và sau `deliver` (duyệt phát hành). Không cấu hình nào gỡ được hai cổng này (kỷ luật của harness: "never edit a gate away").
- Repo có thể **thêm** cổng bằng file tùy chọn `docs/flow.config.json`: `{ "extraGates": ["design"] }`. Id không hợp lệ làm `/flow` dừng với thông báo rõ, không bỏ qua lặng lẽ.
- Cổng sau `deliver` là điểm kết thúc: duyệt chỉ ghi nhận. **Workflow không bao giờ push, mở PR hay merge**; việc đó người dùng làm (hoặc yêu cầu riêng).

### 4.3 Trạng thái **[D]**
`docs/flow-state.json` do workflow ghi, người dùng chỉ sửa tay khi cần thoát việc dở:
```json
{ "flowSchema": 1, "task": "…", "completed": ["explore","requirements"], "approved": { "requirements": true }, "failure": null }
```
Dùng file riêng, **không dùng** `docs/gates.json`: mẫu sản phẩm của đường G0–G3 đã định nghĩa file đó với hình dạng khác (G0, G1, G2, G3a, G3b), nên dùng chung sẽ xung đột. `flowSchema` có từ đầu vì hình dạng file này là hợp đồng; đổi nó về sau là thay đổi **major**.

### 4.4 Luồng chạy (3 pha)
1. **Load** (1 agent, `schema`): đọc `docs/flow-state.json` và `docs/flow.config.json` (nếu có), kiểm tra hợp lệ, trả `{ task, completed, approved, gates, next, blocked }`. Nhánh `status` và `approve` kết thúc ở đây (approve có thêm 1 agent ghi file). Nếu trạng thái hỏng hoặc không hợp lệ: dừng và nói rõ.
2. **Steps**: với mỗi bước từ `next` trở đi, 1 agent (trừ `fix-loop`, xem 4.5). Prompt của agent do script ghép từ: tên bước, việc cần làm (`$ARGUMENTS`), và chỉ thị "đọc `.claude/commands/<bước>.md` và làm đúng như nó mô tả; **bỏ qua** mọi dòng yêu cầu dừng hỏi người dùng, vì workflow tự xử lý cổng; không push, không mở PR; nếu mục của bước đã có trong `docs/run-log.md` thì thay thế, không thêm trùng". Agent trả `{ status: done|failed, summary, artifacts: [đường dẫn file đã ghi] }`. Sau mỗi bước xong, nếu bước đó là cổng thì dừng; nếu `failed` thì dừng. Các bước bắt buộc để lại file: `requirements` → `docs/spec.md`, `breakdown` → `docs/plan.md`; agent Persist kiểm tra file tồn tại, và nếu thiếu thì ghi `failure` thay vì ghi bước đó vào `completed`.
3. **Persist** (1 agent, tại mỗi điểm dừng: cổng, lỗi, hoặc hết): ghi `completed`, `failure` vào `docs/flow-state.json`. Một lần chạy bị ngắt giữa chừng sẽ làm lại từ điểm dừng gần nhất; vì các bước thay thế mục cũ nên chạy lại là an toàn.

### 4.5 `fix-loop` do script điều khiển **[U]**
Tối đa 5 vòng, mỗi vòng: **Test** (agent tự phát hiện lệnh test, trả `{ passed, command, summary }`) song song với **Review** (agent mới đọc `.claude/agents/reviewer.md` và chấm theo `docs/spec.md`, trả `{ verdict: PASS|BLOCK, blockers[] }`); **Ghi** kết quả vào `docs/run-log.md`; nếu test đạt **và** verdict `PASS` thì xanh; nếu không, một agent **Fix** sửa đúng các lỗi test và `[BLOCKER]`, rồi sang vòng sau. Dừng sớm và chuyển lên người dùng khi cùng một tập blocker lặp lại hai vòng liên tiếp (không tạo ra tiến triển), hoặc khi hết 5 vòng. Không bao giờ báo xanh nếu thiếu một trong hai điều kiện. Agent viết mã và agent review khác nhau, nên review độc lập.

### 4.6 Quan hệ với các lệnh cũ
Nội dung từng bước chỉ nằm ở file lệnh cũ; `flow.js` chỉ chứa **bộ khung** (thứ tự, cổng, vòng lặp, trạng thái). Sửa một file lệnh thì `/flow` tự thấy. Rủi ro: một lệnh cũ bị sửa thành đòi hỏi tương tác mới thì workflow sẽ không biết; chấp nhận, và `check-harness` kiểm tra đủ 8 file lệnh tồn tại như hiện nay.

## 5. Kiểm thử
- **Test điều khiển luồng** (`scripts/flow.test.js`, không tốn token): nạp `flow.js` vào `vm` với bản giả của `agent`, `parallel`, `phase`, `log`, `args`, và chạy các kịch bản: bắt đầu → dừng đúng ở `requirements`; tiếp tục khi chưa duyệt bị từ chối; duyệt rồi chạy tới `deliver`; `extraGates` chèn thêm điểm dừng; cố gỡ cổng bắt buộc bị từ chối; id cổng sai bị từ chối; fix-loop xanh ngay vòng 1; xanh ở vòng 3; hết 5 vòng thì dừng, không gọi `deliver`; lỗi lặp lại hai vòng thì dừng sớm; test đạt nhưng review BLOCK không bao giờ xanh; agent trả sai định dạng; `status` và `approve` không chạy bước nào; không agent nào được dặn push hay mở PR.
- **Kiểm tra tĩnh** nối vào `check-harness`: `flow.js` bắt đầu bằng `export const meta` dạng literal, không có `import(`, `Date.now`, `Math.random`; đủ 8 file lệnh; có mục CHANGELOG cho phiên bản.
- **Chạy thật một lần** trên một repo mẫu nhỏ trong thư mục tạm, có người theo dõi, để xác nhận runtime chạy đúng và đo token. Không thể tự động hóa phần này; kết quả ghi vào CHANGELOG.

## 6. Phát hành
Thêm mới, tương thích ngược (không đổi file trạng thái hay lệnh có sẵn, không cần cờ mới) nên là **minor: `harnessVersion` 1.1.0**, kèm mục CHANGELOG. `flow.js` nằm sẵn trong thư mục workflow của manifest nên được sync tự động. Sau khi gộp: `sync-harness.js --all` (chạy thử, rồi `--apply`) đưa sang `ridgo`. `string-art` không có `.harness-version` nên chưa nhận được qua sync; nhập vào bằng một lần chép tay là việc riêng.

## 7. Rủi ro đã biết
- **Chi phí token cao hơn** chạy từng lệnh bằng tay (nhiều agent, mỗi lệnh chạy ngữ cảnh mới, mất khả năng can thiệp giữa bước). Chưa đo; phép đo ở mục 5 sẽ cho số liệu thật. Số agent mỗi lần chạy đầy đủ: 1 load + 7 bước đơn + 3 mỗi vòng fix-loop + 1 persist mỗi điểm dừng.
- **Agent bỏ qua chỉ thị "không dừng hỏi"** và tự dừng ở dòng STOP của lệnh cũ: bước sẽ báo `done` mà chưa hoàn tất. Giảm nhẹ: chỉ thị nêu rõ và lặp lại; Persist kiểm tra file đầu ra bắt buộc (mục 4.4) trước khi coi bước là xong **[D]**.
- **Review độc lập chỉ là ngữ cảnh mới**, không phải loại subagent riêng; tôi chưa kiểm chứng mức độ tách biệt này so với lệnh `/fix-loop` hiện tại.
- **Sửa tay trạng thái** có thể làm `/flow` đi sai bước; Load kiểm tra thứ tự nhưng không chứng minh bước đã thật sự xong ngoài việc kiểm tra file đầu ra.

## 8. Quyết định
1. **[U]** Một workflow `/flow`, dừng ở cổng kế tiếp; không chia ba workflow.
2. **[U]** Cổng là cấu hình; mặc định hai cổng; chỉ thêm, không gỡ.
3. **[U]** Tên lệnh `/flow`, có `/flow status`.
4. **[U]** Chưa làm plugin, giao diện, bước tự định nghĩa.
5. **[D]** Thêm `/flow approve <bước>` để ghi duyệt.
6. **[D]** Trạng thái ở `docs/flow-state.json`, cấu hình ở `docs/flow.config.json`.
7. **[D]** Lõi mỏng: nội dung bước đọc từ file lệnh cũ.
8. **[D]** Dừng sớm của fix-loop khi tập blocker lặp lại hai vòng.
