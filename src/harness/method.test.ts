// Copyright 2026 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// https://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.
// Run: node --experimental-strip-types --test omp-system-harness-slice/method.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertTree, BudgetError, createSlots, runMode, TransportError } from "./recursion.ts";
import type { Budgets, HarnessAdapter, Mode, RunOptions, RunView, StageRequest, Tree } from "./recursion.ts";
import { assignIds, reflectAdoption, selectFinal, selectionPool } from "./selection.ts";
import type { SelectionAdapter, SelectionOptions } from "./selection.ts";
import { Library } from "./library.ts";
import type { LibraryScope } from "./library.ts";
const referenceCases = JSON.parse(await readFile(new URL('../../tests/fixtures/harness2-reference.json', import.meta.url), 'utf8')).cases as Array<{mode:Mode;k:number;stages:string[];finals:string[];biases:number[];trace:string[]}>;

function harness(bias: number): Tree { return { "config.json": JSON.stringify({ bias }) }; }
function biasOf(tree: Tree): number {
  const value: unknown = JSON.parse(tree["config.json"]);
  assert.ok(value && typeof value === "object" && "bias" in value && typeof value.bias === "number" && Number.isFinite(value.bias));
  return value.bias;
}
/** Real adapter interprets harness config, computes arithmetic artifact, records steps. */
function numericAdapter() {
  const requests: StageRequest[] = [];
  const runs: string[] = [];
  let active = 0, peak = 0;
  const pause = async (): Promise<void> => { active++; peak = Math.max(peak, active); await Promise.resolve(); await Promise.resolve(); active--; };
  const adapter: HarnessAdapter = {
    validateTree(tree) { assertTree(tree); biasOf(tree); },
    async propose(request) {
      requests.push(structuredClone(request)); await pause();
      const bias = biasOf(request.evidence.current) + (request.dimension === "INV" ? request.index : 10 * request.index);
      return { tree: harness(bias), notes: `${request.label}: revise bias using base trajectory`, usd: 0.1 };
    },
    async compose(request) {
      requests.push(structuredClone(request)); await pause();
      const pool = request.dimension === "COMPOSE" ? request.evidence.pool.slice(-2) : request.evidence.pool;
      const bias = pool.reduce((sum, candidate) => sum + biasOf(candidate.tree), 0) + request.index;
      return { tree: harness(bias), notes: `${request.label}: combine ${pool.map(c => c.label).join(",")}`, usd: 0.2 };
    },
    async rollout({ label, tree }) {
      runs.push(label); await pause();
      const steps: number[] = [];
      let total = 0;
      for (const value of [2, 3, 5]) { total += value; steps.push(total); }
      const bias = biasOf(tree);
      const result = total + bias;
      return { runId: `run-${label}`, ok: true, delivered: true, trajectory: `partial sums ${steps.join(",")}; applied bias ${bias}; result ${result}`, deliverable: JSON.stringify({ result, steps }), error: "" };
    },
  };
  return { adapter, requests, runs, peak: () => peak };
}
function options(mode: Mode, k: number, adapter: HarnessAdapter, budgets: Partial<Budgets> = {}): RunOptions {
  const base: RunView[] = Array.from({ length: k }, (_, i) => ({ label: `base${i + 1}`, runId: `run-base${i + 1}`, ok: true, delivered: true, trajectory: "partial sums 2,5,10; applied bias 0; result 10", deliverable: '{"result":10,"steps":[2,5,10]}', error: "" }));
  return { mode, k, taskId: "sum/one", task: "Sum 2,3,5 and apply configured bias", base, baseTree: harness(0), adapter, slots: createSlots(2), budgets: { proposalWidth: 4, rolloutWidth: 4, transportAttempts: 2, maxInvocations: 3 * k * 4, maxRollouts: 4 * k, ...budgets } };
}
const selector: SelectionAdapter = {
  async select({ candidates }) {
    const ordered = Object.entries(candidates).map(([id, text]) => {
      const value: unknown = JSON.parse(text);
      assert.ok(value && typeof value === "object" && "result" in value && typeof value.result === "number" && Number.isFinite(value.result));
      return { id, result: value.result };
    }).sort((a, b) => b.result - a.result);
    return { id: ordered[0].id, why: "largest computed numeric deliverable", usd: 0.3 };
  },
};
function selectionOptions(run: RunOptions, rollouts: Record<string, RunView>): SelectionOptions {
  return { taskId: run.taskId, task: run.task, mode: run.mode, k: run.k, rollouts, slots: run.slots, transportAttempts: 2, adapter: selector };
}

