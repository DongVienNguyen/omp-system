# OMP full system specification

Status: PROPOSED, chưa implementation. Một release bao phủ F01–F12. [Audit và source pins](OMP_SYSTEM_AUDIT.md) là căn cứ hiện trạng; [plan](OMP_IMPLEMENTATION_PLAN.md), [acceptance/runbook](OMP_ACCEPTANCE_AND_OPERATIONS.md), [machine plan](omp-plan.json) là contract thực thi sau phê duyệt.

## Quyết định kiến trúc

Package `omp-system` trong `C:/Users/dongnv/.local/share/omp-system` (source root dự kiến). Một extension mỏng OMP làm entry/status; một coordinator trong phiên primary sở hữu task DAG, routing, budget và formal gate. Worker/reviewer/proposer/composer/selector/reflector là OMP SDK sessions được coordinator tạo và giám sát; không ai tự tạo controller khác. Control commands không chạy một daemon tồn tại ngoài phiên. State bền trên disk để phiên primary mới reconcile.

Tái dùng OMP SDK/session/tools/model registry và AK skills/agents/rules hiện có. Native pstack integration là reuse candidate ưu tiên nhưng không nạp nguyên extension cạnh controller: import phần phù hợp sau proof, port adapter và namespace collisions. Không thêm dependency nếu Bun/Node stdlib + OMP SDK đáp ứng. SQLite dùng `bun:sqlite`, không thêm ORM. Không yêu cầu Python/Go runtime cho target: Harness² method port TypeScript với differential fixtures từ source Python pin; Python chỉ có thể dùng trong development parity check nếu sẵn.

Chọn phương án này thay:
- Nguyên Firstmate + no-mistakes + pstack + Harness² stack: nhiều scheduler, ACP/agent CLI, shell/platform assumptions và duplicate routes.
- Prompt/checklist-only: không enforce digest/ownership/budget/persistence, không thật sự chạy candidate hay độc lập reviewer.
- Tự viết lại AK/tools/Git abstraction: mất baseline và tạo hai convention không cần thiết.

OMP endpoint do người dùng cấu hình; không thay gateway hoặc thêm model router. Package chỉ chọn selector và effort đã được duyệt. Extension không là security sandbox. Khi cần chạy code candidate, dùng worker với trust boundary thật; thiếu boundary thì BLOCKED, không coi worktree là sandbox.

### Bổ sung 2026-10-25: phát triển cạnh project đang chạy

Chọn workspace source hiện có `C:/Users/dongnv/.local/share/omp-system` làm repo riêng; không worktree từ repo đang làm, không mở thêm project bằng `--add-dir`. Mọi fixture/app/worktree thử nghiệm nằm trong `.lab/workspaces` của repo này. Tài liệu giữ nguyên vị trí. OMP thực thi tạo và quản lý môi trường sau khi được duyệt; người dùng không phải tự chuyển/cấu hình workspace.

Hai profile riêng `omp-system-dev` (link source) và `omp-system-install-test` (cài Git sạch), được launcher scope vào child process, không set environment cấp user/machine. Trên Windows18.12.6, roots dự kiến `~/.omp/profiles/<name>/{agent,plugins}`; phải resolve/realpath và kiểm trùng trước mutation. Không mặc định profile là sandbox: native caches/daemon scopes có thể shared; SDK/custom state/TEMP/Bun cache phải được kiểm riêng. Named profile không bảo vệ arbitrary plugin code truy cập file ngoài scope; trust boundary B02 vẫn giữ.

Launcher PROPOSED `scripts/dev-launch.ps1`/`scripts/dev-preflight.ts`: explicit OMP executable + profile + source cwd + session-dir + controlled overlay, no autoResume/restore, no inherited agent-dir override, no foreign MCP/extensions/shell startup hooks. Preflight resolve toàn bộ settings/auth/models/sessions/plugins/cache/log/state paths, reject junction/outside allowlist và tên profile đã có foreign content; không reuse/copy toàn bộ `~/.omp/agent`. Bootstrap AK snapshot chỉ các instruction/skill/agent/rule cần thiết, có source hashes và license; không copy hooks/MCP/cache/history/memory. Auth dùng env credential process-local từ nguồn được duyệt hoặc đăng nhập vào profile mới; không ghi secret vào repo, command line hay logs, không đổi auth profile mặc định. Thiếu credentials => live test BLOCKED, offline work vẫn làm được.

