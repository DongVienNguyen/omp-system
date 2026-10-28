// Copyright 2026 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// https://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.
// Port of harness2/core/selection.py, revision 1cfe254e8d25b15f37048c3730134686abe60335.
import { createHash } from "node:crypto";
import { assertClean, errorText, positive, TransportError } from "./recursion.ts";
import type { Candidate, Evidence, Mode, ModeResult, RunView, Slots, Tree } from "./recursion.ts";

export interface Experience { cue: string; lesson: string; evidence: string; confidence?: string; edits?: string }
export interface Selection {
  taskId: string;
  mode: Mode;
  k: number;
  chosenId: string;
  chosenLabel: string;
  chosenRunId: string;
  chosenIsBase: boolean;
  why: string;
  idMap: Record<string, string>;
  dropped: string[];
  nCandidates: number;
  ok: boolean;
  fallback: boolean;
  error: string;
  usd: number;
  trivial: boolean;
  evidence: "deliverable" | "trajectory";
  experience?: Experience;
  invocations: number;
}
/** CPython Random(int).shuffle: preserve pinned anonymous IDs, not JS engine RNG. */
export function assignIds(labels: readonly string[], taskId: string, k: number, mode: Mode): Record<string, string> {
  const seed = BigInt(`0x${createHash("sha1").update(`${taskId}|${k}|${mode}`).digest("hex").slice(0, 12)}`);
  const key = [Number(seed & 0xffffffffn)];
  if (seed >> 32n) key.push(Number(seed >> 32n));
  const mt = new Uint32Array(624); mt[0] = 19650218;
  for (let i = 1; i < 624; i++) mt[i] = (Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1812433253) + i) >>> 0;
  let i = 1, j = 0;
  for (let n = Math.max(624, key.length); n; n--) {
    mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
    i++; j++; if (i >= 624) { mt[0] = mt[623]; i = 1; } if (j >= key.length) j = 0;
  }
  for (let n = 623; n; n--) {
    mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
    i++; if (i >= 624) { mt[0] = mt[623]; i = 1; }
  }
  mt[0] = 0x80000000;
  let cursor = 624;
  const word = (): number => {
    if (cursor >= 624) {
      for (let n = 0; n < 624; n++) {
        const y = (mt[n] & 0x80000000) | (mt[(n + 1) % 624] & 0x7fffffff);
        mt[n] = mt[(n + 397) % 624] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      }
      cursor = 0;
    }
    let y = mt[cursor++]; y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
    return y >>> 0;
  };
  const ordered = [...labels].sort();
  for (let n = ordered.length - 1; n > 0; n--) {
    const bits = Math.floor(Math.log2(n + 1)) + 1;
    let index: number;
    do { index = word() >>> (32 - bits); } while (index >= n + 1);
    [ordered[n], ordered[index]] = [ordered[index], ordered[n]];
  }
  return Object.fromEntries(ordered.map((label, index) => {
    let id = "", n = index + 1;
    while (n) { const remainder = (n - 1) % 26; id = String.fromCharCode(65 + remainder) + id; n = Math.floor((n - 1) / 26); }
    return [id, label];
  }));
}
export function selectionPool(mode: Mode, k: number, rollouts: Readonly<Record<string, RunView>>): Record<string, RunView> {
  positive(k, "k");
  if (mode !== "agg" && mode !== "seq") throw new Error("unknown mode");
  const pool: Record<string, RunView> = {};
  for (let i = 1; i <= k; i++) { const label = `${mode === "agg" ? "agg" : "c"}${i}`; if (rollouts[label]) pool[label] = rollouts[label]; }
  return pool;
}
export interface SelectorReply { id: string; why?: string; usd?: number }
export interface SelectionAdapter {
  render?(run: RunView): Promise<string>;
  trajectory?(run: RunView): Promise<string>;
  select(request: { task: string; source: Tree; candidates: Readonly<Record<string, string>>; transportAttempt: number }): Promise<SelectorReply>;
}
export interface SelectionOptions {
  taskId: string;
  task: string;
  source?: Tree;
  mode: Mode;
  k: number;
  rollouts: Readonly<Record<string, RunView>>;
  adapter: SelectionAdapter;
  slots: Slots;
  transportAttempts: number;
  stateDeliverable?: boolean;
  persist?(selection: Selection): Promise<void>;
}
export async function selectFinal(options: SelectionOptions): Promise<Selection> {
  const { taskId, mode, k, adapter, slots } = options;
  positive(options.transportAttempts, "transportAttempts");
  const candidates = selectionPool(mode, k, options.rollouts);
  const selection: Selection = { taskId, mode, k, chosenId: "", chosenLabel: "", chosenRunId: "", chosenIsBase: false, why: "", idMap: {}, dropped: [], nCandidates: 0, ok: false, fallback: false, error: "", usd: 0, trivial: k === 1, evidence: "deliverable", invocations: 0 };
  const pool: Record<string, RunView> = {}, artifacts: Record<string, string> = {};
  for (const [label, run] of Object.entries(candidates)) {
    if (!(run.ok && run.delivered)) { selection.dropped.push(label); continue; }
    try {
      const text = adapter.render ? await slots.run(() => adapter.render!(structuredClone(run))) : run.deliverable ?? "";
      if (!text.trim()) { selection.dropped.push(label); continue; }
      pool[label] = run; artifacts[label] = text;
    } catch (error) { selection.dropped.push(`${label} (render failed: ${errorText(error)})`.slice(0, 200)); }
  }
  if (!Object.keys(pool).length && options.stateDeliverable) {
    for (const [label, run] of Object.entries(candidates)) {
      if (!run.ok) continue;
      try {
        const text = adapter.trajectory ? await slots.run(() => adapter.trajectory!(structuredClone(run))) : run.trajectory;
        if (!text.trim() || text.startsWith("(no trajectory")) continue;
        pool[label] = run; artifacts[label] = `(this task produced no file deliverable; candidate shown as its own session transcript)\n\n${text}`;
      } catch (error) { selection.dropped.push(`${label} (trajectory failed: ${errorText(error)})`.slice(0, 200)); }
    }
    if (Object.keys(pool).length) { selection.evidence = "trajectory"; selection.dropped = selection.dropped.filter(label => !pool[label]); }
  }
  selection.nCandidates = Object.keys(pool).length;
  if (!selection.nCandidates) { selection.error = "no candidate produced an artifact (finals-only pool has no base fallback)"; return selection; }
  assertClean({ task: options.task, source: options.source ?? {}, artifacts }); // Tripwire failures are adapter bugs, not selector fallback.
  selection.idMap = k === 1 ? { A: Object.keys(pool)[0] } : assignIds(Object.keys(pool), taskId, k, mode);
  if (k === 1) {
    selection.chosenId = "A"; selection.chosenLabel = selection.idMap.A; selection.ok = true;
    selection.why = "trivial pool: single final at k=1; delivered without a selector session";
  } else {
    try {
      let reply: SelectorReply | undefined;
      for (let attempt = 1; attempt <= options.transportAttempts; attempt++) {
        selection.invocations++;
        try {
          reply = await slots.run(() => adapter.select({ task: options.task, source: structuredClone(options.source ?? {}), candidates: Object.fromEntries(Object.entries(selection.idMap).map(([id, label]) => [id, artifacts[label]])), transportAttempt: attempt }));
          if (reply.usd !== undefined && (!Number.isFinite(reply.usd) || reply.usd < 0)) throw new Error("invalid selector cost");
          selection.usd += reply.usd ?? 0;
          break;
        } catch (error) {
          if (error instanceof TransportError && Number.isFinite(error.usd) && error.usd >= 0) selection.usd += error.usd;
          if (!(error instanceof TransportError) || attempt === options.transportAttempts) throw error;
        }
      }
      if (!reply || !Object.hasOwn(selection.idMap, reply.id)) throw new Error(`chose ${reply?.id ?? "no ID"}, which is not an anonymous final`);
      selection.chosenId = reply.id; selection.chosenLabel = selection.idMap[reply.id]; selection.why = (reply.why ?? "").slice(0, 2000); selection.ok = true;
    } catch (error) {
      selection.chosenLabel = Object.keys(pool).sort()[0];
      selection.chosenId = Object.keys(selection.idMap).find(id => selection.idMap[id] === selection.chosenLabel)!;
      selection.fallback = true; selection.error = errorText(error); // Deliberately non-ok, even though a final can be delivered.
    }
  }
  selection.chosenRunId = pool[selection.chosenLabel].runId;
  if (options.persist) {
    try { await options.persist(structuredClone(selection)); }
    catch (error) { selection.ok = false; selection.error = `${selection.error} | could not persist selection: ${errorText(error)}`.slice(0, 400); }
  }
  return selection;
}
export function hasExperience(value: unknown): value is Experience {
  if (!value || typeof value !== "object" || !("cue" in value) || !("lesson" in value) || !("evidence" in value)) return false;
  if (![value.cue, value.lesson, value.evidence].every(field => typeof field === "string" && field.trim())) return false;
  return (!("confidence" in value) || value.confidence === undefined || typeof value.confidence === "string") && (!("edits" in value) || value.edits === undefined || typeof value.edits === "string");
}
export interface ReflectionOptions {
  selection: Selection;
  result: ModeResult;
  task: string;
  source?: Tree;
  baseTree: Tree;
  slots: Slots;
  transportAttempts: number;
  reflect(request: { evidence: Evidence; baseTree: Tree; adoption: { chosenLabel: string; candidateIds: Record<string, string>; reason: string }; transportAttempt: number }): Promise<{ experience?: Experience; usd?: number }>;
  persist?(selection: Selection): Promise<void>;
}
export async function reflectAdoption(options: ReflectionOptions): Promise<Experience | undefined> {
  const { selection, result } = options;
  positive(options.transportAttempts, "transportAttempts");
  const pool = selectionPool(result.mode, result.k, result.rollouts);
  const chosen = pool[selection.chosenLabel];
  if (!selection.ok || selection.fallback || selection.taskId !== result.taskId || selection.mode !== result.mode || selection.k !== result.k || !chosen?.ok || chosen.runId !== selection.chosenRunId || !result.trees[selection.chosenLabel]) return undefined;
  const candidates: Candidate[] = result.stages.map(stage => ({ label: stage.label, tree: stage.tree, rollout: result.rollouts[stage.label] }));
  const evidence: Evidence = { taskId: result.taskId, task: options.task, source: options.source ?? {}, current: result.trees[selection.chosenLabel], base: result.ledger.filter(e => e.kind === "rollout" && !result.trees[e.label]).map(e => result.rollouts[e.label]), pool: candidates, decisions: Object.fromEntries(result.stages.map(s => [s.label, s.notes || s.error])), library: [] };
  const adoption = { chosenLabel: selection.chosenLabel, candidateIds: selection.idMap, reason: selection.why };
  assertClean({ evidence, baseTree: options.baseTree, adoption });
  let experience: Experience | undefined;
  for (let attempt = 1; attempt <= options.transportAttempts; attempt++) {
    selection.invocations++;
    try {
      const reply = await options.slots.run(() => options.reflect({ evidence: structuredClone(evidence), baseTree: structuredClone(options.baseTree), adoption: structuredClone(adoption), transportAttempt: attempt }));
      if (reply.usd !== undefined && (!Number.isFinite(reply.usd) || reply.usd < 0)) throw new Error("invalid reflection cost");
      selection.usd += reply.usd ?? 0;
      if (!hasExperience(reply.experience)) return undefined;
      assertClean(reply.experience); experience = structuredClone(reply.experience); break;
    } catch (error) {
      if (error instanceof TransportError) {
        if (Number.isFinite(error.usd) && error.usd >= 0) selection.usd += error.usd;
        if (attempt < options.transportAttempts) continue;
        return undefined;
      }
      throw error;
    }
  }
  selection.experience = experience;
  if (options.persist) {
    try { await options.persist(structuredClone(selection)); }
    catch (error) { selection.ok = false; selection.error = `${selection.error} | could not persist selection: ${errorText(error)}`.slice(0, 400); return undefined; }
  }
  return experience;
}