for (const mode of ["agg", "seq"] as const) for (const k of [1, 2]) {
  test(`${mode} k=${k}: numeric artifacts, exact cardinality, stable evidence and ledger`, async () => {
    const fixture = numericAdapter(), run = options(mode, k, fixture.adapter);
    const result = await runMode(run);
    assert.equal(result.ok, true);
    assert.equal(result.stages.length, 3 * k);
    assert.equal(Object.keys(result.rollouts).length, 4 * k);
    assert.deepEqual(result.usage, { invocations: 3 * k, rollouts: 4 * k });
    assert.ok(fixture.peak() <= 2);
    for (const stage of result.stages) {
      const artifact = JSON.parse(result.rollouts[stage.label].deliverable!);
      assert.deepEqual(artifact.steps, [2, 5, 10]);
      assert.equal(artifact.result, 10 + biasOf(stage.tree));
      assert.equal(stage.attempts, 1); assert.equal(stage.fellBack, false);
    }
    const reference = referenceCases.find(c => c.mode === mode && c.k === k)!;
    assert.deepEqual({stages:result.stages.map(s=>s.label),finals:result.finals,biases:result.finals.map(label=>biasOf(result.trees[label])),trace:result.ledger.map(e=>`${e.kind}:${e.label}`)}, {stages:reference.stages,finals:reference.finals,biases:reference.biases,trace:reference.trace});
    for (const request of fixture.requests) {
      assert.deepEqual(request.evidence.base, run.base);
      assert.equal(request.evidence.base.length, k);
      if (mode === "agg") assert.equal(biasOf(request.evidence.current), 0);
    }
    if (mode === "agg") {
      const proposals = fixture.requests.filter(r => r.dimension === "INV" || r.dimension === "DOM");
      assert.ok(proposals.every(r => r.evidence.pool.length === 0));
      const compositions = fixture.requests.filter(r => r.dimension === "AGG");
      assert.ok(compositions.every(r => r.evidence.pool.length === 2 * k && Object.keys(r.evidence.decisions).length === 2 * k));
      if (k === 2) assert.deepEqual(compositions[0].evidence, compositions[1].evidence);
    } else if (k === 2) {
      const second = fixture.requests.find(r => r.label === "inv2")!;
      assert.equal(biasOf(second.evidence.current), 12);
      assert.deepEqual(second.evidence.pool.map(c => c.label), ["inv1", "dom1", "c1"]);
      assert.deepEqual(fixture.requests.find(r => r.label === "c2")!.evidence.pool.map(c => c.label), ["inv1", "dom1", "c1", "inv2", "dom2"]);
    }
    const selection = await selectFinal(selectionOptions(run, result.rollouts));
    assert.equal(selection.ok, true); assert.equal(selection.trivial, k === 1);
    assert.equal(selection.invocations, k === 1 ? 0 : 1);
    assert.equal(selection.chosenLabel, result.finals.at(-1));
    assert.ok(Object.values(selection.idMap).every(label => result.finals.includes(label)));
    const serialFixture = numericAdapter(), serial = options(mode, k, serialFixture.adapter, { proposalWidth: 1, rolloutWidth: 1 });
    const serialResult = await runMode(serial);
    assert.deepEqual(serialResult.ledger, result.ledger);
    assert.deepEqual(serialResult.trees, result.trees);
  });
}

test("rejected/missing/empty/off-surface/unsafe trees retry once; noop accepted; failures roll fallback", async () => {
  const invalidTrees: Array<Tree | undefined> = [undefined, {}, { "../bad": "x" }, { "config.json": "not-json" }, { "config.json": '{"passed_count":2}' }];
  for (const invalid of invalidTrees) {
    const fixture = numericAdapter();
    fixture.adapter.propose = async () => ({ tree: invalid });
    const result = await runMode(options("agg", 1, fixture.adapter));
    for (const stage of result.stages.slice(0, 2)) {
      assert.equal(stage.fellBack, true); assert.equal(stage.attempts, 2); assert.equal(stage.invocations, 2);
      assert.deepEqual(stage.tree, harness(0)); assert.ok(stage.error);
      assert.equal(JSON.parse(result.rollouts[stage.label].deliverable!).result, 10);
    }
    assert.equal(result.ok, true); // Faithful source: fallback stage is not top-level mode error.
  }
  const fixture = numericAdapter();
  fixture.adapter.propose = async request => request.attempt === 1 ? { tree: harness(7), rejected: ["z", "a"] } : { tree: request.evidence.current };
  const result = await runMode(options("agg", 1, fixture.adapter));
  assert.ok(result.stages.slice(0, 2).every(s => s.attempts === 2 && !s.fellBack));
  const noopFixture = numericAdapter(); noopFixture.adapter.propose = async request => ({ tree: request.evidence.current, cached: true });
  const noop = await runMode(options("seq", 1, noopFixture.adapter));
  assert.ok(noop.stages.slice(0, 2).every(s => s.keptBase && !s.fellBack && s.attempts === 0 && s.cached));
});