Protected scope: project khác không được discovery/scan nội dung/checkout/build/test/kill/restart; default `~/.omp/agent`, `~/.omp/plugins`, managed AK và runtime integrations không bị sửa. Native profile mới là allowlist exception dưới `~/.omp/profiles/`; chỉ ghi đúng roots đã resolve. Read-only fingerprint config và AK được phép; không hash DB đang ghi làm bằng chứng rollback. Drift do phiên khác phát sinh chỉ báo/đối chiếu, không tự restore. Không upgrade OMP/Bun/AK global, không `doctor --fix`, broad plugin upgrade, config migrate hay global registry mutation. Nếu shared path không cách ly được thì dừng case đó, không thay đổi global để chạy tiếp.

Coexistence mặc định một managed worker/model request đang chạy, một live experiment; giới hạn một run trong lab. Concurrency2 của spec là ceiling production, không mục tiêu dev. Fixture/offline checks trước; live có budget/deadline rõ, 429 dừng launch mới và báo, không retry storm. Dùng RAM/CPU/disk headroom admission từ OS trước launch; thiếu measurement thì không auto-launch heavy run. Giới hạn process priority thấp nơi native API đã chứng minh. Không hứa zero latency/quota impact: CPU/RAM/disk/network/API vẫn dùng chung; không thể hard-isolate quota bằng profile.

### Plugin Git distribution contract

Package `omp-system` là OMP plugin native, không app CLI/daemon điều phối riêng. Root `package.json` có name/version/engines/license, `omp.extensions` trỏ entry đóng gói, files allowlist, OMP compatibility pin. Ship runtime files hoàn chỉnh từ Git release commit/tag; không cần người dùng tự build TypeScript hay chạy setup copy config sau install. Ưu tiên TypeScript được loader hỗ trợ hoặc runtime artifacts commit sẵn có CI reproducibility; không rely postinstall/prepare/trusted dependency scripts. Không bắt buộc npm publish/marketplace; Git remote/release tag chỉ quyết định khi có quyền publish.

Entry chỉ register namespaced command/tool/status; không inference/job/network/discovery project ngoài ý muốn khi load. Enable theo canonical project + profile, mặc định off, không tự sửa AGENTS/config/models/MCP hoặc thay default chat. Không tự khởi động worker, migration state hay load candidate extensions khi import. Bất kỳ dependency bắt buộc phải resolve được bằng native Git install và được clean-install proof; runtime SDK import cùng host không duplicate version/state. Đặc biệt không giả định manifest `omp.skills`/`omp.agents` hoạt động: entry/discovery adapter phải dùng API đã kiểm chứng để expose assets, giữ AK ownership.

Development: `omp --profile omp-system-dev plugin link <source-root>`; chỉ profile riêng, không bare global link. Distribution: `omp --profile omp-system-install-test plugin install github:<owner>/<repo>#<release-ref>`; source syntax có thật, owner/repo/ref chưa có nên template không phải command đã chạy. Trong18.12.6 `--scope project` bị ignore cho Git/local sources; KHÔNG dùng nó làm isolation. Hai route link và Git install không dùng chung profile/path. Update/rollback cài exact ref đã kiểm, lưu resolved commit/dependency lock và state version; không dùng broad `upgrade` theo branch trôi. Uninstall dùng native plugin command trong đúng profile, data retention riêng. Chỉ rollout default/user profile nếu người dùng duyệt riêng và không thay active phiên đang chạy; mặc định bàn giao standalone dedicated profile dùng lâu dài.

Traceability bổ sung: T00/F01,F04,F09,F10,F12 → A13 coexistence; T17/F01,F12 → A14 Git lifecycle; T18/F01,F04,F09,F10,F12 → A13 independent noninterference. A01–A12 và toàn F01–F12 không bị thu hẹp. T00 precedes T01; T17 sau T03; T18 sau T08/T17; T16 sau T14/T15/T17/T18. Implementation vẫn NOT AUTHORIZED.

## F01–F12 — phạm vi bắt buộc trong cùng release

