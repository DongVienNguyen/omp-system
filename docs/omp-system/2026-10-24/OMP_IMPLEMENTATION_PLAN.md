# OMP implementation plan — single complete release

Status: original F01–F12 local functional acceptance complete after explicit user recovery authorization 2026-10-28. Same-source24runtime scenarios and127tests pass; independent safety reviews COMPLETE. Current draft-head hosted verification tracked separately in acceptance/runbook. Historical failures retained; exact-reviewed trusted-code boundary and catalog capability limits remain explicit. No production/default-profile rollout or merge/deploy performed.

## Execution rules

1. After explicit approval, start T00 isolated-lab preflight before T01. Re-read audit pins, global fingerprints and current actual API before changes. Unexpected changes belong to user; rebase plan, do not overwrite. Never mutate/restart other OMP projects or default profile.
2. Every task must preserve F01–F12 and selected contracts. Required output/evidence plus exit criteria, not source presence, determines completion. Never mark task done from model response alone.
3. One integrator/coordinator; at most two concurrent workers. Parallel slices only if file ownership disjoint. Shared schema/runtime edits go through owner; no two agents edit same file.
4. Every managed worker/helper gets exact difficulty profile and immutable dispatch packet. No global model mutation; no external agent CLI/WSL/Docker/daemon dependency.
5. Exact machine task fields, dependency IDs, blockers, model classes, files, proposed command, exit and rollback are authoritative in [omp-plan.json](omp-plan.json). [Spec contracts](OMP_FULL_SYSTEM_SPEC.md) define v1 field names; no parallel schema convention.
6. Each nontrivial implementation task exercises actual changed runtime path plus regression where plausible bug requires it. Permanent tests verify consumer behavior/security/state transitions, not copied prompts/source wording. Update affected docs/changelog after proof.
7. No scope cut when blocker appears. Complete reachable tasks; resolve blocker or request explicit decision with evidence. Do not replace actual behavior with mock PASS or silently defer pstack/Harness² beyond release.

## Mốc kỹ thuật trong cùng release

|Mốc|Tasks|Exit toàn mốc|Không được claim|
|---|---|---|---|
|M0 Compatibility/bootstrap|T01–T03|Exact SDK native runtime, source/license locks, v1 state, load once/AK-safe package|Không gọi scaffold complete system|
|M1 Dispatch/workspace/gate/lifecycle|T04–T08|Exact model receipts, hard limits, ownership/cancel/reconcile, independent fail-closed certifier|Không green bởi hook/prose hoặc compiler-only|
|M2 Workflow fidelity|T09|pstack inventory + required workflows chạy artifact thật|Không copied SKILL parity|
|M3 Harness² full method|T10–T13|All eight surfaces + parallel/seq parity + selection/reflection/library + safe promotion separation|Không một prompt rewrite = Harness²|
|M4 Integrated Windows release|T14–T16|Bounded live run, authorized delivery, Windows lifecycle/rollback, comparison evidence, A01–A12|Không local green = remote CI; không universal benefit claim|

Dependency spine:

`T01 → T02 → T03 → T04 → T06 → T07 → T08 → T09/T10 → T11 → T12 → T13 → T14 → T16`

Additional edges matter: T05 depends T02/T03; T06 depends T04/T05; T08 depends T04/T05/T07; T09 depends T03/T04/T05/T07/T08; T10 depends T02/T04/T05/T07/T08; T13 depends T07/T12; T14 depends T08/T09/T12/T13; T15 depends T07/T08/T09; T16 depends T14/T15. JSON contains full graph; prose spine is not substitute for it.

Bổ sung DAG 2026-10-25: `T00 → T01`; `T03 → T17`; `T08 + T17 → T18`; `T14 + T15 + T17 + T18 → T16`. M0 bao gồm T00; M4 bao gồm T17/T18. Mọi task giữ PLANNED, một release đầy đủ. A13/A14 là acceptance bổ sung, không thay A01–A12.


## Task cards

### T00 — Isolated lab bootstrap trước implementation

Requirements F01/F04/F09/F10/F12; hard. Không dependency. Files PROPOSED `scripts/dev-launch.ps1`, `scripts/dev-preflight.ts`, `.gitignore`, `tests/scenarios/dev-isolation.json`; T01 vẫn sở hữu package/verifier bootstrap. Trước có verifier, preflight chạy trực tiếp bằng resolved Bun executable với argv, không cần script package tồn tại. Resolve standalone Bun/OMP executable trước tạo profile; thiếu tool không tự cài hoặc upgrade.

