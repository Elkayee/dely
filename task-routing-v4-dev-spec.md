# Đặc tả phát triển Task Routing v4

**Mục tiêu:** sửa các trường hợp đánh giá cao sai do phạm vi task hoặc áp dụng rubric sai, đồng thời giữ Medium+ và Hard độc quyền Codex Sol.

**Trạng thái:** đặc tả bàn giao; chưa triển khai. Baseline đã đối chiếu ngày 17/10/2026: `D:\orca`, commit `3009008d0ee470877a52638c856717277a60f90a`, policy `jev-task-routing-v3`. Nếu code đã thay đổi khi bắt đầu, agent dev phải đối chiếu lại các điểm gọi liên quan trước khi sửa. Các tên hàm mới và schema v4 dưới đây là thiết kế đề xuất, không phải API đã tồn tại.

**Agent thực hiện:** Codex Sol, model pin hiện tại `gpt-6.1-sol`, effort `xhigh`, workflow direct. Chính công việc sửa policy, admission và model fallback có `context.risks.routing: true`; không giao phần triển khai cơ chế này cho AGY.

## 1. Kết quả bắt buộc

1. AGY nhận primary cho `easy` và `medium_minus`, đúng model `gemini-3.8-flash-medium`, effort `default`.
2. `medium_plus` chỉ chạy Codex Sol / `medium`; `hard` chỉ chạy Codex Sol / `xhigh` và không qua Dely.
3. Không dùng số tiêu chí cao, số file, số dòng, tên repository, confidence thấp hoặc việc thiếu test runner làm lý do tự động hạ mức.
4. Jev gốc được giữ nguyên. Correction chỉ sửa cách Control áp dụng một tiêu chí đủ điều kiện, có chứng cứ, rồi tính lại kết quả.
5. `knownHard`, bất kỳ câu trả lời Jev `hard`, dữ liệu chưa đủ và mâu thuẫn chưa giải quyết không được đi vào correction cho AGY.
6. Task nhỏ thông thường không phải bổ sung một hồ sơ ngoại lệ hoặc vòng đánh giá mới. Chỉ task xin correction cần proof bổ sung.
7. Giữ các cổng kiểm tra snapshot, native admission, reviewer, session/turn, Dely dispatch và pin hiện có; không tạo đường bỏ qua chúng.

Không đặt chỉ tiêu tăng tỷ lệ AGY bằng mọi giá. Thành công là ít quyết định nâng mức sai hơn với cùng tiêu chuẩn nghiệm thu và ranh giới model được giữ đúng.

## 2. Bằng chứng baseline và giới hạn kết luận

| Hạng mục đã kiểm tra | Kết quả | Ý nghĩa cho thiết kế |
| --- | --- | --- |
| Router v3 | `assess()` lấy mức cao nhất trong 5 chiều; `review()` cấm mọi mức thấp hơn kết quả Jev | Cần cơ chế sửa một lỗi áp rubric rõ ràng, không thay max bằng bỏ phiếu |
| Policy v3 | Đã yêu cầu xét hậu quả, không xét tên repo/chủ đề; unknown không đồng nghĩa false | Ưu tiên thực thi đúng định nghĩa, không thu hẹp Hard thành phá hủy dữ liệu |
| Route Medium+ | Primary Sol/medium nhưng có Luna/max cho quota và model-unavailable | Phải sửa cả hai fallback để đáp ứng độc quyền Sol |
| Repo `D:\XLDL_VU\dev` | 85 snapshot v3: 69 knownHard, 9 Jev Medium+, 4 Jev Medium-, 3 ban đầu NOT_EVALUATED | Không được gọi 85 snapshot là 85 công việc người dùng độc lập |
| Cờ production trong 69 knownHard của dev | 65 có production; 36 chỉ có production | Nên xem cách gộp implementation với live rollout |
| Repo `D:\XLDL_VU\All_Data` | 104 snapshot v3: 36 knownHard, 2 Jev Hard, 43 Jev Medium+, 12 Jev Medium-, 11 ban đầu NOT_EVALUATED | Không thể coi toàn bộ nhóm Hard hoặc Medium+ là false positive |
| Hai mẫu semantic Hard đã đọc | Mỗi mẫu có 4 chiều Medium+ và verification Hard | Không phải ví dụ chỉ một chiều Medium+ khiến task bị nâng mức |
| Test baseline | 24/24 test trong hai suite routing/risk-cases đã pass với Jev giả lập | Xác minh logic, chưa đo calibration ngữ nghĩa của Jev thật |

Số liệu lịch sử dùng lần assessment đầu tiên của mỗi snapshot v3, nhóm theo repo chuẩn hóa + SHA-256 spec + SHA-256 context, chỉ trong hai repo nêu trên. Cutoff journal đã kiểm tra là `2026-10-17T16:11:31.068Z`. Một nhiệm vụ có thể có nhiều snapshot; review, retry, probe và phiên bản policy khác không được cộng thành công việc mới.

Các số **628 task Hard** và **80% do verification/coordination** trong đề xuất đầu vào chưa được audit tái lập. Không đưa chúng thành giả định, KPI, hoặc bằng chứng để mở quyền routing. Nguồn baseline ở mục 17.

## 3. Phê bình và điều chỉnh bốn trụ cột

| Trụ cột đầu vào | Quyết định | Cách thực hiện |
| --- | --- | --- |
| 2-Hit và scope ép mức thấp | Không dùng để tự quyết định route | Dùng dạng vector một chiều cao để tìm candidate cần Control kiểm tra |
| Chuẩn hóa Hard theo hậu quả thực tế | Giữ mục tiêu, sửa định nghĩa | Bảo toàn security, dữ liệu/ý nghĩa/compatibility, contract, architecture, production, routing; thiếu chứng cứ là việc chưa giải quyết |
| Bounded slices | Ưu tiên | Tách theo trách nhiệm và nghiệm thu độc lập, đặc biệt implementation và live rollout; đánh giá mới từng slice |
| Justified downgrade | Chấp nhận có giới hạn | Chỉ một chiều verification hoặc coordination từ Medium+ xuống Medium-, bằng proof cấu trúc; không chỉ `--reason` |

Ví dụ một hàm rất ngắn vẫn có thể đổi công thức nghiệp vụ, kiểm tra quyền, timezone hoặc tính tương thích. Tương tự, phạm vi đã rõ không có nghĩa cách chứng minh đúng đã dễ: kiểm chứng race condition hoặc bất biến qua nhiều thành phần có thể là trở ngại quyết định duy nhất.

## 4. Ma trận route và fallback chuẩn

| Difficulty cuối được duyệt | Workflow | Primary harness / model / effort | Quota fallback | Model-unavailable fallback |
| --- | --- | --- | --- | --- |
| `easy` | `dely` | `antigravity` / `gemini-3.8-flash-medium` / `default` | Giữ Luna/max theo điều kiện hiện hữu | Giữ Luna/max theo điều kiện hiện hữu |
| `medium_minus` | `dely` | `antigravity` / `gemini-3.8-flash-medium` / `default` | Giữ Luna/max theo điều kiện hiện hữu | Giữ Luna/max theo điều kiện hiện hữu |
| `medium_plus` | `dely` | `codex` / `gpt-6.1-sol` / `medium` | Không có | Không có |
| `hard` | `direct` | `codex` / `gpt-6.1-sol` / `xhigh` | Không có | Không có |