|ID|Hành vi đích / owner|Acceptance chính|
|---|---|---|
|F01|Một chat OMP làm đầu mối; native inventory AK dùng được, namespace riêng, enable/disable theo project/profile; controller `src/coordinator.ts`|A01: fresh install/load once, tag/skill discovery, baseline hashes giữ nguyên; disabled project không kích hoạt|
|F02|Goal/acceptance, DAG, ownership, dispatch/monitor/steer/collect/integrate/deliver; `src/tasks.ts`|A02: dependencies, blocked/dead/cancelled, bounded retry và phase transition không chờ gõ tiếp|
|F03|Difficulty trước dispatch, exact profile, resource budget/cost evidence; `src/routing.ts`, `src/budget.ts`|A03: easy/medium/hard và concurrent mixed roles có receipt đúng; không leak model/fallback|
|F04|Snapshot/worktree, one writer per scope, conflict-safe patch integration; `src/workspaces.ts`|A04: dirty/staged/untracked/config included, nonoverlap concurrent writers, overlap rejected, conflict/data retained|
|F05|Intent, required checks, fresh independent review, findings/repair/review và delivery gates; `src/gate.ts`|A05: stale/forged/partial/missing/zero-test/timeout/cancel không PASS; candidate mutate invalidate|
|F06|pstack workflow/principle/playbook inventory, core how/why/architect/arena/interrogate/blast-radius/verification thật; `src/pstack.ts`|A06: complete inventory fidelity map, core workflows execute/verify artifact; không file SKILL-only parity|
|F07|Harness² recursive method trong OMP, repository-task adapter, parallel/seq, evidence/selection/reflection/library; `src/harness/*`|A07: differential trace k1/k2 cả modes; candidate chạy cùng task; live bounded rollouts + task sau dùng experience|
|F08|Tám harness surfaces có mapping/materialization/runtime proof; method adoption khác production promotion; `src/harness/surfaces.ts`, `src/promotion.ts`|A08: từng surface active và reject bypass; acceptance/regression frozen, baseline không thay khi candidate fail|
|F09|Durable state, resume/branch/restart, cancel descendants, no ghost PASS/duplicate; `src/state.ts`, `src/processes.ts`|A09: interruption fault injection + actual cold restart/reconcile/cancel; unknown worker không auto replay|
|F10|Status task/snapshot/review/experiment linkage, logs/artifacts/usage, bounds và intervention; `src/status.ts`|A10: usage actual/estimate/UNKNOWN tách biệt, no spin, hard concurrency/depth/retry/rollout bounds|
|F11|Delivery bug/feature/refactor/docs/lint/push/PR/CI theo quyền, local khác remote; `src/delivery.ts`|A11: local handoff verified, remote with explicit authority; missing credentials không remote PASS|
|F12|Package/version/pin/install/uninstall/update/doctor/rollback và ownership migration; `src/lifecycle.ts`|A12: Windows paths/ACL/version rejection, upgrade/rollback preserves foreign/modified files, load once|

## Module boundaries và quyền sở hữu

Mọi path dưới đây PROPOSED. Không khai báo là API upstream.

|Boundary|Owns|Không được làm|
|---|---|---|
|`src/extension.ts`|Register `/omp-system` command + namespaced tool `omp_system`; per-session generation; render status; await coordinator barriers|Không tự certify, không module-global running-jobs map, không kết thúc khi registry còn unresolved owned work|
|`src/coordinator.ts`|Only top-level dispatcher; owns RunContext, queues và cancellation root|Không nhường dispatch authority cho worker; không chạy nested controllers từ pstack/AK|
|`src/contracts.ts`|Versioned packets, validators, JSON boundary, state transitions|Không tin output model chỉ vì JSON parse được|
|`src/runtime.ts`|OMP SDK adapter, session discovery boundary, model binding, structured result, lifecycle/disposal|Không tạo giả per-call `task.model`; không dùng ephemeral side turn làm review|
|`src/tasks.ts`, `routing.ts`, `budget.ts`|DAG scheduling, immutable decision, exact selector + slot reservation|Không sửa global config theo task, không silent model substitution|
|`src/workspaces.ts`, `processes.ts`|Snapshot, writer leases, candidate worktrees, supervised processes|Không destructive cleanup dirty/unlanded work; không shell kill bằng PID không xác minh identity|
|`src/gate.ts`, `src/review.ts`|Only certifier; fresh reviewer contexts; findings lifecycle|Không coi prose DONE hoặc upstream routine succeeded là PASS|
|`src/pstack.ts`, `vendor/pstack/**`|Method adapter và pinned non-AK content, namespaced workflows|Không auto-load second extension/controller, không tự chọn ngoài pool|
|`src/harness/{spec,recursion,selection,library,surfaces,repository-task}.ts`|Faithful method semantics và surface materialization|Không đổi upstream method thành hillclimb single prompt, không dùng grader secrets làm evidence|
|`src/promotion.ts`|Production policy adoption only after separate certifier + explicit authority|Không dùng published selection winner làm quyền thay active baseline|
|`src/state.ts`|Versioned SQLite, immutable content-addressed artifacts, ownership/leases/reconcile|Không lưu credentials, không lẫn project/session/model/library scope|
|`src/status.ts`, `delivery.ts`, `lifecycle.ts`|User-visible operations, native Git/provider delivery, package lifecycle|Không tự publish audit/plan, không runtime dependency agent CLI khác|