OMP thực thi tự chuẩn bị repo hiện có, `.lab/workspaces`, process-local env/TEMP/cache/state, hai named profiles chưa có foreign content; không bắt người dùng setup thủ công. Không git init/clone trong project đang chạy. Resolve dirs bằng supported pinned API, reject unexpected/shared mutation roots. Lập protected config/AK baseline và allowlist, không duyệt source project khác. Bootstrap profile tối thiểu và AK instruction snapshot có hash; không symlink mutable default config/auth/MCP/history hay copy toàn agent home. Secrets chỉ process-local hoặc profile auth được duyệt. Không chạy model trong bước này.

Verification PROPOSED: resolved Bun argv `["scripts/dev-preflight.ts","--verify"]`, cwd source root. Prove path resolution/default roots unchanged, default plugin absent lab entry, child env scope, no inherited auto-resume/cross-project discovery. Native cache/daemon shared phát hiện phải readonly/disabled hoặc case BLOCKED. Snapshot/profile không phải OS sandbox. Exit: lab safe roots/source-only/offline launch ready; B08 remains until actual two-session coexistence T18. Rollback chỉ artifacts/profile mới có ownership proof, giữ logs; không restore snapshot vào default profile đang có hoạt động.

### T01 — Pin compatibility and prove runtime boundary

Requirements F01/F03/F06/F12; hard/Astra-low. Depends T00 isolated lab. Owner runtime integrator.

Read OMP v18.12.6 docs/types/SDK and pinned Jrecos models/runner. First resolve standalone Bun executable and supported installed SDK import route; host Eval Bun availability does not prove `bun` on PATH. Missing executable/import route blocks bootstrap; no implicit install. Inspect DB-backed plugin list through supported host mechanism; do not guess npm SDK availability from exe. Cache exact source/license hashes to `upstream.lock.json`, exact host/package API compatibility to `compatibility.lock.json`. T01 owns minimal `package.json` with verify script and `scripts/verify.ts` case runner before its first `bun run verify`; T03 later extends package metadata/registration, T14 extends runner. Implement `src/runtime.ts` behind interfaces in spec. Pin OMP packages uniformly to known compatible version; do not load duplicate SDK versions in host.

Probe fresh SDK session with private AgentRegistry, explicit model/effort, no ambient discovery, structured output, task async settlement and dispose. Read source/options before calls; record actual options, not invented SDK inputs. Native task binding optional: prove spawnKey or per-invocation descriptor binds immutably; shared role-name map/racing config is rejected. Reproduce inferred pstack Windows drive/UNC exclusion-path issue in throwaway fixture, and check ACL behavior. No model/backend claim from selector alone.

Verification: `bun run verify --case compatibility` after runner exists; actual SDK child small reply and provider-boundary receipt. Exit: exact available APIs and isolated route proven or precise B01/B03 blockers. Failure: retain bounded evidence and do not enable managed dispatch. Rollback: remove only audit-created local package/probe outputs, leave AK and user profile untouched.

### T02 — Versioned records, state and artifacts

Requirements F01/F02/F05/F07/F09/F10; hard. Depends T01. Files `src/contracts.ts`, `src/state.ts`, `schemas/omp-system.v1.json`.

Encode spec v1 packets with validators, immutable identity, canonical project boundary, enums and monotonic certificate invalidation. SQLite tables: runs/tasks/dependencies/dispatches/leases/processes/checks/reviews/findings/certificates/experiments/library plus schema version; use transactions for reservations/transitions. Artifact bytes published atomically before refs. Crash midway cannot produce certificate or duplicate READY task. Expired/stale generation cannot overwrite current state. Migration copies/snapshots state before destructive change; reject unsupported newer schema.

Verification `bun run verify --case state-contracts`: fault injection at reservation/write/rename/transaction, malformed schema, cycle/missing dependency, cross-project identity. Exit: schema/atomicity invariants proven. Rollback previous DB snapshot/schema only after owned workers stopped; never silently downgrade in-place.

### T03 — Package load and AK preservation

Requirements F01/F12; medium/Sol-high. Depends T01/T02. Files package/bun.lock/extension/lifecycle.