Luna ở hai mức thấp là hành vi fallback sẵn có được giữ nguyên, không phải primary mới cho AGY và không phải mở quyền Medium+. Không thêm model hoặc tầng fallback khác.

Với Medium+, `route()` phải trả `fallback: []` và không có `modelUnavailable`. Khi Sol thiếu model hoặc hết quota, đường thực thi dừng/chờ với lỗi rõ ràng; không đổi difficulty và không chạy Luna/AGY. Dùng cơ chế lỗi có sẵn của preflight/dispatch, không cần thêm trạng thái assessment mới chỉ để biểu diễn sự cố provider.

### 4.1 Lỗi phụ thuộc cần sửa cùng fallback

`selectedPin()` hiện kiểm tra default stage 1 so với `fallback.length` cả khi chạy primary. Chỉ đổi Medium+ sang `fallback: []` sẽ làm primary bị từ chối.

Thứ tự đúng:

```javascript
function selectedPin(assessment, flags) {
  validateSupportedFallbackFlags(flags);
  if (flags["fallback-stage"] != null && flags.fallback !== "quota") {
    throw routingError("INVALID_FALLBACK_FLAGS");
  }
  if (flags.fallback == null) return assessment.route.primary;
  // Từ đây mới xử lý một yêu cầu quota fallback thật sự.
  const stage = parseValidPositiveStage(flags["fallback-stage"] ?? "1");
  if (stage > assessment.route.fallback.length) {
    throw routingError("FALLBACK_NOT_PERMITTED");
  }
  return assessment.route.fallback[stage - 1];
}
```

Đây là pseudocode, không phải patch có thể chép nguyên trạng. Giữ cách parse/validation phù hợp code hiện hành. Kiểm tra cả `selectedPhase()`, `verifyPin()`, `verifyUnavailablePin()`, preflight, dispatch, model-unavailable và quota paths. Không tự động chọn Luna trước rồi mới kiểm tra policy sau khi đã khởi chạy.

## 5. Luồng đánh giá và thứ tự ưu tiên

Giữ các trạng thái hiện có: `NOT_EVALUATED`, `DIRECT_CODEX`, `REVIEW_REQUIRED`, `APPROVED`.

| Điều kiện sau khi đọc được snapshot | Trạng thái và xử lý |
| --- | --- |
| Có ít nhất một risk boolean `true` | `DIRECT_CODEX`, difficulty Hard, Sol/xhigh; không gọi Jev |
| Không có knownHard, thiếu trường bắt buộc hoặc flag chưa rõ | `NOT_EVALUATED`; không tự điền false, không tự cấp route thấp |
| Jev không gọi được hoặc trả dữ liệu không hợp lệ | `NOT_EVALUATED`; giữ đường Control-evidence hiện hữu theo mục 9 |
| Jev hợp lệ nhưng có `insufficient_evidence` | `NOT_EVALUATED`; không cho correction/non-Hard approval trước khi giải quyết |
| Jev đủ dữ liệu, max là Hard | `REVIEW_REQUIRED`, proposed route direct Sol/xhigh; không correction |
| Jev đủ dữ liệu, max là Medium+ | `REVIEW_REQUIRED`, proposed route Sol/medium; có thể kèm candidate metadata |
| Jev đủ dữ liệu, max là Easy hoặc Medium- | `REVIEW_REQUIRED`; review thông thường rồi AGY |

Router v3 thực tế kiểm tra knownHard trước `missingEvidence()`. version four giữ thứ tự bảo vệ này. Classification Hard từ một flag đã biết không tự tạo quyền thực thi khi native prepare/review còn thiếu đầu vào; các cổng native hiện có tiếp tục áp dụng.

Nếu Jev có cả `hard` và `insufficient_evidence`, assessment vẫn theo nhánh thiếu dữ liệu; câu trả lời Hard đã có vẫn là veto đối với mọi quyết định thấp hơn. Không dùng việc chưa đủ dữ liệu để xóa cảnh báo Hard.

### 5.1 Aggregation gốc

Giữ `RANK = { easy: 0, medium_minus: 1, medium_plus: 2, hard: 3 }`.

Validate đúng năm chiều đã định nghĩa, model/schema/choice/confidence/probability như hiện tại. Tính aggregation từ danh sách chiều cố định, không từ những key do caller tự thêm vào. Response thiếu/thừa chiều ngoài schema phải bị từ chối rõ ràng.

```javascript
function rawDifficulty(validatedAnswers) {
  if (DIMENSIONS.some(d => validatedAnswers[d].choice === "insufficient_evidence")) {
    return null;
  }
  return maxRank(DIMENSIONS.map(d => validatedAnswers[d].choice));
}
```

Không thêm confidence threshold hoặc thay đổi model Jev `jev-1.13.0` trong công việc này. Confidence và probability gốc phục vụ truy vết; không tự sinh confidence mới cho nhãn Control sửa.

## 6. Candidate và correction được phép

### 6.1 Điều kiện candidate

Tất cả các điều kiện sau phải đồng thời đúng:

1. Snapshot hợp lệ, các trường bắt buộc đầy đủ, `requirements_confirmed === true`.
2. Sáu risk là boolean `false`; không có rủi ro hoặc mâu thuẫn trọng yếu chưa giải quyết theo Control review.
3. Jev hợp lệ, đủ năm chiều, không `hard`, không `insufficient_evidence`.
4. Max gốc đúng `medium_plus`.
5. Có đúng một chiều `medium_plus`, chiều đó là `verification` hoặc `coordination`.
6. Bốn chiều còn lại không vượt `medium_minus`; đặc biệt `scope`, `uncertainty`, `risk` đều thấp.

Điều kiện 1, 3–6 và giá trị boolean có thể kiểm tra bằng code. Việc bằng chứng có đúng, đủ và không mâu thuẫn về mặt ngữ nghĩa thuộc trách nhiệm Control; không dùng regex hoặc tên file để giả vờ đã tự động chứng minh nó.

Candidate metadata chỉ giúp chỉ ra chỗ cần xem. Không có proof được duyệt thì task giữ Medium+ và vẫn đi Sol.

### 6.2 Hai reason code ban đầu

| Reason code | Chiều | Điều kiện thực chất |
| --- | --- | --- |
| `verification_instrument_available` | `verification` | Đã có cách kiểm tra cụ thể, phù hợp mức thấp, bắt được một implementation sai có khả năng xảy ra; điểm M+ không phù hợp facts trong snapshot |
| `routine_coordination_only` | `coordination` | Điểm cao phản ánh các bước planning, Dely, Control review, test hoặc reporting thường lệ; không tồn tại gánh nặng phối hợp thành phần/owner thực sự ở M+ |