Nguồn custom không nằm dưới AK ownership. Reference installed `ak-*` skill và active agent definition đúng casing; snapshot fingerprint lúc dispatch. Foreign integration Crews/AgentMemory/Context Mode/CodeGraph giữ nguyên. Unknown package registration: doctor phát hiện trước enable, không tự xóa hay disable. Crews native task có policy riêng: không chèn model hook tranh ownership; managed `omp-system` SDK workers dùng namespace/context riêng, tương tác Crews chỉ qua admitted interface nếu task thực sự yêu cầu, không dùng nó làm control plane thứ hai.

## Dataflow và contract nội bộ

Trust boundaries: user/operator policy tin cậy; repo content/task files/model output không tin cậy; reviewer policy không lấy từ candidate; control process/certifier code không candidate-editable. Runtime validation required mọi command/tool/file import, normalized realpaths, reject path escapes/junction/UNC ambiguity và schema version không tương thích.

### Records

|Record|Trường bắt buộc / invariants|
|---|---|
|`RunContext` v1|`run_id`, canonical `project_id`/realpath, `session_id`, generation, `policy_digest`, `baseline_digest`, intent/requirements/check-plan refs, authority refs, `budget`, cancel state. Project path + repo identity, không chỉ path prefix|
|`TaskRecord` v1|`task_id`, run, requirement_ids, depends_on, goal/acceptance refs, read/write scopes, base snapshot, ownership lease, workflow, difficulty, risk rationale, state, attempt, child/command refs, output refs. No cycle/missing dependency|
|`DispatchPacket` v1|Unique `dispatch_id`, task/attempt/generation, immutable `snapshot_digest`, exact `model_selector`, `effort`, declared capabilities/tools, trusted context refs, untrusted input refs, output schema, limits, writer lease, expiry. Reserved before child launch, consumed once|
|`WorkerReceipt` v1|Dispatch/snapshot/policy ids, resolved provider/model, requested and observed wire effort, invocation/session id, actual fallback attempts, start/end, status, usage source, artifacts/logs. Unknown observable fields = UNKNOWN, not desired value|
|`SnapshotManifest` v1|Base commit, canonical relative path, kind/mode, tracked/staged/worktree/untracked relevant bytes, relevant project config; generated/ignored inclusion policy frozen before review. Stable sorted encoding + SHA256; symlink target captured/rejected per policy|
|`CheckPlan` v1|Immutable check ids, commands as argv/cwd, expected discovery/test selection, accepted no-test condition if explicitly applicable, runtime/app observation requirements, coverage scope, timeout, owner. Not commands supplied by implementer after review|
|`CheckEvidence` v1|Check id, candidate/base/policy digests, exact command, observed exit/status, discovered/selected test counts when runner exposes them, stdout/stderr artifact digests, actual observation, owner, timestamps, execution/session identity. stdout text alone not certificate|
|`ReviewResult` v1|review_id, candidate/base/check-plan/policy digests, full reviewable_paths, reviewed_paths, reviewer identity/session, findings with ids/severity/location/evidence, tool/command refs, completion state. Coverage subset/intersection validated by certifier|
|`GateCertificate` v1|certificate id, project/run/task/candidate/base/check-plan/policy digests, evidence/review refs, required coverage status, unresolved blocking findings count, LOCAL_VERIFIED or REMOTE_VERIFIED, signer/control-process identity, status, invalidation reason. Only certifier owns writes|
|`ExperimentRecord` v1|method version/source pin, adapter/substrate version, task/base/surface digests, mode/k/seed, stage/rollout/selection/reflection ids, scope, bounded budget, outcome; distinct selection and promotion states|
|`ExperienceEntry` v1|project/domain/model-profile/version scope, source task/experiment/harness provenance, evidence refs, distilled experience, contamination checks, eligibility and status. No secret/grader/hidden test output|