Register one namespaced command `/omp-system` and tool `omp_system`; status/doctor available when disabled, run only opted-in canonical project/profile. Create per-session factory state, not shared module registry. Load once guard identifies duplicate source/marketplace registration without hiding foreign extension. Capture all AK ownership claims, active casing/shadowing and plugin/model discovery. No editing AK files or copying sidecar hooks into active paths. Baseline conflict becomes diagnostic.

Verification `bun run verify --case package-bootstrap`: real OMP load, command discovery, enabled/disabled project, duplicate registration, baseline hashes unchanged. Exit live command works with no parallel controller. Rollback uninstall only owned unchanged registrations; preserve modified/foreign files.

T03 bổ sung: package là plugin cài native từ Git, inert-on-load, activation per-project/profile default off. `omp.extensions` và assets phải đúng supported manifest/API; không auto-edit global config/instructions. Dev chỉ link profile `omp-system-dev`, không đăng ký default/global. T17 sở hữu clean Git lifecycle sau khi T03 freeze manifest; không ai sửa package cùng lúc.

### T04 — Routing, budgets and receipts

Requirements F03/F10; hard. Depends T01/T02/T03. Files routing/budget/dispatch.

Primary classifies difficulty before dispatch; exact pool and effort in packet, capability check and atomic slots. SDK model explicit; supported native task route only if binding proof T01. Managed unbound spawn blocked; unrelated OMP unaffected. Every helper consumes same global limits (2 concurrent, native depth1). Freeze per-run worker/stage/rollout/retry/token/deadline limits before launch; no hidden SDK bypass. Record resolved model, wire effort, fallback/error, usage source; UNKNOWN remains UNKNOWN. Provider alias response not backend attestation.

Verification `bun run verify --case routing`: concurrent mixed classes/roles, unavailable model, settings override conflict, canceled reservation, fallback forbidden/permitted edge, retries counted, limits before allocation. Live one tiny call per profile plus changed mixed path. Exit no profile exchange or silent out-of-pool fallback. Rollback disable managed run without reverting user's global roles.

### T05 — Workspaces and Windows process control

Requirements F02/F04/F09; hard. Depends T02/T03. Files workspaces/processes.

Freeze tracked/staged/worktree/untracked relevant config snapshots; define exclude policy before review. Writer leases by normalized realpath and scope, separate worktrees per independent writer/candidate. Patch integration checks current/base digests; conflicts retain evidence and workspace. No destructive stash/reset or unlanded cleanup. Supervised processes use argv, bounded output artifacts, minimal env and PID/start identity; cancel SDK + Windows descendants and prove settlement.

Executable trust boundary must be resolved, not labelled by worktree. Inspect available native Windows restricted-process/ACL/job controls; use minimal platform helper only where OMP/Node lacks enforceable native primitive. Helper source, build prerequisite and boundary must be explicit. If untrusted candidate plugin can access host credentials or modify certifier, B02 remains release blocker; operator-approved trusted code is separate declared mode, not equivalent untrusted safety proof. No new agent CLI/WSL/Docker dependency.

Verification `bun run verify --case workspace-processes`: spaces/Unicode/drive/UNC/junction, dirty checkout overlap, canceled child/grandchild, PID reuse fixture, conflict, cleanup refusal. Exit actual Windows kill/retain behavior observed. Rollback stop owned processes, release leases after reconcile, leave dirty/unknown worktrees intact.

### T06 — Independent reviewer and check evidence

Requirements F05/F11; hard. Depends T04/T05. Files review/checks.

Fresh SDK session with explicit discovery, private registry/settings/memory, approved tools/context. Candidate content untrusted, no implementer conversation or repo control over reviewer policy. Frozen check-plan commands validated at operator boundary; controlled check runner captures stdout/stderr/artifact digests, exit, test discovery and runtime observations. Determine each supported runner's zero-test/selection semantics from actual installed project. Unsupported accounting => BLOCKED or explicit predeclared alternative, never bare exit0.

Verification `bun run verify --case reviewer-boundary`: planted target instructions/MCP/config/plugin cannot hijack review or read secrets; consumer-visible bug reviewed from fresh context; run actual tiny app and observe expected behavior. Exit identity/coverage/evidence binds to candidate digest. Rollback discard new review, no cert.

### T07 — Formal certifier and repair

