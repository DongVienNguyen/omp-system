# OMP system audit — 2026-10-24

Phạm vi: AUDIT + THIẾT KẾ + PLAN. Chưa cho phép implementation, cài đặt, sửa cấu hình đang dùng, commit/push/PR/merge/deploy. Người đọc: người duyệt và phiên OMP thực thi sau khi được duyệt.

## Kết luận

Khả thi có điều kiện bằng một package OMP native, tái dùng AgentKit Engineer; không cần agent CLI khác, WSL, Docker hay daemon điều phối. Chưa có bằng chứng hệ thống tích hợp F01–F12 chạy được. Các mốc trong plan thuộc cùng một release đầy đủ, không phải các release thu hẹp.

Chọn reuse/port, không cài nguyên Firstmate/no-mistakes/Harness². Firstmate còn backend/watcher và shell riêng; no-mistakes hiện lái OMP qua ACP/acpx; Harness² chưa có OMP substrate. Native pstack port có sẵn nhưng pin SDK khác và có rủi ro Windows. Không tạo controller cạnh tranh với chúng.

## Quy ước bằng chứng

- FACT: quan sát trực tiếp lệnh, cấu hình, source tại revision ghi rõ.
- SOURCE_ONLY: source có khả năng; chưa chạy đường hành vi đó trên máy này.
- LOCAL_VERIFIED: chỉ áp dụng scenario cụ thể đã chạy ở bảng E bên dưới.
- INFERENCE: kết luận kỹ thuật suy ra từ source; không gọi runtime-tested.
- UNKNOWN / NOT RUN: chưa chứng minh; không thay bằng PASS hoặc mock.
- Bxx: blocker phải được xử lý trước mốc liên quan; không nhất thiết cản hoàn thành audit/plan.

## Môi trường và baseline hiện hữu

|Thành phần|FACT / bằng chứng|Hệ quả|
|---|---|---|
|OS|Windows 11, build 10.0.26300, x64; Python platform query|Windows native là target; chưa chứng minh ACL/process-tree kill|
|OMP đang chạy|`C:/Users/dongnv/.local/bin/omp.exe --version`: `omp/18.12.6`|Pin release v18.12.6; không suy từ main|
|Toolchain|`ak --version`: 2.19.0; Git 2.55.0.windows.5; Node v24.21.0; npm 11.19.0; host Eval Bun 1.4.3|Không cài/nâng cấp gì|
|Shell|`COMSPEC=C:\WINDOWS\system32\cmd.exe`; native Windows PowerShell probe 5.1.26100.9539; OMP bash tool không đồng nghĩa Git Bash đã được kiểm chứng|Lệnh có shell phải dùng adapter/argv đúng Windows; standalone Bun executable chưa được kiểm tra|
|GitHub CLI|Probe `gh --version` không tìm được executable qua direct spawn|Remote checks NOT RUN; chưa kiểm tra credentials|
|Workspace audit|Nguồn/probe tạm tại `C:/Users/dongnv/AppData/Local/Temp/omp-system-audit-1792854764204`|Không phải repo ứng dụng; không sửa dự án bất kỳ|
|Workspace bàn giao|`C:/Users/dongnv/.local/share/omp-system/docs/omp-system/2026-10-24`|Thư mục mới dành tài liệu; parent realpath đã đối chiếu, không junction quan sát được|
|AgentKit|CLI/registry artifact 2.19.0; `kit.yaml` Engineer 0.2.0; adapter `agentkit-adapter.v1`|Không lẫn artifact version với kit metadata version|
|AK provenance|Registry `sourceCommit=d7b9bf22563a2c75dba726f9f0681988d884e89b`; artifact SHA256 `e2c91636c526d8cb9e45b6c155a2ccfb00015a5b5bd4191705761754ebc7f0c9`|Không lưu signed URL/token; không có public source URL cho paid artifact|
|AK ownership|`~/.agentkit/adapters/omp/engineer/omp-ownership.json`: 1.776 claims; 0 missing; 0 hash mismatch tại audit|Giữ baseline; custom integration không sửa các path này|
|AK surface|`~/.omp/agent/{skills,agents,rules}`, managed instructions; sidecars ở `~/.agentkit/adapters/omp/engineer/sidecars`|Hook/script có trong sidecar không có nghĩa đang chạy|
|Plugin/MCP|`~/.omp/plugins/package.json` chỉ khai báo context-mode; MCP config có context-mode, codegraph, agentmemory, crews-omp; `~/.omp/agent/extensions` trống; config explicit extension AgentMemory|Chưa inventory toàn bộ DB-backed plugin discovery. crews MCP có thật; không suy crews extension active từ MCP|
|Crews|Source package 0.6.0 tại `~/.local/share/crews-omp/source`; MCP launcher khai báo tại đó|Không thay Crews/AgentMemory/Context Mode/CodeGraph; phải kiểm tra composition để tránh router kép|