Artifacts hashed and immutable after publication. SQLite references artifact digest, never mutable filename as identity. Large output lives outside conversational context; summaries retain link/digest. Deletion is explicit ownership-aware retention, not implicit on task completion; preserve unresolved evidence/workspaces.

### State machines

Task: `PLANNED → READY → RUNNING → VERIFYING → LOCAL_VERIFIED → DELIVERING → REMOTE_VERIFIED/DELIVERED`. `BLOCKED`, `FAILED`, `CANCEL_REQUESTED → CANCELLED` are explicit alternatives, not success. Local-only authorized deliverable may become DELIVERED with LOCAL_VERIFIED certificate; status retains local scope. Repair reopens a new attempt/snapshot, not editing old certificate. Dependency readiness requires required predecessor state, not any terminal state. User intervention checkpoint is durable.

Review/certificate: `PENDING → RUNNING → VALID/INVALID/BLOCKED`; mutation supersedes old result. Certificate invalidation is monotonic for that candidate identity; new cert requires new evaluation. Delivery rereads/recomputes digest immediately before external action and checks authority again.

Worker/process: `RESERVED → STARTING → RUNNING → EXITED → SETTLED`; `UNKNOWN/ORPHANED/CANCEL_REQUESTED` require reconciliation. Idle event/final assistant text never substitutes EXITED+SETTLED. Cold resume validates PID plus process start identity/session ownership, artifact completeness and lease generation. Unknown isolated worker is not relaunched automatically; mark BLOCKED and preserve workspace until reconcile/recreate with a new attempt.

## Routing, budget và concurrency

1. Primary decides difficulty from task complexity/risk/ambiguity before dispatch. Role name không định difficulty. Hard = Astra/low; medium = Sol/high; easy = Seek/high. Từng helper của reviewer/proposer/composer/selector/reflector cũng có DispatchPacket.
2. Capability validation precedes spend. Seek text-only không được nhận task bắt buộc image; chọn mức phù hợp có capability với rationale trước dispatch hoặc BLOCKED. Không đổi effort/profile sau resolution để né lỗi. Fallback chỉ theo edge explicit trong approved RunBudget; mặc định không fallback. Advisory `fable` từ AK không tạo quyền ngoài pool.
3. Primary default conversation vẫn Sol/high nếu không được người dùng đổi; managed workers có exact local model option. Không đổi global roles/agent overrides. SDK `createAgentSession` có model explicit; agent prompt/tools/schema được resolve từ installed definition bằng adapter được kiểm thử. Public `omp_system dispatch` là internal API dự kiến, không API upstream.
4. Preferred execution là SDK session per immutable packet, private AgentRegistry, private settings/discovery, exact model and effort. Native task path chỉ được enable khi T01 chứng minh spawnKey/descriptor binding không collision và hook composition; hook event không có task text. Unbound managed spawn bị block; unrelated OMP calls giữ nguyên.
5. Hard scheduler limits: concurrency 2 toàn managed run; helper count không bypass bằng SDK direct call. Depth native task max1; recursive Harness² stages chạy do primary iterating DAG, không worker recursive spawning. RunBudget có `max_worker_calls`, `max_rollouts`, `max_stages`, `max_transport_retries`, `max_repairs`, deadline và token/output caps do người dùng/quy trình duyệt trước. Mọi reservation atomic trước launch.
6. Chi phí: record tokens/provider usage/latency và spend khi endpoint có giá đáng tin; actual/estimate/UNKNOWN riêng. Không suy USD từ alias hoặc stage-count. Budget USD UNKNOWN không được báo miễn phí; enforce count/token/time caps thay vì giả cost cap đáng tin.
7. Bounded retry chỉ transport classification được ghi; repair là task attempt riêng. Không timeout loop/retry vô hạn; deadlock/blocked dependencies báo primary. Event-driven monitor, bounded timers; không token polling khi worker chưa actionable.

## Workspace, reviewer và gate