Requirements F05/F11; hard. Depends T02/T06. Files gate/findings/tests/gate-negative.

Single deterministic certifier validates every invariant in spec. Findings unresolved/blocking, stale checks, malformed reviewer output, unknown/pending jobs, zero selected tests, absent logs, failed timeout/cancel or mismatched digest deny success. Snapshot mutation invalidates certificate atomically. Repair generates new attempt/snapshot and fresh review/checks. No reading model DONE as state transition. Hook failure does not grant formal PASS.

Verification `bun run verify --case gate-negative`: independent runner queries certificates/state and expected transitions directly; inject forged prose/json/path/digest, incomplete coverage, stage mutation mid-review, hook timeout, superseded worker success, zero tests/missing log. Exit all negative cases non-PASS and positive actual artifact/check path certified. Rollback mark cert invalid, stop delivery, retain evidence; do not resurrect old cert.

### T08 — Coordinator, supervision and resume

Requirements F02/F09/F10; hard. Depends T04/T05/T07. Files coordinator/tasks/status.

One controller owns dependencies, writer leases, monitor/steer inbox, retries, phase transitions and completion barrier. Port Firstmate accepted-vs-consumed wake/session generation contracts without shell watcher or daemon. Native jobs settled, not merely idle or assistant final. Restart reconciles live/dead/unknown processes, leases, artifacts and certificates; unknown workers blocked, not replayed. Fork gives new lineage; status names pending checks/blockers/current model/snapshot/review/experiment.

Verification `bun run verify --case lifecycle`: real OMP run with two nonoverlap tasks, steering and phase auto-advance; kill/restart, fork, unknown worker, stale callback, cancellation and delayed completion. Exit no duplicate task or ghost PASS; bounded event-driven monitor. Rollback durable cancel and cold reconcile, retain unfinished evidence.

### T09 — Full pstack workflow integration

Requirements F06/F01; hard. Depends T03/T04/T05/T07/T08. Files pstack adapter/vendor/fidelity map/content checker.

Inventory original S6, portable S7 and native S8, reconcile source-version delta. Reuse native pieces over rewrite, but SDK18.12.6 and Windows defects resolved. All principles/playbooks mapped to installed AK equivalent or adapted implementation with semantic check. No unsupported imported skill quietly passed. Native extension dispatch/model/routine pieces must not start another controller; empty-tool routine succeeded never gates actual app.

Run how/why groundings, architect distinct options via arena, arena same input/rubric isolated candidates + crossjudge/graft/real verify, interrogate independent review categorization, blast-radius actual failure proof, verification create/maintain live path. Preserve broader inventory using exact adapters and task-driven checks, not blanket copied-content assertion.

Verification `bun run verify --case pstack-workflows`: machine inventory and link/hash checks plus actual core workflows on throwaway app; foreign command collision retained. Exit every requested method/workflow has runnable acceptance/proven fidelity. Rollback remove only namespaced integration, keep artifact reports and installed AK content.

### T10 — OMP substrate and eight surfaces

Requirements F07/F08; hard. Depends T02/T04/T05/T07/T08. Files harness spec/substrate/surfaces/repository-task.

Implement source-derived substrate preflight/materialise/execute/read_trajectory and repository-task source snapshot, idempotent IDs, domain command policy, deliverable extraction, actual runtime evidence and acceptance judge outside proposer context. Uniform model channel resolution through dispatch policy; no hardcoded Codex/OpenCode model channel/install mode.

Materialize all eight surfaces in spec; include active sentinel behavioral proof for each. Scripts/plugins need enforceable or explicitly authorized trust boundary, isolated worker plus controlled config; a folder in worktree is not proof. Freeze baseline and coordinator/certifier/model-policy outside candidate editable tree. Leaked grader/hidden tests rejected by content/path policy, not presented as context evidence.

Verification `bun run verify --case harness-surfaces`: actual OMP candidate per surface, task path executed, delivered artifact/error distinction, hostile plugin cannot mutate active policy or certifier. Exit all eight functional surfaces proven; unsupported surface blocks release. Rollback terminate workers and discard only experiment materialization, never active baseline.

### T11 — Parallel/sequential method parity

Requirements F07; hard. Depends T10. Files recursion/ledger/source-derived fixtures/parity tests.