### Cấu hình và role hiện tại

`~/.omp/agent/config.yml:6–36`: default/plan/task = `9router/code-sol:high`; slow/vision = `9router/code-astra:high`; smol/commit/tiny/memory = `9router/code-seek:high`. `task.enableEffort=false`, concurrency 2, recursion depth 1, soft request budget 24, isolation disabled; advisor/prewalk disabled; retry maxRetries 2, fallbackChains rỗng.

Agent definitions: planner/researcher/code-reviewer/fullstack-developer/docs-manager/debugger và nhiều vai trò khác dùng `@plan`; Explore/tester/git-manager dùng `@smol`; advisor/kongming dùng `@advisor`. Vì vậy tên planner không chứng minh Astra; `@advisor` chưa chứng minh resolve đúng pool. Rule orchestration vẫn nhắc `fable`; không được dùng nguyên câu đó như quyền gọi ngoài pool. Custom routing phải chặn pool ở runtime, không sửa AK để che sai lệch.

Policy đích do người dùng chốt: khó `9router/code-astra:low`; trung bình `9router/code-sol:high`; dễ `9router/code-seek:high`. Không tự thay global policy trong audit. Vision không nằm trong ba mức difficulty; capability là điều kiện hợp lệ, không tự đổi effort hoặc model ngoài pool.

### Fingerprint trước probe

|File|SHA256|
|---|---|
|`~/.omp/agent/models.yml`|`3d608d93178e20108a765abe230a9423e790ef93e30ab2f0fcfc385310ca145e`|
|`~/.omp/agent/config.yml`|`83154fb4e81e04b75ab1cbf482d4ed7eb645c1bb458df7509318a8f5e5ba88d3`|
|`~/.omp/agent/mcp.json`|`d5a5bf345b7f1868011334c80579b348dbff6358e889b1e03de9b2b14c3d066b`|
|AK ownership manifest|`23709ffccfe356246c962496c005b7999345ac0ac80e05e63e6797e29a892a2c`|

Bảng này không chứa khóa API. Session/cache DB có thể thay đổi tự nhiên khi OMP chạy; không dùng hash DB đang mở làm baseline config.

## Nguồn được pin