Không kết luận nguyên nhân suy nghĩ của Jev khi response chỉ có choice/probability/confidence. Control giải thích vì sao mức cao không khớp facts và rubric; không bịa rationale mà Jev chưa cung cấp.

Không hợp lệ: chỉ nói “5 dòng CSS”, “ít file”, “test thủ công được”, “Flash làm được”, “confidence thấp”, “cần tiết kiệm chi phí”, “deadline gấp” hoặc “sẽ nghĩ ra test sau”.

### 6.3 Phép correction duy nhất

Chỉ cho sửa **một** chiều đủ điều kiện từ `medium_plus` xuống `medium_minus`. Không sửa scope/uncertainty/risk; không cho xuống Easy; không cho hai correction nối tiếp để làm thấp một vector nhiều chiều cao.

```javascript
function correctedDifficulty(assessment, proof) {
  const raw = validatedRawAnswers(assessment); // Giữ nguyên Jev gốc.
  const candidate = findCorrectionCandidate(assessment);
  validateCorrectionProof(assessment, candidate, proof);
  const effective = labelsOf(raw);
  effective[proof.dimension] = "medium_minus";
  const finalDifficulty = maxRank(Object.values(effective));
  if (finalDifficulty !== "medium_minus") throw correctionError();
  return { finalDifficulty, effectiveLabels: effective };
}
```

`review --difficulty medium_minus` vẫn phải khớp kết quả tính lại. Khi gửi correction proof, requested difficulty bắt buộc đúng `medium_minus`; yêu cầu Easy, Medium+ hoặc Hard kèm proof đều bị từ chối. Duyệt giữ Medium+ hoặc nâng mức dùng normal review không kèm correction. `--difficulty` không tự có quyền bỏ qua vector. Review nâng mức theo evidence tiếp tục được phép như hiện tại; ngoại lệ hạ mức chỉ áp dụng đúng trường hợp trên.

Nếu cần đổi phạm vi, bổ sung facts trọng yếu hoặc sửa flag Hard đã gán sai, phải tạo snapshot mới và assess lại, không dùng correction này để thay đổi spec/context hoặc viết đè assessment cũ. Giữ liên kết đến snapshot trước và giải thích thay đổi trong hồ sơ task. Một rủi ro thực sự không mất đi chỉ vì viết lại mô tả.

## 7. Hợp đồng proof và dữ liệu assessment

### 7.1 Đầu vào CLI

Thêm optional `--review-evidence-json <JSON>` vào ba front door:

- `D:\orca\skills\delivery\scripts\task-routing.js review`
- `D:\orca\scripts\jev_agent.js review`
- `D:\orca\scripts\codex-compliance.js review`

Public JavaScript API `review()` nhận thêm optional object, ví dụ `review(assessment, difficulty, reason, { correction: proof })`. Duy trì caller không có option cho normal review.

JSON giới hạn 8 KiB UTF-8, object thuần, đúng schema/version, không nhận field lạ dùng để yêu cầu đổi route hoặc nhiều chiều. Parse JSON lỗi phải trả lỗi, không fallback sang normal review/hạ mức. `--reason` vẫn bắt buộc và không thay thế proof.

Chọn JSON qua lệnh review hiện được phép để không bắt Control tự ghi proof file sau `prepare`. Lệnh review tự lưu proof bên trong record được duyệt. Không thêm ngoại lệ ghi tùy ý vào compliance directory. initial version không cần thêm `--review-evidence-file`.

Trong `jev_agent.js`, tách allowed flags và required flags: hiện một danh sách đang làm cả hai vai trò. Thêm proof vào allowlist nhưng không được biến nó thành bắt buộc cho mọi review. Trong các CLI khác, cũng chỉ nhận option này trong mode review.

### 7.2 Các field chung của proof

| Field | Kiểu và yêu cầu |
| --- | --- |
| `schema_version` | Integer đúng `1` |
| `assessment_basis_sha256` | SHA-256 hex 64 ký tự, copy từ assessment v4 đang review |
| `dimension` | `verification` hoặc `coordination`, phải khớp candidate |
| `reason_code` | Một trong hai enum mục 6.2, đúng chiều |
| `explanation` | String không rỗng, mô tả mismatch thực tế với rubric |
| `evidence_refs` | Mảng không rỗng của tham chiếu tới nội dung đã freeze trong spec/context |
| `acceptance` | Object: `method`, `procedure`, `expected_result`, `would_fail_if`; tất cả là string không rỗng |
| `coordination_facts` | Bắt buộc chỉ khi sửa coordination: xem dưới đây |

`evidence_refs` dùng dạng cấu trúc, không path tùy ý:

```json
[
  { "source": "context", "field": "coupling" },
  { "source": "context", "field": "acceptance" },
  { "source": "context", "field": "evidence" },
  { "source": "spec", "excerpt": "Một đoạn nguyên văn ngắn trong spec đã freeze" }
]
```

Chỉ cho `source=context` với field `scope`, `coupling`, `acceptance`, `evidence`; hoặc `source=spec` với excerpt không rỗng xuất hiện nguyên văn trong snapshot. Đây là validation tham chiếu, không phải chứng minh nội dung đó đúng. Nếu cần bằng chứng ngoài snapshot, Control đưa nội dung liên quan vào context/spec bằng workflow chuẩn rồi assess lại. Không đọc URL, execute command hoặc mở file tùy ý do proof chỉ định.

Với correction coordination, thêm:

```json
{
  "coordination_facts": {
    "changed_boundary": "Một boundary thực sự bị sửa, có owner rõ ràng",
    "callers_callees": "Danh sách hoặc mô tả dependency đã khảo sát",
    "counted_routine_steps": ["planning", "control_review"],
    "integration_obligations": "Công việc tích hợp còn lại và vì sao không tạo phối hợp M+ cho slice này"
  }
}
```

Các string/mảng này phải không rỗng; “không có dependency ngoài boundary” là một khẳng định cần được evidence hỗ trợ, không thay bằng `null`. Không nhận `coordination_facts` khi sửa verification để schema không có hai cách diễn giải.

### 7.3 Ví dụ proof verification

Ví dụ minh họa, không phải assessment thật. Thay placeholder hash bằng giá trị assessment v4; facts phải đã có trong spec/context tương ứng.

```json
{
  "schema_version": 1,
  "assessment_basis_sha256": "<copy SHA-256 64 ký tự từ assessment v4>",
  "dimension": "verification",
  "reason_code": "verification_instrument_available",
  "explanation": "Phạm vi là CSS của một panel với fixture cố định. Snapshot đã quy định phép kiểm tra overflow và clipping tại hai viewport; không cần thiết kế oracle hoặc phối hợp môi trường tích hợp mới.",
  "evidence_refs": [
    { "source": "context", "field": "scope" },
    { "source": "context", "field": "acceptance" },
    { "source": "context", "field": "evidence" }
  ],
  "acceptance": {
    "method": "browser_inspection",
    "procedure": "Mở fixture panel chứa nhãn dài đã chốt tại viewport 360px và 1280px; đối chiếu box của panel, nhãn và nút với yêu cầu kích thước trong spec.",
    "expected_result": "Nhãn không bị cắt, nút nằm trong panel, chiều rộng nội dung không vượt panel tại cả hai viewport.",
    "would_fail_if": "Nếu implementation giữ fixed width sai hoặc bỏ quy tắc wrap đã yêu cầu, fixture nhãn dài tạo clipping/overflow và phép kiểm tra phát hiện được."
  }
}
```