test("transport bounded/counts costs; evidence failure zero attempts; missing/dead rollouts recorded", async () => {
  const fixture = numericAdapter(), original = fixture.adapter.propose;
  fixture.adapter.propose = async request => { if (request.transportAttempt === 1) throw new TransportError("offline", 0.4); return original(request); };
  const result = await runMode(options("agg", 1, fixture.adapter));
  assert.equal(result.usage.invocations, 5);
  assert.ok(result.stages.slice(0, 2).every(s => s.attempts === 2 && s.usd === 0.5 && !s.fellBack));
  const dead = numericAdapter(); dead.adapter.propose = async () => { throw new TransportError("permanent", 0.4); };
  dead.adapter.rollout = async ({ label }) => { if (label === "inv1") return undefined; throw new Error("executor dead"); };
  const failed = await runMode(options("agg", 1, dead.adapter));
  assert.ok(failed.stages.slice(0, 2).every(s => s.fellBack && s.attempts === 2 && s.usd === 0.8));
  assert.ok(Object.values(failed.rollouts).filter(r => !r.label.startsWith("base")).every(r => !r.ok && !r.delivered && r.error));
  const evidence = numericAdapter(); evidence.adapter.prepareEvidence = async () => { throw new Error("render failed"); };
  const noEvidence = await runMode(options("seq", 1, evidence.adapter));
  assert.ok(noEvidence.stages.every(s => s.fellBack && s.attempts === 0 && s.error.startsWith("could not build evidence:")));
  const capped = numericAdapter(); capped.adapter.propose = async () => ({ tree: {} });
  const exhausted = await runMode(options("agg", 1, capped.adapter, { maxInvocations: 3 }));
  assert.equal(exhausted.usage.invocations, 3);
  assert.ok(exhausted.stages.some(s => s.error.includes("budget exhausted")));
  await assert.rejects(runMode(options("agg", 2, numericAdapter().adapter, { maxRollouts: 7 })), BudgetError);
});

test("caller-owned slots bound aggregate concurrency across simultaneous modes", async () => {
  const fixture = numericAdapter(), slots = createSlots(1);
  await Promise.all([runMode({ ...options("agg", 2, fixture.adapter), slots }), runMode({ ...options("seq", 2, fixture.adapter), slots })]);
  assert.equal(fixture.peak(), 1);
});

test("selection drops failed/missing before IDs, excludes base/intermediates, fallback remains non-ok", async () => {
  const run = options("agg", 2, numericAdapter().adapter), result = await runMode(run);
  result.rollouts.agg1 = { ...result.rollouts.agg1, delivered: false };
  const selected = await selectFinal(selectionOptions(run, result.rollouts));
  assert.deepEqual(selected.dropped, ["agg1"]); assert.deepEqual(Object.values(selected.idMap), ["agg2"]);
  assert.equal(selected.nCandidates, 1); assert.equal(selected.trivial, false);
  const failed = await selectFinal({ ...selectionOptions(run, result.rollouts), adapter: { async select() { throw new Error("selector failed"); } } });
  assert.equal(failed.ok, false); assert.equal(failed.fallback, true); assert.equal(failed.chosenLabel, "agg2");
  const invalid = await selectFinal({ ...selectionOptions(run, result.rollouts), adapter: { async select() { return { id: "base1" }; } } });
  assert.equal(invalid.ok, false); assert.equal(invalid.fallback, true);
  const empty = await selectFinal({ ...selectionOptions(run, result.rollouts), rollouts: { base1: run.base[0] } });
  assert.equal(empty.ok, false); assert.equal(empty.chosenLabel, "");
  const renderFailure = await selectFinal({ ...selectionOptions(run, result.rollouts), adapter: { ...selector, async render() { throw new Error("bad renderer"); } } });
  assert.match(renderFailure.dropped[1], /render failed/);
  assert.equal(renderFailure.ok, false);
  const persisted = await selectFinal({ ...selectionOptions(run, result.rollouts), persist: async () => { throw new Error("disk full"); } });
  assert.equal(persisted.ok, false); assert.match(persisted.error, /could not persist/);
  const ids = assignIds(["c2", "c1"], "task", 2, "seq");
  assert.deepEqual(ids, assignIds(["c1", "c2"], "task", 2, "seq"));
  const many = assignIds(Array.from({ length: 28 }, (_, i) => `c${i}`), "task", 28, "seq");
  assert.ok(many.AA && many.AB); assert.equal(new Set(Object.values(many)).size, 28);
  assert.deepEqual(Object.keys(selectionPool("agg", 2, result.rollouts)), ["agg1", "agg2"]);
});

