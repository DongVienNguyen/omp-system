// Copyright 2026 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// https://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.
// Port of harness2/core/recursion.py, revision 1cfe254e8d25b15f37048c3730134686abe60335.

export type Tree = Readonly<Record<string, string>>;
export type Mode = "agg" | "seq";
export type Dimension = "INV" | "DOM" | "AGG" | "COMPOSE";
export interface RunView {
  label: string;
  runId: string;
  ok: boolean;
  delivered: boolean;
  trajectory: string;
  deliverable?: string;
  error: string;
}
export interface Candidate { label: string; tree: Tree; rollout?: RunView; experience?: {cue:string;lesson:string;evidence:string;confidence?:string;edits?:string}; provenance?: {taskId:string;runId:string;why:string} }
export interface Evidence {
  taskId: string;
  task: string;
  source: Tree;
  current: Tree;
  base: readonly RunView[];
  pool: readonly Candidate[];
  decisions: Readonly<Record<string, string>>;
  library: readonly Candidate[];
}
export interface StageRequest {
  label: string;
  dimension: Dimension;
  index: number;
  k: number;
  round?: number;
  attempt: number;
  transportAttempt: number;
  rejection: string;
  evidence: Evidence;
}
export interface Proposal {
  tree?: Tree; // Missing harvest and empty harvest are distinct rejected outputs.
  rejected?: readonly string[];
  notes?: string;
  usd?: number;
  cached?: boolean;
}
export interface HarnessAdapter {
  propose(request: StageRequest): Promise<Proposal>;
  compose(request: StageRequest): Promise<Proposal>;
  rollout(request: { taskId: string; label: string; tree: Tree }): Promise<Omit<RunView, "label"> | undefined>;
  // Enforce substrate surface/reserved files here; may return an auto-repaired tree.
  validateTree(tree: Tree): void | Tree;
  prepareEvidence?(evidence: Evidence): Promise<Evidence>;
}
export interface Slots { run<T>(job: () => Promise<T>): Promise<T> }
/** Share ONE caller-owned instance across tasks, modes, selection and reflection. */
export function createSlots(capacity: number): Slots {
  positive(capacity, "slot capacity");
  let active = 0;
  const waiting: Array<() => void> = [];
  return { async run<T>(job: () => Promise<T>): Promise<T> {
    if (active === capacity) {
      const { promise, resolve } = Promise.withResolvers<void>();
      waiting.push(resolve);
      await promise;
    } else active++;
    try { return await job(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  } };
}
export class TransportError extends Error {
  readonly usd: number;
  constructor(message: string, usd = 0) { super(message); this.name = "TransportError"; this.usd = usd; }
}
export class BudgetError extends Error {}
export interface Budgets {
  proposalWidth: number;
  rolloutWidth: number;
  transportAttempts: number;
  maxInvocations: number;
  maxRollouts: number; // Includes caller's k shared base executions.
}
export interface Stage {
  label: string;
  dimension: Dimension;
  tree: Tree;
  keptBase: boolean;
  fellBack: boolean;
  error: string;
  attempts: number;
  invocations: number;
  usd: number;
  cached: boolean;
  notes: string;
}
export interface LedgerEntry {
  kind: "session" | "rollout";
  label: string;
  attempts: number;
  usd: number;
  cached: boolean;
}
export interface ModeResult {
  mode: Mode;
  taskId: string;
  k: number;
  stages: Stage[];
  trees: Record<string, Tree>;
  rollouts: Record<string, RunView>;
  finals: string[];
  ledger: LedgerEntry[];
  errors: string[];
  ok: boolean; // Like source: stage/rollout failures do not become orchestration errors.
  usage: { invocations: number; rollouts: number };
}
export interface RunOptions {
  mode: Mode;
  taskId: string;
  task: string;
  source?: Tree;
  k: number;
  base: readonly RunView[];
  baseTree: Tree;
  library?: readonly Candidate[];
  adapter: HarnessAdapter;
  slots: Slots;
  budgets: Budgets;
}
export const GRADER_MARKERS = [
  "deterministic_eval_summary", "deterministic_eval_result",
  "judge_scope_and_deterministic_status", "Judge findings on the rendered result",
  '"passed_count"', '"pass_rate"', '"test_pass_rate"',
] as const;
export function assertClean(value: unknown): void {
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      for (const marker of GRADER_MARKERS) if (item.includes(marker)) {
        throw new Error(`grader verdict would enter model context: ${marker}`);
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
      visit(key); visit(child);
    }
  };
  visit(value);
}
export function assertTree(tree: Tree): void {
  if (!tree || typeof tree !== "object" || Array.isArray(tree) || !Object.keys(tree).length) {
    throw new Error("harness came back empty -- edit files, do not delete them all");
  }
  for (const [path, body] of Object.entries(tree)) {
    if (!path || path.includes("\\") || path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === "..") || /^[A-Za-z]:/.test(path) || typeof body !== "string") {
      throw new Error(`invalid harness file: ${path}`);
    }
  }
  assertClean(tree);
}
export function positive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
}
export function errorText(error: unknown): string { return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 400); }
function clone<T>(value: T): T { return structuredClone(value); }
function sameTree(a: Tree, b: Tree): boolean {
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}
async function orderedMap<T, U>(items: readonly T[], width: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; out[index] = await fn(items[index]); }
  }));
  return out;
}
/** k shared bases + 2k proposals + k compositions; retries never add stages. */
export async function runMode(options: RunOptions): Promise<ModeResult> {
  const { mode, taskId, k, adapter, slots, budgets } = options;
  if (mode !== "agg" && mode !== "seq") throw new Error(`unknown mode ${mode}; expected agg or seq`);
  positive(k, "k");
  for (const [key, value] of Object.entries(budgets)) positive(value, key);
  if (options.base.length !== k) throw new BudgetError(`expected ${k} shared base rollouts`);
  if (budgets.maxRollouts < 4 * k || budgets.maxInvocations < 3 * k) throw new BudgetError("budget cannot cover 4k rollouts and 3k stages");
  assertTree(options.baseTree);
  const base = clone(options.base);
  const labels = base.map(r => r.label);
  const reserved = new Set(Array.from({ length: k }, (_, i) => [`inv${i + 1}`, `dom${i + 1}`, mode === "agg" ? `agg${i + 1}` : `c${i + 1}`]).flat());
  if (new Set(labels).size !== k || labels.some(label => reserved.has(label))) throw new BudgetError("duplicate/reserved base label");
  const result: ModeResult = {
    mode, taskId, k, stages: [], trees: {}, rollouts: {}, finals: [], ledger: [], errors: [], ok: false,
    usage: { invocations: 0, rollouts: k },
  };
  for (const run of base) { result.rollouts[run.label] = run; result.ledger.push({ kind: "rollout", label: run.label, attempts: 1, usd: 0, cached: false }); }
  const decisions = (): Record<string, string> => Object.fromEntries(result.stages.map(s => [s.label, s.notes || s.error]));
  const stage = async (label: string, dimension: Dimension, index: number, current: Tree, pool: readonly Candidate[], round?: number): Promise<Stage> => {
    const out: Stage = { label, dimension, tree: clone(current), keptBase: false, fellBack: true, error: "", attempts: 0, invocations: 0, usd: 0, cached: true, notes: "" };
    let evidence: Evidence = { taskId, task: options.task, source: clone(options.source ?? {}), current: clone(current), base: clone(base), pool: clone(pool), decisions: decisions(), library: clone(options.library ?? []) };
    try {
      assertClean(evidence);
      if (adapter.prepareEvidence) evidence = await slots.run(() => adapter.prepareEvidence!(clone(evidence)));
      assertClean(evidence);
      if (base.length && !evidence.base.some(run => run.trajectory.trim() && !run.trajectory.startsWith("(trajectory unavailable:"))) throw new Error("no trajectory could be rendered for ANY rollout");
    } catch (error) { out.error = `could not build evidence: ${errorText(error)}`.slice(0, 400); out.cached = false; return out; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      let reply: Proposal | undefined;
      let transportFailed = false;
      for (let transportAttempt = 1; transportAttempt <= budgets.transportAttempts; transportAttempt++) {
        if (result.usage.invocations >= budgets.maxInvocations) { out.error = "proposal invocation budget exhausted"; out.cached = false; transportFailed = true; break; }
        result.usage.invocations++; out.invocations++;
        try {
          const request: StageRequest = { label, dimension, index, k, round, attempt, transportAttempt, rejection: out.error, evidence: clone(evidence) };
          reply = await slots.run(() => dimension === "INV" || dimension === "DOM" ? adapter.propose(request) : adapter.compose(request));
          if (!reply || typeof reply !== "object") throw new Error("proposal callback returned no reply");
          if (reply.usd !== undefined && (!Number.isFinite(reply.usd) || reply.usd < 0)) throw new Error("invalid proposal cost");
          out.usd += reply.usd ?? 0;
          out.attempts += reply.cached ? 0 : 1;
          out.cached = out.cached && !!reply.cached;
          break;
        } catch (error) {
          out.attempts++; out.cached = false; out.error = errorText(error);
          if (error instanceof TransportError && Number.isFinite(error.usd) && error.usd >= 0) out.usd += error.usd;
          if (!(error instanceof TransportError) || transportAttempt === budgets.transportAttempts) { transportFailed = true; break; }
        }
      }
      if (transportFailed) break; // Source does not retry a failed proposer session as a rejected tree.
      try {
        if (!reply?.tree) throw new Error("harness directory did not come back from session; edit files in place");
        if (reply.rejected?.length) throw new Error(`off editable surface: ${[...reply.rejected].sort().slice(0, 6).join(", ")}`);
        let tree = clone(reply.tree);
        assertTree(tree);
        tree = adapter.validateTree(tree) ?? tree;
        assertTree(tree);
        out.keptBase = sameTree(current, tree);
        assertClean(reply.notes ?? "");
        out.tree = clone(tree); out.fellBack = false; out.error = ""; out.notes = (reply.notes ?? "").trim();
        return out;
      } catch (error) {
        out.error = errorText(error);
        // Keep repairable workspace edits, never leak rejected verdicts/unsafe paths.
        if (reply?.tree) {
          try { assertTree(reply.tree); evidence = { ...evidence, current: clone(reply.tree) }; }
          catch { /* Rejection text explains failure; unsafe harvest stays out of evidence. */ }
        }
      }
    }
    return out;
  };
  const record = (stages: Stage[]): void => {
    for (const item of stages) {
      result.stages.push(item); result.trees[item.label] = item.tree;
      result.ledger.push({ kind: "session", label: item.label, attempts: item.attempts, usd: item.usd, cached: item.cached });
    }
  };
  const roll = async (stages: readonly Stage[]): Promise<void> => {
    const runs = await orderedMap(stages, budgets.rolloutWidth, async item => {
      if (result.usage.rollouts >= budgets.maxRollouts) throw new BudgetError("rollout budget exhausted");
      result.usage.rollouts++;
      try {
        const run = await slots.run(() => adapter.rollout({ taskId, label: item.label, tree: clone(item.tree) }));
        if (!run) throw new Error("adapter returned a missing run directory");
        return { ...run, label: item.label };
      } catch (error) { return { label: item.label, runId: "", ok: false, delivered: false, trajectory: "", error: errorText(error) }; }
    });
    for (const run of runs) { result.rollouts[run.label] = run; result.ledger.push({ kind: "rollout", label: run.label, attempts: 1, usd: 0, cached: false }); }
  };
  const candidates = (stages: readonly Stage[]): Candidate[] => stages.map(s => ({ label: s.label, tree: s.tree, rollout: result.rollouts[s.label] }));
  if (mode === "agg") {
    const specs = Array.from({ length: k }, (_, i) => [{ label: `inv${i + 1}`, dimension: "INV" as const, index: i + 1 }, { label: `dom${i + 1}`, dimension: "DOM" as const, index: i + 1 }]).flat();
    const proposals = await orderedMap(specs, budgets.proposalWidth, s => stage(s.label, s.dimension, s.index, options.baseTree, []));
    record(proposals); await roll(proposals);
    const pool = candidates(proposals);
    const finals = await orderedMap(Array.from({ length: k }, (_, i) => i + 1), budgets.proposalWidth, i => stage(`agg${i}`, "AGG", i, options.baseTree, pool));
    record(finals); result.finals = finals.map(s => s.label); await roll(finals);
  } else {
    let current = clone(options.baseTree);
    let history: Candidate[] = [];
    for (let t = 1; t <= k; t++) {
      const proposals = await orderedMap(["INV", "DOM"] as const, budgets.proposalWidth, d => stage(`${d.toLowerCase()}${t}`, d, t, current, history, k > 1 ? t : undefined));
      record(proposals); await roll(proposals);
      const pool = [...history, ...candidates(proposals)];
      const composition = await stage(`c${t}`, "COMPOSE", t, current, pool, k > 1 ? t : undefined);
      record([composition]); await roll([composition]);
      history = [...pool, ...candidates([composition])]; current = composition.tree; result.finals.push(composition.label);
    }
  }
  for (const kind of ["session", "rollout"] as const) {
    const entries = result.ledger.filter(e => e.kind === kind);
    if (entries.length !== (kind === "session" ? 3 : 4) * k || new Set(entries.map(e => e.label)).size !== entries.length) throw new BudgetError("ledger identity violated");
  }
  result.ok = result.finals.length > 0 && result.errors.length === 0;
  return result;
}