Trước dispatch, proof chứng minh **có cách kiểm tra khả dụng và đủ phân biệt đúng/sai**. Sau implementation, worker phải thực hiện acceptance và báo kết quả. Không yêu cầu test của tính năng chưa viết phải pass trước khi worker được nhận task.

### 7.4 Các field assessment v4

Giữ `difficulty` làm difficulty quyết định hiện tại: trước review là đề xuất, sau review là kết quả cuối. Không tạo thêm field final thứ hai cạnh tranh với nó.

Thêm:

- `advisor_state`: `EVALUATED` khi có response Jev hợp lệ đã lưu; `NOT_EVALUATED` nếu không có response hợp lệ. Jev hợp lệ có insufficient vẫn là EVALUATED.
- `jev_difficulty`: max Jev gốc khi đủ dữ liệu; `null` khi không có Jev hoặc có insufficient. KnownHard trước Jev có `difficulty=hard`, `jev_difficulty=null`.
- `assessment_basis_sha256`: fingerprint của basis cố định ở dưới.
- `correction_candidate`: `null` hoặc `{ dimension, from: "medium_plus", to: "medium_minus", reason_codes: [...] }`; chỉ metadata dẫn đường.

Record review giữ `by`, `reason`, `reviewed_at`, `source`, `confidence_threshold`. Thêm khi có correction:

```json
{
  "review": {
    "by": "codex-control",
    "source": "control-override-justified",
    "reason": "Lý do quyết định cuối, phải phù hợp proof",
    "reviewed_at": "<timestamp do review tạo>",
    "confidence_threshold": "NOT_EVALUATED",
    "correction": {
      "proof": "<object proof đã validate, không phải string trong triển khai>",
      "from": "medium_plus",
      "to": "medium_minus",
      "effective_labels": "<object đủ 5 chiều, chỉ một chiều được sửa>"
    },
    "correction_sha256": "<hash canonical correction>"
  }
}
```

JSON trên diễn giải hình dạng field bằng placeholder. Trong record thật, `proof` và `effective_labels` bắt buộc là object đúng schema. Normal review không có `correction`/`correction_sha256`; source giữ `jev-and-control` hoặc `control-evidence`. Không tin caller tự gán `source` hay `correction_candidate`.

### 7.5 Basis và canonicalization

Dùng một helper chung tạo canonical JSON: key object sắp xếp ổn định, thứ tự array giữ nguyên, primitive theo JSON chuẩn; từ chối giá trị không hữu hạn/không JSON. Hash UTF-8 canonical JSON bằng SHA-256. Không dùng việc stringify các object xây theo thứ tự ngẫu nhiên làm hợp đồng.

Basis gồm policy, task repo/spec_file/context_file theo cách canonical hiện có, hai content hash, advisor_state, cùng toàn bộ model và năm answers Jev đã validate; khi chưa đánh giá, phần Jev là null. Confidence, choice và probability gốc đều nằm trong binding. Không đưa timestamp, final difficulty, review hoặc route vào basis.

Review tính lại basis từ nguồn gốc, đối chiếu `assessment_basis_sha256` trong assessment và proof. Không chỉ tin hash do người gọi nhập. Hash correction bao gồm proof, from/to và effective_labels đã validate.

Giữ nguyên `assessment.jev`, không ghi đè answers hoặc xác suất của Jev. Với no-Jev, không tự tạo năm nhãn giả để lấp schema.

Hash phát hiện sự không khớp với nguồn đã freeze; nó không phải chữ ký xác thực danh tính Control và không chứng minh explanation đúng. Quyền Control tiếp tục do cơ chế native admission hiện có bảo đảm.

## 8. Validator dùng chung và chống lệch giữa các cổng

Tách việc tạo review mới khỏi kiểm tra một approval đã tồn tại. Tên hàm có thể theo style repo, nhưng trách nhiệm cần tương đương:

```text
deriveAssessmentBasis(assessment)
findCorrectionCandidate(assessment)
validateCorrectionProof(assessment, proof)
validateReviewDecision(assessment, requestedDifficulty, reason, options)
validateApprovedAssessment(assessment)
```

`review()` gọi validator và tạo một timestamp mới khi có quyết định mới. `validateApprovedAssessment()` là read-only/deterministic với cùng đầu vào; không tạo review mới, không đổi reviewed_at, source hoặc proof.

`requireApprovedRoute()` và `codex-compliance.validate()` dùng validator này. Mỗi lần gate phải:

1. Kiểm tra snapshot, repo/spec và policy như hiện tại.
2. Kiểm tra response gốc, advisor_state và basis nhất quán.
3. Tính lại candidate, điều kiện correction, effective labels và mức thấp nhất được phép; không tin cache metadata.
4. Kiểm tra requested/final difficulty, source, correction hash và route đúng policy.
5. Áp dụng Hard exclusion, workflow, model/effort pin, session/turn và dispatch evidence hiện hữu.

Trong native `prepare`, đưa `assessment.json` gốc vào bộ fingerprint của các input đã freeze. Review đối chiếu basis của state với file gốc này trước khi tạo `reviewed.json`. Sau review, giữ bản assessment gốc và fingerprint; gate so sánh phần raw với bản gốc, phần quyết định với reviewed state. Nếu fingerprint reviewed artifact được dùng, tạo nó sau khi ghi thành công và giữ cùng cơ chế state hiện hữu.

Điều này phải bắt lỗi vô tình xóa Jev cao rồi chuyển sang `control-evidence`, hoặc sửa choice/proof/route sau khi review. Không tuyên bố rằng checksum đơn lẻ chống được người có quyền sửa toàn bộ trusted state và mọi hash.

Standalone review/dispatch tiếp tục theo trust model hiện tại, đồng thời kiểm tra đầy đủ sự nhất quán của record v4. Khi native workflow cung cấp bản gốc đã freeze, phải sử dụng nó; không thay bằng một bản assessment do caller tự viết lại.

Không đưa các file mã nguồn mà worker cần sửa vào fingerprint bất biến của approval. Freeze evidence/input liên quan; hash lại live source sau mỗi lần worker sửa sẽ tự làm task hợp lệ bị stale. Những thay đổi spec/context hay chính proof vẫn bắt buộc review mới.

## 9. Jev không khả dụng và lỗi dữ liệu

Giữ đường review `control-evidence` hiện hữu: khi Jev chưa đánh giá thành công và snapshot đủ evidence, Control có thể quyết định rõ ràng với reason, theo các risk/exclusion và native gates sẵn có. Đây không phải correction và không dùng source override.