Port exact recursion source at S9. Differential fixtures capture parallel 2k proposals/k independent compositions and seq k rounds/current/history/finals. k1/k2 for both modes; retries, rejected/no-op trees, transport errors, deterministic label order and evidence propagation. Harness recursion is primary DAG iteration, not worker nesting that violates native depth cap. Bounded scheduler2 queues work without changing method cardinality. Source licenses/change notice retained.

Verification `bun run verify --case harness-parity`: source-derived reference traces with independent expected method assertions; run tiny deterministic actual adapter so this is not mere mock forwarding. Runtime live model method proof T14 supplements, not replaces parity. Exit complete traces/deliverable semantics match pin. Rollback versioned method implementation without deleting experiment records.

### T12 — Selection/reflection/library

Requirements F07/F08; hard. Depends T11. Files selection/library.

Finals-only pool, anonymous stable IDs, drops before selector, k1 trivial, source fallback states and no-artifact cases. Selection error is not valid adoption. Reflection from eligible adopted method result uses decisions/deltas/trajectories/deliverables and provenance. Library validates no grader contamination and scopes project/domain/model/version; persistence after failure must not publish half-written eligible entry. Task2 receives prior eligible experience and source refs, not only same-task repeated prompt.

Verification `bun run verify --case harness-learning`: worse candidate, missing artifact, malformed selector/fallback, library absent/invalid/newer version, cross-project/model rejection, restart and task2 retrieval. Exit observed task2 input provenance and behavior, no active policy changes. Rollback mark entries ineligible/version mismatch, preserve source evidence.

### T13 — Production promotion separate method adoption

Requirements F08/F05; hard. Depends T07/T12. Files promotion/tests.

Freeze acceptance/regression and active policy before experiment. Method winner not baseline comparison; it may be worse by upstream design. Promotion requires independent cert, approved task-suite evidence, immutable candidate digest, explicit authority and previous policy retained. Candidate executable code cannot mutate promotion policy/checker. Rejected/failed/unknown candidate leaves active policy byte-identical.

Verification `bun run verify --case promotion`: upstream-selected worse candidate, passing visible checks/failing hidden frozen regression, mutated policy, untrusted plugin and missing authority all denied; authorized good candidate activates atomically and rollback restores prior behavior. Exit two levels distinguishable in status/store. Rollback active pointer to prior validated policy only, invalidate superseded certs.

### T14 — Bounded live full experiment

Requirements F03/F07/F09/F10; hard. Depends T08/T09/T12/T13. Files live scenario and extend `scripts/verify.ts` created by T01 (not concurrent ownership).

Actual OMP model calls propose, run, compose, select, reflect; all tasks same frozen base input, genuine deliverables/observations. k1 bounded live path + k2 live if approved RunBudget permits; deterministic k2 parity remains mandatory either way. Second task retrieves experience after restart. Observe usage, latency, retries, failure/cancel and model receipts; no throughput/cost claim from labels. T14 cannot manufacture live proofs from fixtures.

Verification `bun run verify --case live-experiment --live` only after explicit live budget authorization. Exit actual artifact behavior proven, stage evidence graph complete, hard limits obeyed, no bypassed model/depth/pool. Rollback cancel/settle owned jobs and retain experiment with truthful failure state.

### T15 — Delivery, local and remote

Requirements F11/F05; medium. Depends T07/T08/T09. Files delivery/scenario.

Local handoff includes candidate digest, local cert, tests/log/runtime proof, unresolved risk and exact actions authorized. Native Git argv/provider API per repo authority; push/PR/merge/deploy separate approvals. Remote CI linked to candidate head and required checks; remote denied/missing auth stays BLOCKED/NOT RUN, never fake CI from local suite. CI repair uses new snapshot/gate path and cannot replace unrelated history.

Verification `bun run verify --case delivery --local`; remote case only approved test repository/credentials/action: `bun run verify --case delivery --remote`. Negative authority cases run locally with independent state assertions, not pretend remote. Exit local works; required release remote scenario must be real before remote capability claim. Rollback stop external actions, preserve local branch and report already-completed irreversible actions; never auto-force-push rollback.

### T16 — Windows acceptance, comparison, packaging and rollout

All F01–F12; hard. Depends T14/T15/T17/T18. Files package script, Windows scenarios, operations/changelog.