|ID|Nguồn / revision / license|Đã đọc và vai trò|
|---|---|---|
|S1|[OMP v18.12.6](https://github.com/can1357/oh-my-pi/tree/45c35e40c46166dc726ccc52f5d27f40f2449f99), MIT|docs extensions, sdk, task-agent-discovery, system-prompt-customization; extension types, model roles. Sáu file API này byte-equal HEAD `0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0`; không suy toàn repo giống|
|S2|[AK adapters](https://docs.agentkit.best/en/stable/concepts/runtime-adapters), [models](https://docs.agentkit.best/en/stable/guides/agent-models), [install](https://docs.agentkit.best/en/stable/guides/installing-kits)|Live docs đối chiếu artifact local pin ở trên. URL `/engineer/` được yêu cầu trả HTTP 404; dùng route stable và installed kit, không đoán trang cũ|
|S3|[Firstmate](https://github.com/kunchenguid/firstmate/tree/d96bff00dc51369af820f952fd092ad2e45f9f2b), MIT|README; `.omp/extensions/fm-primary-omp-watch.ts`, `fm-primary-turnend-guard.ts`; lifecycle, session generation, durable wake/consumption|
|S4|[Firstmate Windows](https://github.com/EvanBatten/firstmate-for-windows/tree/40d922813c7d0d0c38296d00204505149320bae3), MIT|README Windows prerequisites/path/process/ACL differences. Upstream claims Windows Claude+Herdr proof; không phải OMP Windows proof của audit|
|S5|[no-mistakes](https://github.com/kunchenguid/no-mistakes/tree/b529e952605f3f8ec5e1c306ca94459b7727d0c0), MIT|README, `internal/agent/{ompgate,agent,review_roles}.go`, pipeline/intent/review/evidence/round_stamp/pipeline_delivery. Giữ gate semantics, không gọi ACP agent stack|
|S6|[Cursor pstack](https://github.com/cursor/plugins/tree/9580c23696ac8d7abed0c166f2f9918800afb819/pstack), 0.15.32, MIT|Dispatcher, principles, workflow catalog, core how/why/architect/arena/interrogate/blast-radius/verification|
|S7|[oh-my-pstack](https://github.com/shrimpwtf/oh-my-pstack/tree/fc0eabd25f21b194a336b640e75e29c252382866), MIT|Portable host contract/sync; older lock `bdf7aa355337897f167153e05069aca505dae17c`; không phải native runtime proof|
|S8|[omp-pstack](https://github.com/Jrecos/omp-pstack/tree/824bbacb0ae28b1885ebcb912f0b8d984bb49198), 1.8.0, MIT|`src/{extension,models,runner}.ts`, package, upstream map. Pin SDK 18.10.2; adapted Cursor 0.15.28 `d457567332aa6989e753ea289f30ea2bfbc80bc0`; source-only reuse candidate|
|S9|[Google Harness²](https://github.com/google-research/harness2/tree/1cfe254e8d25b15f37048c3730134686abe60335), 0.1.0, Apache-2.0|README, config, core spec/proposer/recursion/selection/library/tree/schedule/context/ledger, `substrate/base.py`. Đây là harness2, không phải harness-lab|

MIT notices giữ khi tái sử dụng. Harness² giữ Apache-2.0 attribution/NOTICE nếu có trong phân phối và đánh dấu sửa đổi. License của từng third_party phải inventory riêng trước lấy code; không gom toàn repo theo license root. Paid AK không vendor lại content nếu license không cho phép; dùng installed inventory và references.

## API findings có ảnh hưởng thiết kế

1. [OMP task discovery:207–232](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/task-agent-discovery.md): task wire không có per-call model; shared eval bridge có override. `before_subagent_spawn` có `agent`, `invocationKind`, `modelRole`, `patterns`, optional `spawnKey`, KHÔNG có full task text/difficulty. Bind dispatch packet trước spawn; không suy difficulty trong hook.
2. [Extension types:1074–1086,1568–1577](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/extensibility/extensions/types.ts): hook có thể thay model patterns hoặc block; không giải quyết binding collision của packet thay controller.
3. [SDK discovery:62–99](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/sdk.md): mặc định nạp config, context, tools, MCP/LSP/extensions. Reviewer phải cấu hình rõ discovery boundary; mỗi top-level SDK session cần private AgentRegistry.
4. [Extensions lifecycle](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/extensions.md): `runEphemeralTurn` kế thừa conversation/current model, không phải reviewer độc lập. `agent_end` notification-only. `session_stop` awaited nhưng chỉ main, không task; exception/timeout không phải host-wide fail-closed gate. Streamed DONE không thu hồi được.
5. Extension chạy in-process, không sandbox; dùng managed timers và session-generation ownership, không module-global dispatcher dùng chung main/child. `hasPendingMessages()` không thay job registry.
6. Firstmate source watcher phụ thuộc shell scripts; wake accepted và wake consumed là hai trạng thái riêng. Port state machine, không khởi chạy host/daemon/watcher stack thứ hai.
7. [no-mistakes ompgate.go](https://github.com/kunchenguid/no-mistakes/blob/b529e952605f3f8ec5e1c306ca94459b7727d0c0/internal/agent/ompgate.go): native OMP hiện qua ACP/acpx; `--no-rules` không đủ loại target context. Gate neutralization còn disabledProviders + memory off. Port bằng SDK controlled discovery; không đưa repo instructions vào trusted reviewer policy.
8. [omp-pstack runner](https://github.com/Jrecos/omp-pstack/blob/824bbacb0ae28b1885ebcb912f0b8d984bb49198/src/runner.ts): RoutineRunner có SDK session thật, private AgentRegistry, deadline, async settlement; routine tools rỗng nên không chứng minh app verification. `succeeded` không có nghĩa acceptance pass. [models.ts](https://github.com/Jrecos/omp-pstack/blob/824bbacb0ae28b1885ebcb912f0b8d984bb49198/src/models.ts): `pstack_agent` chỉ lookup descriptor, không spawn.
9. Native pstack source suy ra Windows defect ở exclusion path walker dùng split `/` rồi thêm `/` trước drive; POSIX chmod không chứng minh Windows ACL. B03 phải tái hiện trước sửa; không ghi bug runtime-confirmed.
10. Đã đọc thêm pinned `docs/tools/task.md` (221 lines), Firstmate `bin/fm-spawn.sh`/`fm-watch.sh` và no-mistakes `internal/types/findings.go`/`internal/pipeline/gate_response.go`. Task `sourceSession` dành seance, native task semaphore per instance không bao phủ SDK sessions; coordinator phải enforce global budget. Firstmate source backend/treehouse/daemon assumptions xác nhận không cài nguyên stack. Review coverage là provenance có schema, không chỉ prose.

## Fidelity / reuse / port matrix

|Nguồn, mục đích|Native OMP có|Quyết định trong release|Sai khác phải công bố / proof|
|---|---|---|---|
|Firstmate liaison/lifecycle|Main chat, tasks, event lifecycle, Git|Port task DAG/supervision/durable inbox/worktree ownership; native jobs, không tmux/Herdr|Không tái tạo mọi remote-secondmate/Relay backend không được yêu cầu; nhiệm vụ F01/F02/F04/F09 phải chạy đủ|
|no-mistakes gates|Tools, SDK sessions, local commands|Port intent/review coverage/findings/repair/review/test/docs/lint/delivery; one digest-bound certifier|Không agent CLI/ACP/proxy daemon; fail-closed boundary mạnh hơn prompt và hook|
|pstack catalog|AK có brainstorm/plan/cook/test/review; native pstack port có descriptors|Reuse native port có chọn lọc, cập nhật pin/Windows, namespaced workflow adapter; preserve catalog semantics|54 upstream SKILL.md gồm 24 principle, 23 playbooks theo scout tree; inventory machine lock, không giả định README count ổn định|
|pstack arena|Task fan-out, isolated worktrees|Cùng task/rubric, outputs riêng, cross-judge, primary chọn/graft/verify|Concurrency2 chỉ giới hạn scheduling, không giảm số candidates; không auto-merge losers|
|pstack how/why|Read/LSP/Git/history/AK skills|Grounding, fact/inference, evidence gaps và architecture rationale|Không đổi thành bản tóm tắt prompt chung|
|pstack interrogate/blast-radius/verify|Reviewer session/commands/browser hiện có|Independent review + actual app-run proof, không tự sửa trong interrogate|Không bắt model mới ngoài ba profile; UI cần adapter quan sát thật|
|Harness² method|SDK/model/tool/session APIs|OMP substrate và repository-task adapter; giữ core recursion/selection/reflection/library|Windows native TypeScript port core cần differential fixtures; không chỉ gói CLI executor|
|Harness² surfaces|Prompt/rules/tools/agents/skills/extensions|Materialize từng surface hoặc declared controlled adapter; executable candidate trong worker riêng|Unsupported surface phải BLOCKED; không silently skip hoặc coi folder copy là runtime proof|
|Harness² selection/promotion|Chưa có layer hiện hữu được chứng minh|Selection faithful; production promotion riêng, acceptance/regression/digest gate|Published selection loại baseline, vẫn chọn candidate kém; không đồng nghĩa live policy adoption|
|AK ownership|Ownership manifest và native kit đã có|Giữ nguyên 1.776 claims; custom namespace + reference installed tools|Không copy hook sidecars rồi nói active; update/rollback phải bảo toàn baseline|

### Harness² method đã xác minh từ source

[recursion.py:343–578](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py): parallel `agg`: `inv1,dom1,…,invk,domk` từ shared base evidence, chạy 2k candidates, tạo k compositions độc lập `agg1..aggk`, rồi chạy chúng. Sequential `seq`: mỗi vòng t có `invt,domt` từ current harness + history, rồi composition `ct`; chuyển current thành ct; finals là `c1..ck`, không chỉ ck. k=1 cùng hình dạng INV/DOM/compose, không phải sửa prompt một lần.

[selection.py:93–153,237–252,268–451](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/selection.py): pool finals-only, không baseline/abstention. Bỏ missing/failed deliverables trước anonymize; state-deliverable chỉ được dùng khi adapter khai báo. k=1 trivial selection, không selector session. Lỗi selector có fallback first final ở pool finals nhưng `sel.ok` không tự thành true; không production PASS. `reflect_adoption` chỉ khi selection ok + chosen tồn tại; đọc decisions/trajectories/deliverables; library từ chối grader-verdict leakage và không lưu nếu không experience.

[substrate/base.py](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/substrate/base.py): surface/materialise/execute/read_trajectory/preflight. [tree.py](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/tree.py): tám editable surfaces. Name-level allowlist không sandbox. Correction from implementation source inspection: recursion.py module docstring states **4k rollouts and3k improvement stages, including shared base executions**; `k` là tham số nhân, KHÔNG phải4.000/3.000. Reference scheduling code agg/seq k1/k2 đã được chạy qua numeric adapter để đối chiếu trace, không suy provider/substrate parity từ đó. Hard RunBudget vẫn độc lập và bắt buộc.

## Evidence register — chỉ đã chạy

|ID|Scenario|Kết quả / giới hạn|
|---|---|---|
|E01|Lệnh version OMP/AK/Git/Node/npm và Python platform|LOCAL_VERIFIED các version phía trên|
|E02|Hash toàn bộ AK ownership claims|LOCAL_VERIFIED 1.776/1.776 tồn tại, hash khớp|
|E03|Direct provider HTTP chat, bounded max_tokens=96|Sol/high và Astra/low HTTP200, `OMP_AUDIT_OK`; response model tự báo `gpt-6.1-sol`, `gpt-6-astra`; không chứng minh backend identity|
|E04|Seek/high direct HTTP|Lượt đầu JSON parse error, chưa giữ status/body nên nguyên nhân UNKNOWN. Lượt hai HTTP200 JSON, `OMP_AUDIT_OK`, response model tự báo `deepseek-v4.1-flash-1017`|
|E05|Actual `omp -p --no-session --no-extensions --no-rules --no-skills --tools= --model=9router/<id> --thinking=<effort> --max-time=40s` trong audit temp|LOCAL_VERIFIED cả Seek/high, Sol/high, Astra/low exit0 và output `OMP_AUDIT_OK`; không tool path, child/review/pstack/Harness² proof|
|E06|Explicit temp extension, before_provider_request + session_stop|LOCAL_VERIFIED wire request Sol/high, session_stop keys được quan sát; không thử block/timeout fail-closed|
|E07|OMP CLI chỉ tools=task, yêu cầu scout child; hook đổi Sol/high|Lượt đầu exit0 nhưng task rejected `sourceSession only accepted for seance`; không child. Lượt sau deadline65s exit1, chỉ request hooks. Per-spawn model hook runtime NOT VERIFIED|
|E08|Native audit tasks trong main session|Hai scout chạy; pstack scout provider error rồi gửi evidence qua IRC; Harness scout source report, researcher Sol source report. Không phải integrated application acceptance|
|E09|Đọc GitHub pinned sources / docs|SOURCE_ONLY; không install, build hay chạy upstream test suite|
|E10|Context Mode execution|Một query Python hash chạy được; hai request phân tích khác trả lỗi không diagnostic. Đã báo tool issue, dùng Eval fallback; không sửa Context Mode|

Không chạy pstack workflows, Harness² rollouts, OS-level workspace/security isolation, Windows cancel descendants, gate forgery tests, interrupted persistence, remote CI/delivery, comparative suite. Tất cả NOT RUN.

## Blocker / unknown register

|ID|Vấn đề|Owner / giải quyết|Ảnh hưởng|
|---|---|---|---|
|B01|Per-call dispatch binding/model hook và loaded extension composition chưa runtime-proof; audit CLI task fail/timeout|T01/T04 owner runtime: exact SDK harness, binding collision test, inspect live package discovery|Không dispatch production trước proof; không đổi global config để né|
|B02|Reviewer discovery/context/tool boundary và executable candidate isolation chưa chứng minh|T05/T06/T07 owner security: explicit SDK options, sanitized snapshot, controlled commands, adversarial tests|Release fail-closed; process riêng không tự thành sandbox|
|B03|Native pstack SDK18.10.2 vs host18.12.6; Windows path/ACL risks|T01/T09 owner integration: reproduce path bug, align packages, native Windows smoke|Không cài nguyên port|
|B04|Harness² parity adapter/8 surfaces/reflection/library và quy mô research chưa runtime-proof|T10–T13 owner method: source fixtures + trace parity + bounded live run; pin research scale evidence riêng|Không công bố Harness² faithful từ source-only hoặc prompt rewrite|
|B05|Remote publish/CI credentials, repository, approval chưa trong phạm vi audit; gh probe không tìm executable|T15 owner delivery: native Git/provider API route, inspect approved repo/auth without leaking secrets|Remote verification NOT RUN; LOCAL_VERIFIED không thành REMOTE_VERIFIED|
|B06|Model endpoint có lỗi transient; response aliases không chứng minh backend identity|T04/T14 owner runtime: record resolved/wire effort/fallback/error; no silent out-of-pool fallback|Không hứa latency/cost/backend, không retry vô hạn|
|B07|Không có baseline benefit measurements/task suite acceptance của dự án thật|T16 owner QA: freeze bug/feature/refactor/harness tasks và regression trước run|Không hứa tăng chất lượng/giảm chi phí phổ quát|

## Thay đổi trong lượt audit

Chỉ năm file bàn giao được tạo trong docs workspace mới và source/probe tạm trong TEMP. Không sửa AK managed paths, credentials, model roles, MCP registrations hoặc installed plugins. Các generated proposal paths/commands trong spec/plan chưa tồn tại và được đánh dấu PROPOSED. Kết thúc sau audit+plan; không chạy implementation.

## Review và kiểm định bàn giao

Reviewer read-only độc lập xác nhận scope/architecture và chỉ ra ba lỗi plan: JSON pin OMP main thay release, bootstrap verifier/package ownership thiếu, command ghép bằng semicolon và remote admission không tách. Đã sửa machine pin về v18.12.6, thêm ownership handoff T01/T03/T14, tách argv/cwd/authority của live/remote/package checks. B01–B07 vẫn OPEN; không có runtime blocker nào được đóng bởi review tài liệu.

Validation thực tế: JSON parse, 16 task đủ trường, DAG không cycle/missing ID, F01–F12 có task và A01–A12, tám local Markdown links tồn tại, đúng năm file bàn giao. Fingerprint config/models/MCP/AK manifest sau probe khớp trước probe. Đây là kiểm định tài liệu, không phải acceptance của hệ thống chưa xây.

Reviewer kiểm lại ba correction: **PASS WITH KNOWN BLOCKERS**, không còn must-fix trong correction scope. Final ownership scan: 1.776/1.776 managed file khớp hash; credential-value/token-pattern scan của năm file không phát hiện secret. Thư mục production `src` chưa tồn tại. Không suy review tài liệu thành runtime approval hoặc implementation authorization.

## Plan amendment — 2026-10-25: coexistence và Git plugin

Người dùng yêu cầu OMP tự chuẩn bị workspace để phát triển song song mà không sửa project đang chạy và plugin dễ cài từ Git; chỉ duyệt tài liệu, chưa implementation. Giữ năm file hiện có; thêm T00 bootstrap, T17 Git lifecycle, T18 independent coexistence và A13/A14; total19 tasks. Chọn dedicated dev/install-test profiles, không cài default/global; protect other projects/default settings/AK/integrations. CPU/RAM/disk/API shared: không cam kết zero performance/quota impact; cap1 worker/live experiment, admission/quota control.

Source bổ sung ở cùng pin OMP v18.12.6:
- [CLI reference](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/docs/cli-reference.md): `--profile` áp dụng trước subcommand; `--cwd` là launch flag, không giả định áp dụng plugin install. Launcher/tool cwd explicit.
- [dirs.ts:364–456,700–724](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/utils/src/dirs.ts): profile configRoot, agentDir, plugin root profile-scoped trên Windows; XDG chỉ Linux/Darwin, named profile rootDirs khác baseRootDirs shared. Parent đã đọc constructor/rootSubdir, bác bỏ inference ban đầu của scout rằng plugins shared qua XDG. Machine-global daemon/service paths vẫn shared. Named profile không tự sandbox candidate code.
- [plugin-cli.ts:476–526](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/cli/plugin-cli.ts): local paths route link; `--scope` chỉ marketplace, Git/npm/local bỏ qua. Dùng named profile, không `--scope project` cho Git.
- [manager.ts:480–620,863–891](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/extensibility/plugins/manager.ts): Git install qua Bun trong resolved plugins dir; link là symlink/junction thay path cùng package name, nên chỉ link dev profile có ownership. `installer.ts` legacy helper không là CLI manager đang dùng.
- [types.ts:24–49](https://github.com/can1357/oh-my-pi/blob/45c35e40c46166dc726ccc52f5d27f40f2449f99/packages/coding-agent/src/extensibility/plugins/types.ts): supported `omp.extensions`/commands/features/settings; không giả định `omp.skills`/`omp.agents` schema từ plugin khác.

Observed current read-only CLI: `omp --version` vẫn18.12.6; `omp plugin --help` exit0, actions install/uninstall/link/list/upgrade và flags scope/dry-run. Không chạy install/link/profile activation, không inference smoke, không sửa source/registrations. Source `docs/plugins.md`/`docs/profiles.md` probe404, dùng discovered CLI/source thay thế.

Crew retrieval admitted Small/Auto difficulty1 = medium effort; native/wire Seek/medium khớp nhưng role output thiếu strict structure, crew_results FAILED, không claim crew COMPLETE. Facts parent kiểm lại trực tiếp pinned source trước ghi plan. Initial run admission project/CWD mismatch refused before launch; corrected admission CWD, không bypass routing. Main chat model không thay.

B08 owner T00/T18/T16: actual profile/shared-state/command coexistence proof NOT RUN, blocks release isolation claim. B09 owner T17/T16: Git repository/release URL and publish authority missing; local/hosted Git clean-install/dependency lifecycle NOT RUN. No public URL invented; Git publishing needs separate permission. Audit trước16 tasks/A01–A12 là historical record; amended19 tasks/A01–A14 sẽ được validate riêng.

Amendment verification: actual JSON parse/DAG/required-fields/F01–F12+A13/A14 traceability/local-links check PASS:19 tasks,14 acceptance IDs,8 local links,5 deliverables; execution_authorized=false, no production src. Independent Crews check C1 isolation/C2 Git contract/C3 DAG+scope COMPLETE with strict JSON; crew_results confirms Large/Auto difficulty2 resolved Astra/high and matching wire effort, exit0. This review certifies documentation only; A13/A14 and B08/B09 runtime proof still NOT RUN/OPEN. Main chat unchanged; no plugin/profile installation or project process mutation.