Không biến lỗi API, timeout, JSON sai hoặc thiếu confidence thành default Easy/Medium-. Không xóa một Jev result hợp lệ để giả lập unavailable. Record đánh dấu EVALUATED mà thiếu answers hoặc khác raw snapshot phải bị từ chối.

Nếu đã có `insufficient_evidence`, không được dùng `--reason` để bỏ qua cho non-Hard; phải giải quyết facts và đánh giá lại. Khả năng Control chủ động nâng thành Hard theo evidence vẫn giữ như baseline. Classification và quyền thực thi vẫn chịu các cổng admission khác.

Đề xuất error identifiers cho các lỗi mới: `CORRECTION_NOT_ELIGIBLE`, `CORRECTION_PROOF_REQUIRED`, `CORRECTION_PROOF_INVALID`, `CORRECTION_BINDING_MISMATCH`, `FALLBACK_NOT_PERMITTED`. Có thể đặt thuộc tính `error.code` và giữ thông báo dễ hiểu. Giữ exit code hiện có: NOT_EVALUATED là 3 ở assessment CLI, validation/dispatch failure là 2 theo CLI tương ứng. Thông báo lỗi không chứa secret hoặc toàn bộ proof/context.

## 10. Chuẩn hóa risk theo hậu quả

Không đổi danh sách sáu flag và không tự suy ra flag từ tên repo, folder hoặc extension.

| Flag | Bật khi task thay đổi gì | Có thể false khi đã xác nhận gì |
| --- | --- | --- |
| `security` | Authentication, authorization, trust boundary, secret access, permission enforcement | Hiển thị nội bộ không đổi quyền, không mở thêm dữ liệu hoặc khả năng truy cập |
| `data` | Hủy/sửa dữ liệu authoritative; sensitive-data exposure; persisted schema/manifest compatibility; ý nghĩa nghiệp vụ | Đọc/hiển thị/filter/sort trong boundary đã biết, không đổi ý nghĩa dữ liệu, không persistence/exposure mới |
| `public_contract` | Interface hoặc compatibility guarantee mà consumer phụ thuộc | Helper private hoặc endpoint mới có contract thực sự giới hạn, không phá consumer/compatibility/trust |
| `architecture` | Ranh giới hệ thống hoặc quyết định kiến trúc hệ trọng chưa giải quyết | Refactor nội bộ giữ boundary, ownership và dependency đã biết |
| `production` | Live cutover, migration, consequential rollout theo phạm vi task | Chỉ tạo candidate/code/fixture cục bộ, không có live execution trong acceptance của slice |
| `routing` | Policy delegation, admission gates, fallback authority hoặc worker ownership | Không đổi các cơ chế này |

Một endpoint gọi là “nội bộ” không tự miễn contract hoặc security. Một port change cũng không tự chứng minh architecture Hard; xét boundary, consumer và hậu quả thực tế. Viết code migration nguy hiểm vẫn có data risk dù chưa chạy live. Read-only vẫn có thể lộ dữ liệu nhạy cảm. Hàm parse/filter thay đổi null, timezone, đơn vị hoặc số liệu được dùng như authoritative có thể đổi ý nghĩa nghiệp vụ.

### 10.1 Quy tắc chứng cứ

Giữ context runnable gồm các string `scope`, `coupling`, `acceptance`, `evidence`; `requirements_confirmed: true`; sáu risk boolean rõ ràng.

- Mỗi flag true phải được Control giải thích bằng hậu quả cụ thể và nguồn: component, table, schema, contract, quyền hoặc hành động rollout liên quan. Không bắt buộc hậu quả đó phải là phá hủy.
- Có thể dùng `context.risk_evidence` dạng map risk-key → string không rỗng, như một số task hiện đã có; không bắt tất cả task nhỏ di trú sang schema phức tạp mới. Chứng cứ đặt trong `context.evidence` vẫn hợp lệ theo policy.
- Nếu flag true chưa có giải thích đầy đủ, không tự đổi false. Giữ Hard về classification và yêu cầu Control giải quyết chứng cứ trước quyết định thấp hơn trên snapshot mới.
- Nếu chưa xác định một flag, bản nháp có thể thiếu/null; khi không có knownHard khác, snapshot đó sẽ NOT_EVALUATED. Nếu đã có flag khác true, giữ ưu tiên Hard classification ở mục 5; các cổng native vẫn yêu cầu đầu vào đầy đủ. Không coi null là false.
- Không dựng bộ NLP/regex tự động “chứng minh” rủi ro từ các từ DROP, DELETE, auth hoặc tên `All_Data`. Validator kiểm tra cấu trúc; Control kiểm tra nghĩa và mâu thuẫn với spec; Jev đánh giá cả snapshot.

Khi sửa một Hard flag thực sự gán sai, giữ assessment cũ, ghi facts mới và nguyên nhân sửa vào task revision, tạo snapshot/assessment mới. Không chỉ xóa cờ để có AGY. Nếu hậu quả vẫn còn, flag vẫn true dù công việc ít dòng.

## 11. Rubric Jev cần làm rõ

Sửa prompt/examples có mục tiêu; không thay model, API contract hoặc thêm câu trả lời giải thích mà provider chưa hỗ trợ.

- **Scope:** chấm phần thay đổi hành vi và coupling; không cộng file đọc để khảo sát, tests, docs hoặc fixture thành boundary mới một cách máy móc. Một boundary có thể cần nhiều file.
- **Uncertainty:** chấm yêu cầu/thiết kế chưa giải quyết ảnh hưởng implementation. Việc phải đọc code để xác nhận caller đã biết không tự bằng quyết định kiến trúc chưa rõ.
- **Risk:** hậu quả thực sự và khả năng đảo ngược; không hạ vì ít dòng, nội bộ hoặc read-only nếu vẫn có trust/data/contract impact.
- **Verification:** chấm công sức tạo detector/oracle và cách kiểm chứng đúng; không đồng nhất thiếu test runner với verification M+/Hard. Một kiểm tra thủ công cụ thể có thể phù hợp mức thấp; “sẽ nhìn qua UI” chưa đủ. Việc viết test tập trung theo oracle có sẵn không tự thành thiết kế kiểm chứng phức tạp.
- **Coordination:** chấm dependency/owner/component cần phối hợp; không tính routine planning, Dely, Control, test, báo cáo là phối hợp M+.

Các burden thật vẫn giữ mức cao: integration checks qua nhiều state/component có thể M+; phải thiết kế oracle hoặc chiến lược kiểm chứng hệ trọng chưa rõ có thể Hard. Đặc tả không ép verification thấp chỉ vì scope/uncertainty thấp.

Thêm paired examples: cùng một thay đổi hiển thị nhưng một task có detector tập trung, task kia có logic bất đồng bộ cần kiểm chứng tương tác; cùng repo dữ liệu nhưng một task chỉ render giá trị, task kia đổi null/đơn vị/manifest. Không kỳ vọng Jev “luôn luôn” trả Medium- cho mọi bounded slice.