Independently exercise A01–A14 against exact package/candidate revision, actual Windows spaces/Unicode and target filesystem/processes, upgrade incompatible version and rollback/reinstall. Fresh LAB OMP restart confirms single extension/skills/tags; never restart other active sessions. Snapshot config/AK before install; package includes only source/required runtime assets/license, no credentials/state/backups. Default rollout remains dedicated profile, disabled by default per project. User/default-profile registration and Git remote publishing require separate approval. T16 depends additionally T17/T18.

Compare same frozen bug fix, feature, refactor and harness-optimization tasks to OMP+AK baseline. Judge acceptance/regression first, then elapsed time/intervention/actual usage or UNKNOWN cost. Raw runs/provenance retained; small suite does not show universal gain. Test runner must challenge gate invariants independently, not consume gate summary as truth.

Verification `bun run verify --case windows-acceptance`; `bun run verify --case baseline-comparison --live`; `bun run package`. Exit every applicable A01–A14 proven, required blocker resolved, docs/source/evidence consistent, load/rollback preserve AK and other projects. Remote checks without permissions remain NOT RUN and prevent claims dependent on them. Rollback stop owned lab runs only, restore validated lab version/owned registrations with hash preconditions; preserve foreign/modified files.

### T17 — Git-native plugin lifecycle

Requirements F01/F12; medium. Depends T03, owns serial handoff `package.json`, `bun.lock`, plugin assets, `tests/scenarios/git-plugin-install.json`, `docs/install.md`; extend existing verifier only via owner/integrator, no concurrent writes. Contract owner spec Plugin Git distribution. Build clean local Git repo with two pinned commits first, install into fresh `omp-system-install-test` via OMP Git source syntax supported by package manager, observe single native plugin load/disabled state. No manual build/setup/postinstall permission needed. Then verify hosted Git ref only after remote URL/publish authority exists; no fabricated public URL, no npm publish requirement.

Verification `bun run verify --case git-plugin-lifecycle`: actual Git-resolved install, assets/deps available with scripts disabled, exact commit recorded, reload dedicated process, update vA→vB, rollback vB→vA, uninstall registration while preserving data and foreign plugins. Repeat missing tool/auth/private repo failure with honest diagnostic; no fallback global install. `--scope project` does not isolate Git on18.12.6. A14 requires hosted install proof for claimed hosted support; local Git does not count as hosted. B09 owner T17/T16. Rollback pin previous validated Git ref/state schema in target lab profile only; refuse active owned run, leave other profiles/processes alone.

### T18 — Coexistence/noninterference acceptance

Requirements F01/F04/F09/F10/F12; hard. Depends T08/T17. Files `tests/scenarios/coexistence.json`, `scripts/verify-coexistence.ts`. Fresh surrogate standard-profile OMP + separate fixture repo and development-profile OMP run concurrently; use owned isolated surrogate, not existing user projects as test fixtures. Prove dev link/install/update/rollback/cancel cannot change surrogate model/tools/plugin discovery/session resume/default config; fingerprints/ownership and controlled write traces, not only no-error output. Observe scoped process kill and shared cache/daemon behavior. Check actual default config/AK manifests readonly before/after; concurrent foreign drift only report, never restore.

Verification `bun run verify --case coexistence`: one managed worker, explicit resource/API budget, no model call required for offline directory checks; tiny live surrogate only with admitted budget. Unknown path isolation/OS enforcement blocks claim; cannot guarantee performance/quota zero impact. Pause new launches on resource pressure/429; no killing unrelated processes. A13 proof required before T16/release. Rollback terminate only owned surrogate/lab jobs, retain artifacts, never restart/kill user's sessions.

## Scheduling / ownership

T04 and T05 can execute in parallel after T03: disjoint files, shared contracts frozen T02. T09 and T10 after T08: disjoint pstack/harness paths, shared contracts changes serialized through integrator. T15 may run while T10–T13, but no external actions absent authority. All edits `runtime.ts` owner T01 only until reviewed interface; consumers request change through integrator. T01 creates verifier and minimal `package.json`; T03 explicitly takes package metadata ownership after T02; T14 extends verifier after dependencies finish. T16 owns packaging/docs rollout; no other worker edits live installation.