Snapshot bao gồm relevant dirty/staged/untracked/config, không chỉ HEAD. Relevant excluded files và rationale nằm trong frozen manifest. One writer lease per normalized path range; overlap reject trước spawn. Candidate/arena/experiment writer ở separate Git worktree/base snapshot; apply patch chỉ khi base/current expected digests khớp. Primary alone integrates; conflict giữ patch/worktree và đánh BLOCKED, không force overwrite/stash mất dữ liệu.

Reviewer là fresh OMP SDK session, context/tool boundary explicit: trusted intent/check-plan/policy, candidate snapshot read-only và bounded source facts. Không share conversation implementer, memory write, project MCP/extensions/commands hoặc ambient context discovery. Không dùng `runEphemeralTurn`. Repository instructions được đọc như untrusted evidence nếu relevant, không thay reviewer policy. Candidate-controlled compiler/tests vẫn executable untrusted code; checks chạy trong controlled worker process với env/credentials tối thiểu, write allowlist và network policy đã kiểm chứng. Khi không có native OS sandbox đáp ứng threat model, operator phải duyệt trust level của repo/candidate hoặc executable surface phải BLOCKED; không gắn nhãn sandbox cho child process/worktree.

Formal PASS chỉ certifier deterministic sau khi kiểm đủ: current candidate/base/policy/check-plan digests; no pending owned jobs; required commands exit0 và test discovery/selection hợp lệ; coverage complete; actual runtime evidence theo check-plan; schema-valid completed reviewer; unresolved blocking findings=0; no timeout/cancel/missing logs. Check có zero tests hoặc missing runner coverage phải fail/BLOCKED, trừ check-plan trước đó chứng minh task không cần loại test đó và yêu cầu proof thay thế rõ. Hook error/exception không cấp PASS. Adversarial test runner kiểm độc lập cert DB/status, không tin gate tự nói PASS.

Findings: stable id + evidence, blocking/nonblocking classification của trusted policy. Repair worker không sửa findings/certificate, chỉ tạo candidate mới; review mới và required checks chạy lại, không dùng stamp cũ. Superseded background completion không thể restore cert. Structured model output malformed/missing fields bị reject, không parse prose DONE thành PASS.

## pstack fidelity

Inventory pinned original và hai port, từng skill/playbook/principle có disposition `reuse`, `adapt`, `native-equivalent`, `blocked` và executable verification id. Release không được có `blocked` cho functional scope yêu cầu; features ngoài yêu cầu như Cursor-only automation phải mô tả giới hạn adapter, không claim copied catalog = runtime parity.

- How: partition complex system thành independent read-only angles, synthesize Overview/Concepts/Flow/Locations/Gotchas.
- Why: ground source control/history và evidence coverage, tách FACT/INFERENCE/UNKNOWN.
- Architect: How trước, Why khi đổi ownership/layering; ít nhất hai cấu trúc khác nhau qua arena, compare interface depth, synthesize rationale/callers/types/module boundaries.
- Arena: task/rubric giống nhau, candidate output/workspace riêng, N được duyệt (scheduler2 queue không giảm N), cross-judge pool khác nếu có thể, primary đọc/scoring/base selection, graft có chủ đích rồi chạy verify artifact.
- Interrogate: independent adversarial reviewers, same intent/context/rubric, agreement/disagreement map + Act on/Consider/Noted/Dismissed; không tự fix.
- Blast-radius: critical fact → failure path → runnable check → actual app proof; report cleared/risk/missing proof/cheapest premerge check.
- Verification skills: map feature/repro from repo, run actual app surface; prompt-only conclusion không đủ. Other playbooks reuse installed AK equivalent only if exact semantic acceptance traced, không đổi tên để bỏ hành vi.

`pstack_agent` lookup không spawn. RoutineRunner empty-tool completion không ứng dụng verification. Port native command ownership collision checks; bare name conflicts không overwrite foreign owner. Windows path/ACL defects và SDK pin18.12.6 phải được resolve trước release.

## Harness² method và surfaces

Adapter nội bộ giữ shape source [spec/substrate](OMP_SYSTEM_AUDIT.md): preflight, frozen task input, materialize, execute same task per candidate, collect trajectories/deliverable/observations, judge independent hidden regression outside proposer evidence. Preserve method core exact revision, retry/fallback semantics declared. Research scale 4k/3k không là runtime target bắt buộc; no scale-benefit claim chưa có nguồn và đo.