## 12. Decomposition theo trách nhiệm và acceptance

Không triển khai một hệ thống planner/DAG mới trong PR này. Cập nhật hướng dẫn và template task hiện có; dùng cơ chế task/run đang tồn tại để lưu liên kết parent/child và dependency.

Một slice hợp lệ cần có outcome, boundary, owner/caller/callee, input/contract, acceptance tự kiểm chứng được và đầu ra bàn giao rõ. Các điều kiện tích hợp hoặc rollout nằm ở task khác phải có owner và dependency cụ thể.

Tách UI và CSS chỉ để mỗi slice ít file không đem lại độc lập; nếu hai phần dùng chung một acceptance, giữ chúng trong cùng slice có thể tốt hơn. Không cắt lớp tạo diff không thể nghiệm thu hoặc chia rủi ro hệ thống thành nhiều mảnh có vẻ vô hại.

### 12.1 Ví dụ ưu tiên từ baseline

Nhiệm vụ tổng thể: sửa feedback của báo cáo và triển khai live.

| Phần | Nội dung | Định tuyến |
| --- | --- | --- |
| Worker implementation | Chỉ sửa hành vi UI đã chốt; fixture, kiểm tra focused; không đổi auth/data/contract và không live cutover | Assess riêng; AGY chỉ khi final Easy/Medium- |
| Integration | Kiểm tra output worker với luồng báo cáo và acceptance của nhiệm vụ tổng thể | Assess đúng coupling thực tế; Sol nếu M+/Hard |
| Live rollout | Cutover/restart live, smoke checks, rollback/retention theo yêu cầu đã có | production=true, Hard, direct Sol/xhigh |

Parent vẫn chứa mục tiêu end-to-end và chưa hoàn thành khi chỉ worker xong. Phân rã không bỏ phần triển khai mà người dùng đã yêu cầu. Một worker không thực thi production có thể có production=false, nhưng các data/security/contract effects của code nó viết vẫn phải đánh giá đầy đủ.

Task con có snapshot mới; không đổi flag trên snapshot cũ vẫn bao gồm cutover. Ghi liên kết parent/child trong metadata task hiện có và context narrative nếu cần; không dùng liên kết đó để cấp quyền runtime.

## 13. File cần sửa và phạm vi trách nhiệm

| File nguồn | Thay đổi cần thực hiện |
| --- | --- |
| `D:\orca\skills\delivery\scripts\task-routing.js` | v4 policy; helpers basis/candidate/proof/validation; optional review JSON; raw result preservation; Sol-only M+; selectedPin và unavailable validation |
| `D:\orca\skills\delivery\scripts\dely.js` | Rà preflight/dispatch/quota/model-unavailable; đảm bảo policy check trước start; thông báo lỗi đúng khi route không có fallback |
| `D:\orca\scripts\jev_agent.js` | Optional proof flag; required/allowed tách biệt; gọi API review mới; giữ output mới, không overwrite |
| `D:\orca\scripts\codex-compliance.js` | Front door JSON; freeze original assessment; dùng validator chung ở review/gate; bảo toàn native trust và worker admission |
| `D:\orca\skills\delivery\scripts\usage.js` | Log raw/final/basis/decision reason code ở dạng tối thiểu, không log prompt/proof đầy đủ |
| `D:\orca\docs\task-risk-policy.md` | Risk definitions, candidate khác approval, correction, Sol-only, unknown, migration v4 |
| `D:\orca\skills\delivery\SKILL.md` | Workflow bounded tasks, review proof, model/fallback policy và trách nhiệm nghiệm thu tổng thể |
| `D:\orca\docs\agent-advice.md` | CLI Jev review mới và ví dụ không dùng shell escaping nguy hiểm |
| `D:\orca\docs\codex-compliance.md` | Native review JSON, freeze proof, validation và refresh runtime đúng quy trình |
| Tests trong `D:\orca\scripts` | Routing, risk-cases, Jev wrapper, compliance, staged dispatch/quota; cập nhật assertion M+ Luna cũ |
| Manifest/version gates của repo | Bump đồng bộ theo `D:\orca\AGENTS.md` khi triển khai thay đổi ảnh hưởng plugin; không đoán số version kế tiếp từ spec |

Đọc các consumer khác của route/schema bằng tìm kiếm có giới hạn. Chỉ sửa monitor/install/test file khác khi consumer thực tế cần thay đổi; không mở rộng thành refactor tổng thể. Documentation được commit vào repo phải theo ngôn ngữ/style tiếng Anh hiện có của repo.

### 13.1 Các phụ thuộc đã xác nhận

`requireApprovedRoute()` đang gọi lại `review()`; `codex-compliance.validate()` cũng gọi lại `routing.review()`. Cả hai phải kiểm tra correction đã freeze bằng validator, không tạo review mới thiếu proof.

`dely.js` có preflight và dispatch paths gọi `requireApprovedRoute()`, và model-unavailable path gọi `verifyUnavailablePin()`. Không chỉ sửa một chỗ in thông báo fallback.

`usage.js` nằm trong `skills\delivery\scripts`, không phải trực tiếp `scripts`. Các wrapper dùng chung nó; tránh tạo một logger hoặc policy copy khác.

## 14. Ma trận kiểm thử bắt buộc

Test deterministic bằng fixtures/mock response, không cần gọi Jev live để xác nhận điều kiện routing. Các test ngữ nghĩa ghi rõ expected human label/reason; mock label không được báo cáo như chất lượng classifier thật.