T17 có thể sau T03 nhưng package.json/bun.lock ownership phải handoff tuần tự T03→T17→T16; không song song package edits. Khi T14 hoặc T18 cùng sẵn sàng thì live scenarios vẫn chạy tuần tự theo lab cap1, dù offline code slices có thể hai worker. Lab launch cap1 thay production ceiling2 khi project khác đang chạy. T00 preflight sở hữu launch scripts, không thêm hidden controller.

Each task card's verification/rollback maps JSON. Blocker ownership is named by Txx, not a promise someone else will fix it. High-risk compatibility/security/persistence/method fidelity tasks use hard profile; bounded integration/documentation uses medium. Easy profile reserved for leaf checks once admission and exact scope exist, not used merely because agent called tester.

## Risk / impact / response

|Risk|Likelihood × impact|Detection / response|Owner|
|---|---|---|---|
|B01 API/binding or duplicate loaded router|High × High|T01 actual SDK + composition proof. Prefer immutable SDK model local packet; reject role-map race, keep unrelated OMP usable|T01/T04|
|B02 reviewer/candidate code escapes trust boundary|High × Critical|Adversarial sentinel/credential/file policy tests and OS primitive validation; no untrusted executable run until boundary proven, release blocked if surface unsupported|T05/T06/T07/T10/T13|
|B03 SDK mismatch/Windows path/ACL|High × High|Reproduce before port; exact packages; Unicode/UNC/ACL scenarios, no POSIX privacy claim|T01/T09|
|B04 method drift/missing surfaces/learning contamination|Medium × High|Pinned source-derived differential trace + live artifact proof + contamination/scope tests|T10–T14|
|B05 external authority absent|Known × High|Explicit credentials/repo/action admission; local result remains local; never auto-publish|T15/T16|
|B06 endpoint errors/backend alias|Observed × Medium|Record transport/status/effort, bounded retries, no fabricated backend identity|T04/T14|
|B07 no measured benefit / biased tiny task suite|Known × Medium|Freeze tasks/acceptance before both arms; report outcomes not guarantee|T16|
|Interrupted Windows DB/process lifecycle|Medium × High|Crash injections plus actual restart/cancel descendants; retain unknown workspace|T02/T05/T08|

## First action after approval

Run T00 first: OMP prepares isolated workspace/lab and named profiles, resolves executables/paths, read-only baselines and protected roots; no inference/global registration. Then T01 SDK compatibility. User need not prepare another workspace manually. No Git publish, live model budget, default-profile install or OMP/AK upgrade authorized by this plan update; obtain separate authority when needed.

## Execution checkpoint — 2026-10-25

T00 created owned lab/profile directories, child-env launcher and preflight; embedded Bun1.4.3 works via installed omp.exe `BUN_BE_BUN=1`, standalone Bun installation unnecessary. Three behavioral scope/profile/headroom tests pass (7 assertions); incidental not-throw check removed. Initial preflight resolved version/protected hashes successfully; full T00 isolation/shared-service/AK snapshot acceptance NOT COMPLETE. SDK18.12.6 local install with scripts disabled failed ENOSPC; removed only newly created node_modules/cache/tmp. C: approximately48MiB free, D: approximately10.6GiB free. Added2GiB free-space admission before profile/source mutations; actual CLI preflight exit1 proves denial. Do not keep allocating on C or clean unrelated files. B10 needs storage relocation or user cleanup decision; no other project/session restarted, six protected config/plugin/AK manifest fingerprints unchanged. No source SDK import or remaining F01–F12 functionality claimed complete.

### User-requested pause and cleanup

Removed project-owned `.lab` (TEMP/cache/state/fixtures), both owned profiles `omp-system-dev`/`omp-system-install-test`, and prior audit TEMP directory `omp-system-audit-1792854764204`. Failed-install node_modules/cache had already been removed; no bun.lock remains. Kept source scripts,3-test regression file,package.json,.gitignore and approved five-document plan. No user project/default config touched; no plugin installed/published, no automatic continuation. Restart from T00 only after user requests resume and safe disk headroom exists; prior profile/bootstrap artifacts must be recreated, not assumed present.

### Resumed implementation

Original local functional plan completed at source dd984ce1136c21f1d1acccc511f23b1f5fabc1978fd799ffdede66ae7248940b. Acceptance/runbook owns24runtime scenarios,127tests, independent reviews, preserved historical failures and exact trusted-code/catalog limitations. `.lab` remains private evidence and must not be committed. Current draft-head hosted verification is separate; no default-profile/production rollout.