test("trajectory fallback explicit; contaminated evidence never reaches selector", async () => {
  const fixture = numericAdapter(), run = options("seq", 1, fixture.adapter), result = await runMode(run);
  result.rollouts.c1.delivered = false; delete result.rollouts.c1.deliverable;
  const selected = await selectFinal({ ...selectionOptions(run, result.rollouts), stateDeliverable: true });
  assert.equal(selected.ok, true); assert.equal(selected.evidence, "trajectory"); assert.deepEqual(selected.dropped, []);
  result.rollouts.c1 = { ...result.rollouts.c1, delivered: true, deliverable: '"test_pass_rate": 1' };
  await assert.rejects(selectFinal(selectionOptions(run, result.rollouts)), /grader verdict/);
});

test("reflection requires adoption, sees full refinement; library scope, atomic persistence and eligibility", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-method-"));
  try {
    const fixture = numericAdapter(), run = options("seq", 2, fixture.adapter), result = await runMode(run);
    const selection = await selectFinal(selectionOptions(run, result.rollouts));
    const before = structuredClone(result.trees);
    const experience = await reflectAdoption({ selection, result, task: run.task, baseTree: run.baseTree, slots: run.slots, transportAttempts: 2,
      async reflect({ evidence, baseTree, adoption }) {
        assert.deepEqual(evidence.pool.map(c => c.label), ["inv1", "dom1", "c1", "inv2", "dom2", "c2"]);
        assert.equal(Object.keys(evidence.decisions).length, 6); assert.equal(evidence.base.length, 2);
        assert.equal(biasOf(baseTree), 0); assert.equal(adoption.chosenLabel, "c2");
        return { experience: { cue: "numeric additive task", lesson: "compare complete partial sums before combining bias", evidence: "c2 trajectory: partial sums 2,5,10, result 58", confidence: "supported" } };
      } });
    assert.ok(experience); assert.deepEqual(result.trees, before); // Reflection never promotes a policy.
    const scope: LibraryScope = { project: "project", domain: "arithmetic", model: "model", version: "pinned", runTag: "run-one", mode: "seq", k: 2 };
    const library = new Library(directory, scope);
    assert.deepEqual(await library.entries(), []); assert.equal(await library.add(selection, result), true);
    assert.deepEqual(await library.treeOf(run.taskId), result.trees.c2);
    assert.deepEqual((await library.entries())[0].experience, experience);
    assert.deepEqual(await library.context([]), []);
    for (const field of ["project", "domain", "model", "version", "runTag"] as const) assert.deepEqual(await new Library(directory, { ...scope, [field]: "different" }).entries(), []);
    const reload = new Library(directory, scope); assert.equal((await reload.entries()).length, 1);
    assert.equal(await reload.add({ ...selection, fallback: true }, result), false);
    assert.equal(await reload.add({ ...selection, ok: false }, result), false);
    assert.equal(await reload.add({ ...selection, experience: undefined }, result), false);
    await assert.rejects(reload.add({ ...selection, experience: { cue: "cue", lesson: '"passed_count":2', evidence: "evidence" } }, result), /grader verdict/);
    assert.equal((await reload.entries()).length, 1);
    const onDisk = JSON.parse(await readFile(library.file, "utf8"));
    assert.equal(onDisk.entries[0].scope.project, scope.project);
    assert.equal((await readdir(join(library.file, ".."))).filter(name => name.endsWith(".tmp")).length, 0);
    await library.retain([]); assert.deepEqual(await library.entries(), []);
    await library.add(selection, result); await library.forget([run.taskId]); assert.deepEqual(await library.entries(), []);
    await library.add(selection, result);
    onDisk.scope.model = "foreign"; await writeFile(library.file, JSON.stringify(onDisk));
    await assert.rejects(library.entries(), /scope/);
    let called = false;
    assert.equal(await reflectAdoption({ selection: { ...selection, ok: false }, result, task: run.task, baseTree: run.baseTree, slots: run.slots, transportAttempts: 1, async reflect() { called = true; return {}; } }), undefined);
    assert.equal(called, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