| ID | Tình huống | Kết quả bắt buộc |
| --- | --- | --- |
| case-all-easy | 5 Easy | Normal review Easy, primary AGY đúng model/effort |
| case-mixed-low | Hỗn hợp Easy/M- | Normal review M-, primary AGY |
| case-known-hard | Mỗi một trong 6 risk true | Hard/direct Sol/xhigh; không gọi Jev |
| case-known-hard-before-missing | Risk true đã biết nhưng thiếu field khác ở router core | Giữ Hard classification trước missing; native prepare vẫn áp dụng yêu cầu đầy đủ của nó |
| case-missing-facts | Không knownHard, risk thiếu/null hoặc requirements chưa confirmed | NOT_EVALUATED; không điền false |
| case-raw-hard-veto | Một Jev Hard, bốn Easy; lặp ở từng chiều và confidence thấp | Không correction; không AGY/Luna |
| case-abstention-veto | Jev có insufficient, kể cả cùng một Hard | Không non-Hard correction/approval; không xóa Hard evidence |
| case-noneligible-high | Chỉ scope, uncertainty hoặc risk ở M+ | Không candidate, giữ Sol khi duyệt M+ |
| case-verification-candidate-retained | Chỉ verification M+, chưa có proof | Candidate nhưng proposed/final normal M+ vẫn Sol |
| case-coordination-candidate-retained | Chỉ coordination M+, chưa có proof | Candidate nhưng chưa cấp route thấp |
| case-multiple-high-veto | Có hai hoặc nhiều M+, kể cả verification + coordination | Không correction |
| case-verification-correction | Một verification M+, proof hợp lệ đầy đủ | Final M-, AGY; Jev raw không đổi |
| case-coordination-correction | Một coordination M+, proof + boundary facts hợp lệ | Final M-, AGY; provenance đầy đủ |
| case-no-proof-downgrade-rejected | Chỉ --reason, không proof, xin M- từ M+ | Reject |
| case-invalid-proof | Proof sai reason/dimension; unknown field; malformed/oversized JSON | Reject, không fallback tự động |
| case-invalid-correction-target | Xin Easy/M+/Hard kèm correction proof, hoặc sửa hai chiều | Reject; giữ/nâng mức dùng normal review không proof |
| case-incomplete-detector | Thiếu detector, expected_result, would_fail_if hoặc coordination facts bắt buộc | Reject cấu trúc; Control không phê chuẩn lời giải thích chung chung |
| case-genuinely-integrated-work | Thực sự cần oracle mới hoặc dependency phối hợp M+ | Control giữ Sol; fixture phản ví dụ được phân biệt với lỗi áp rubric |
| case-unbound-reference | Evidence ref không có trong snapshot hoặc chỉ trỏ file/URL ngoài | Reject; yêu cầu cập nhật snapshot bằng workflow chuẩn |
| case-stale-snapshot | Sửa spec/context sau review; repo/spec khác | Stale/mismatch, không dispatch |
| case-raw-evidence-tampering | Sửa choice/model/probability hoặc xóa Jev khỏi raw EVALUATED | Reject basis/source mismatch; native đối chiếu original frozen file |
| case-proof-tampering | Thay proof/effective_labels/from/to/source/hash hoặc fake candidate | Reject hoặc tính lại không khớp; không tin metadata |
| case-idempotent-validation | Gate chạy nhiều lần với cùng approved record | Cùng quyết định; reviewed_at và raw/proof không đổi |
| case-no-jev-complete-evidence | API unavailable + complete evidence, không Jev hợp lệ | Existing Control-evidence review hoạt động; không source override |
| case-fabricated-low-route-rejected | API failure rồi tự set low/default, hoặc high Jev giả thành unavailable | Không có đường tự cấp thấp; original native evidence phát hiện thay đổi |
| case-sol-primary-without-fallback | M+ primary với fallback=[] | Primary Sol/medium được chọn thành công |
| case-sol-quota-rejection | M+ xin quota Luna hoặc AGY pin | Reject trước worker start |
| case-sol-model-absence-rejection | M+ gặp model-unavailable | Không start Luna/AGY; trả lỗi/chờ rõ ràng |
| case-hard-direct-only | Hard bị gửi Dely hoặc model khác Sol/xhigh | Reject theo Hard path/admission |
| case-valid-low-fallback | Easy/M- quota hoặc model-unavailable hợp lệ | Giữ fallback Luna/max hiện có, đúng phase/pin và evidence |
| case-invalid-fallback-stage | fallback-stage không kèm quota, stage sai hoặc không tồn tại | Reject; primary không bị nhánh stage rỗng tác động |
| case-optional-proof-cli | Cả ba CLI review có/không proof | Option là optional, schema/exit behavior nhất quán; normal review không bắt proof |
| case-end-to-end-proof-admission | Native prepare → review correction → preflight → dispatch → worker admission | Proof sống qua toàn bộ cổng; không cần ghi file proof trái bootstrap |
| case-owner-identity-rejection | Input/review thuộc sai session/turn/run hoặc worker tự review | Các cổng hiện hữu vẫn reject |
| case-legacy-assessment-rejection | v3 assessment đưa vào v4 admission mới | Reject và yêu cầu fresh assessment; lịch sử v3 không bị ghi lại |
| case-snapshot-event-dedup | Log assess/review/retry cho cùng snapshot | Event được giữ nhưng reporting không nhân thành task độc lập |
| case-parent-acceptance | Parent có implementation + live rollout, worker xong | Parent vẫn mở đến integration/rollout acceptance; task con không tự xóa data/security effects |
| case-repository-name-invariance | Đổi tên repo thành All_Data nhưng giữ effects/context tương đương | Logic risk không dùng tên repo; paired semantic fixture giữ cùng nhãn mong đợi |

Nên bổ sung exhaustive test cho hàm thuần aggregation/candidate trên mọi vector 5 chiều của các label được hỗ trợ. Điều này rẻ và bắt lỗi ưu tiên Hard/insufficient hoặc loại bỏ nhầm chiều. Không cần thêm hệ thống benchmark hoặc test mạng dài để kiểm chứng vài điều kiện boolean.

Nhóm case-genuinely-integrated-work, case-parent-acceptance, case-repository-name-invariance gồm cả kiểm tra thiết kế/template hoặc human-labeled corpus; không tuyên bố rằng JS validator đã tự chứng minh các câu văn về rủi ro. Phần routing tương ứng dùng fixture/schema cụ thể để test hành vi thực thi.

### 14.1 Suite và lệnh kiểm tra

Chạy từ repo `D:\orca` bằng Node đã xác định trên máy. Với shell/tool có working directory dạng extended Windows path, truyền absolute test paths và child cwd `D:/orca` như baseline để tránh lỗi đường dẫn.

```text
node --test D:/orca/scripts/test-task-routing.js D:/orca/scripts/test-task-risk-cases.js
node --test D:/orca/scripts/test-jev-agent.js D:/orca/scripts/test-codex-compliance.js
```

Đọc cách chạy hiện hành trước khi chọn lệnh cho `test-staged-dispatch.js` và `test-quota-backup.ps1`; chạy các case bị ảnh hưởng bởi M+ fallback. Giữ tests v3 baseline về SHA, repo pin, quota proof, no-Jev, malformed responses, confidence distribution và version mismatch. Chạy syntax/diff/version gates và quy trình probe tương ứng trong AGENTS.md khi thay đổi launch path yêu cầu chúng.

Không chạy install vào active frozen plan chỉ để làm test pass. Không báo 24 baseline test như số test pass của patch mới; báo riêng baseline và kết quả sau triển khai.

## 15. Observability và đánh giá sau triển khai

Mở rộng event `task_assessment` theo cách additive:

- Giữ taskKey, policy, operation, status, difficulty, workflow, primary, reviewer, jevStatus.
- Thêm `assessment_basis_sha256`, `jev_difficulty`, `known_hard_flags`, `decision_source`.
- Khi có candidate/correction, thêm dimension, reason_code, correction hash; không log toàn bộ explanation, raw spec/context, secret hoặc prompt.
- Giữ việc logging không làm đổi route, output hay exit status.

Ba thước đo hữu ích là số candidate có đủ proof, số correction được Control chấp nhận/bác bỏ, và kết quả nghiệm thu/rework của task sau correction. Đối chiếu các lỗi bị bỏ sót hoặc task thực tế cần Sol với loại correction. Tăng số task AGY không tự chứng minh cải thiện.