Parallel k: propose 2k independent INV/DOM from same base, run each; compose k independent harnesses từ shared evidence, run each; finals agg1..aggk. Sequential k: mỗi vòng 2 proposals from current harness + prior evidence, rollout, compose ct, rollout, carry current/history; finals c1..ck. k1 trace equivalence về shape; k2 phân biệt rõ width/depth. Ledger stage label order deterministic sau concurrent drain, cache fingerprint gồm complete task/base/policy/adapter/model/surface inputs, không chỉ prompt. Rejected/no-op/missing artifact semantics có trace, không fake fallback deliverable.

Selection giữ finals-only, loại missing/failed deliverables, anonymous ids stable, k1 trivial selection; malformed selector fallback ghi rõ không ok, không production success. State-deliverable phải explicit adapter contract. Reflection chỉ từ eligible adopted method result; experience bao gồm decisions/harness deltas/trajectories/deliverable, contamination scan; persisted scoped project/domain/model/version. Task sau retrieve eligible experience và prove dùng bằng input provenance; restart giữ lineage. Không lẫn experience thử nghiệm với active policy.

|Surface|Materialization / runtime proof dự kiến|Trust ceiling|
|---|---|---|
|System prompt|Explicit SDK system prompt for candidate; sentinel behavior scenario|Không đổi coordinator/checker policy|
|Guardrails|Candidate-owned worker rules/context via explicit isolated input; boundary behavior test|Không relax tool/certifier/budget guards|
|Memory|Experiment-local memory store/experience input, no global AgentMemory mutation; second-task retrieval proof|Không leak project/model/version hoặc grader|
|Tool guidance|Explicit tool descriptions in worker bundle + invocation observation|Cannot change privileged tool allowlist by prose|
|Subagents|Isolated generated agent definitions, exact model pool, primary-admitted child tasks; task transition proof|No nested coordinator/depth bypass|
|Skills|Isolated namespaced discovery roots or explicit skill input; loaded/used proof|No arbitrary host AK overwrite|
|Scripts|Validated candidate paths, controlled execution boundary, behavior/side-effect proof|No unsandboxed host-wide execution; blocked absent approved trust boundary|
|Plugins/hooks|Candidate extension loaded ONLY separate worker with controlled config/tools; event+side-effect observation|In-process arbitrary code, separate process not OS sandbox. For untrusted plugin need OS boundary or explicit operator trust authorization; otherwise release acceptance BLOCKED|

Method selection có thể chọn candidate kém vì baseline bị loại theo upstream. `src/promotion.ts` giữ active baseline vào safety comparison riêng: frozen acceptance/regression, actual new task verification, policy/version digest, independent reviewer, explicit adoption authority. Failure/rejected candidate không đổi active config. Successful method adoption/experience learning không tự production promotion. Support all eight surfaces is release requirement; unsupported one is blocker, không silently narrow thành prompt-only.

## Persistence, observability và delivery

SQLite transaction ghi transitions/reservations/leases/jobs/certificate refs; artifact writes temp+flush+atomic rename trước publish refs. WAL/busy handling Windows, crash recovery và schema migration tested. Process ownership dùng run/session/generation/start-time identity; reject stale callbacks. Control status reports current model/effort, pending workers/checks, blockers, snapshots, logs and intervention, not generic done prose.

Cancel: durable intent, refuse new reservations, abort SDK, terminate owned commands and descendants, settle/record evidence, retain workspaces. Recovery: classify alive/dead/unknown jobs, revalidate current digests+certificates+leases; no automatic replay of unknown workers. Fork creates new lineage; cannot inherit fresh review if snapshot/policy changes.

Delivery defaults local-only. Push/PR/merge/deploy each require authority matching action/repo/ref; approval not inherited from technical review. Native Git argv and provider API/approved native tool, no other agent CLI. CI evidence required from remote run head matching candidate before REMOTE_VERIFIED. Missing permissions/credentials => BLOCKED/NOT RUN remote, preserve local verified result. Ordinary coding behavior continues outside enabled managed runs.

## Release invariants

One dispatcher, one routing policy, one certifier. Complete F01–F12 traceability. AK unchanged or explicit sanctioned update with new baseline; no hidden upgrade. Source pins/compatibility exact. Windows actual run proof. No remote claim from local green. No unbounded self-improvement. No source-only/document-only surface marked runtime-tested. Never promote experiment policy by selection alone. Approval of this spec authorizes planned local implementation only when user explicitly grants it, not publishing/destructive changes.