Reporting phải phân biệt event, snapshot và nhiệm vụ parent/child. Dùng policy + taskKey cho snapshot; phân biệt assess ban đầu với review/reassessment. Nếu có task lineage thì dùng lineage cho số nhiệm vụ; không giả định mọi snapshot là task người dùng độc lập. Probe/mock và bản ghi thiếu phải có nhóm riêng.

Trước mở correction cho task mới, có thể replay các captured answers cùng snapshot lịch sử bằng logic deterministic để xem candidate nào thay đổi. Replay không tự đánh dấu chúng là false positive; Control phải đối chiếu facts và acceptance. Không sửa assessment hoặc journal lịch sử trong bước này.

## 16. Trình tự triển khai và bàn giao

### Bước A. Chốt baseline và test ranh giới

Đọc `D:\orca\AGENTS.md`, policy, delivery skill và các test liên quan; kiểm tra HEAD/dirty state. Viết test cho Sol-only M+, primary với fallback rỗng, no-Jev và correction bị từ chối trước khi đổi logic. Bảo toàn thay đổi của người khác.

### Bước B. Core router và proof

Thực hiện v4 schema/basis/candidate, validator, correction, raw preservation và route table. Dùng helper chung, tránh copy thuật toán max/candidate giữa các file. Chạy routing/risk tests và các counterexample bắt buộc.

### Bước C. Các front door và admission

Nối optional JSON qua Jev CLI và compliance review; freeze original assessment; thay các gate tái gọi review bằng validation. Kiểm tra đường native hoàn chỉnh, kể cả flag optional và quyền worker. Rà mọi preflight/dispatch/fallback để không start model trái route.

### Bước D. Rubric, task templates và journal

Cập nhật định nghĩa/evidence, paired examples, decomposition instructions và logging tối thiểu. Không xây planner mới hoặc bổ sung gánh nặng proof cho mọi task thấp. Sửa docs và model mapping để không còn mô tả Medium+ → Luna.

### Bước E. Version, compatibility và kiểm tra release

Policy mới là `jev-task-routing-v4`. Bump version package/manifests/gates đồng bộ theo repo; kiểm tra consumer NATIVE_SCHEMA và bump nếu thay đổi hợp đồng persisted state thực tế yêu cầu. Bản v3 tiếp tục dùng làm lịch sử; admission mới của v4 phải assess/review mới, không sửa nhãn policy trong file cũ.

Các plan đang chạy trên snapshot plugin đã freeze phải giữ bản đó. Refresh plugin/runtime theo install/release flow hiện hữu giữa các plan; không sửa cache đang dùng giữa lượt. Kiểm tra các Codex home đang hoạt động nhận đúng router/advisor/dependencies khi đến bước refresh. Baseline đã thấy default home và Orca runtime home cùng tham chiếu bản plugin cài đặt; chỉ sửa source repo chưa cập nhật runtime đó.

### Bước F. Hồ sơ dev cần trả

1. Patch/code và danh sách file thay đổi, với lý do từng nhóm.
2. Policy/docs tiếng Anh theo repo và ví dụ proof JSON thực sự parse được.
3. Kết quả các test bắt buộc, regression/fallback gates, syntax/version/probe theo phạm vi thay đổi.
4. Một ví dụ normal low review, một M+ giữ Sol, một correction hợp lệ thành M-, và một Hard bị từ chối correction.
5. Xác nhận M+ không có Luna/AGY ở cả quota và model-unavailable; Hard không qua Dely.
6. Ghi rõ bản source và bản installed runtime nào đã được kiểm tra/cập nhật theo release flow; không đánh đồng chúng.
7. Báo phần còn thiếu chứng cứ hoặc consumer chưa xử lý; không dùng tỷ lệ AGY để thay cho acceptance.

**Definition of Done:** mọi đường thực thi tuân ma trận route; correction chỉ hợp lệ trong vùng đã định nghĩa; raw evidence và snapshot không bị mất; normal low tasks không phát sinh hồ sơ mới; tests/gates liên quan pass; docs, phiên bản và runtime handoff nhất quán.

## 17. Nguồn đã đối chiếu

Các đường dẫn dưới đây là nguồn local Windows đã đọc, không phải đường dẫn tải xuống của tài liệu này. Tên hàm được dùng thay line number vì patch sẽ làm số dòng đổi.

- **source-router Router:** `D:\orca\skills\delivery\scripts\task-routing.js`; `loadTask`, `missingEvidence`, `knownHard`, `questions`, `validateAnswers`, `assess`, `review`, `requireApprovedRoute`, `selectedPin`, `verifyUnavailablePin`.
- **source-policy Policy:** `D:\orca\docs\task-risk-policy.md`, baseline `jev-task-routing-v3`.
- **source-callers-and-logging Callers và logging:** `D:\orca\scripts\jev_agent.js`; `D:\orca\scripts\codex-compliance.js`; `D:\orca\skills\delivery\scripts\dely.js`; `D:\orca\skills\delivery\scripts\usage.js`.
- **source-historical-evidence Lịch sử:** `C:\Users\Home33\.dely\log.jsonl`; snapshots trong `C:\Users\Home33\.codex\dely-compliance\tasks` và `C:\Users\Home33\AppData\Roaming\orca\codex-runtime-home\home\dely-compliance\tasks`, theo cutoff và cách nhóm ở mục 2.
- **source-ui-rollout-samples Mẫu UI + live rollout:** các snapshot `a4030cf99136738ad08ba4c6` và `05f2e623d34b520e7c9da8e2` trong thư mục tasks của default home; spec/context bao gồm live activation, không chỉ code UI.
- **source-data-sample Mẫu data:** snapshot `4fd18e6b733e0bffad8451a5`; context.risk_evidence nêu persisted dataset/manifest compatibility, identity/null/value và pointer atomicity; không có production không đồng nghĩa không có data risk.
- **source-hard-semantics-samples Semantic Hard:** snapshots `14f29b925de2070bc2dd3940` và `2aae67b1011afadccdb73fdf`; mỗi mẫu có scope/uncertainty/risk/coordination Medium+ và verification Hard.
- **source-regressions Tests:** `D:\orca\scripts\test-task-routing.js` và `D:\orca\scripts\test-task-risk-cases.js`, baseline 24/24 pass với Jev mock.
- **source-workflow Workflow/version:** `D:\orca\AGENTS.md`; `D:\orca\skills\delivery\SKILL.md`; `D:\orca\docs\codex-compliance.md`; `D:\orca\docs\agent-advice.md`.
- **source-installed-runtime Runtime đã đối chiếu:** `C:\Users\Home33\.codex\plugins\cache\dely-orca-agy-global\dely\0.27.2\skills\delivery\scripts\task-routing.js`; baseline SHA-256 trùng source: `eb12f46e5b9c574c303965c9cc6ee1c2cceecce685e1a2b470b00b71e6771676`. Kiểm tra lại các version thực tế khi triển khai; số cache này không phải yêu cầu giữ version cũ.
