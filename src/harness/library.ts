// Copyright 2026 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// https://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.
// Port of harness2/core/library.py, revision 1cfe254e8d25b15f37048c3730134686abe60335.
// Single scoped snapshot carries full adopted trees and lessons. Atomic rename
// replaces snapshot; nothing here installs or mutates a live harness/policy.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertClean, assertTree, positive } from "./recursion.ts";
import type { Candidate, Mode, ModeResult, Tree } from "./recursion.ts";
import { hasExperience, selectionPool } from "./selection.ts";
import type { Experience, Selection } from "./selection.ts";

export interface LibraryScope {
  project: string;
  domain: string;
  model: string;
  version: string;
  runTag: string; // Explicit sharing only. Different run tags start empty.
  mode: Mode;
  k: number;
}
export interface LibraryEntry {
  scope: LibraryScope;
  taskId: string;
  label: string;
  runId: string;
  why: string;
  tree: Tree;
  experience: Experience;
}
interface Snapshot { format: 1; scope: LibraryScope; entries: LibraryEntry[] }
const queues = new Map<string, Promise<void>>();
function scopeKey(scope: LibraryScope): string {
  for (const field of ["project", "domain", "model", "version", "runTag"] as const) {
    if (typeof scope[field] !== "string" || !scope[field].trim()) throw new Error(`missing library provenance: ${field}`);
  }
  positive(scope.k, "k");
  if (scope.mode !== "agg" && scope.mode !== "seq") throw new Error("invalid library mode");
  assertClean(scope);
  return JSON.stringify([scope.project, scope.domain, scope.model, scope.version, scope.runTag, scope.mode, scope.k]);
}
export class Library {
  readonly file: string;
  private readonly scope: LibraryScope;
  private readonly key: string;
  constructor(root: string, scope: LibraryScope) {
    this.key = scopeKey(scope);
    this.scope = structuredClone(scope);
    this.file = join(resolve(root), createHash("sha256").update(this.key).digest("hex"), "library.json");
  }
  async entries(): Promise<LibraryEntry[]> {
    let raw: string;
    try { raw = await readFile(this.file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const data: unknown = JSON.parse(raw);
    assertClean(data);
    if (!data || typeof data !== "object") throw new Error("invalid library snapshot");
    const snapshot = data as Snapshot;
    if (snapshot.format !== 1 || !snapshot.scope || scopeKey(snapshot.scope) !== this.key || !Array.isArray(snapshot.entries)) throw new Error("library scope/format mismatch");
    const tasks = new Set<string>();
    for (const entry of snapshot.entries) {
      if (!entry || !entry.scope || scopeKey(entry.scope) !== this.key || typeof entry.taskId !== "string" || !entry.taskId.trim() || typeof entry.runId !== "string" || !entry.runId || typeof entry.why !== "string" || !hasExperience(entry.experience)) throw new Error("invalid library entry/provenance");
      const validLabels = Array.from({ length: this.scope.k }, (_, index) => `${this.scope.mode === "agg" ? "agg" : "c"}${index + 1}`);
      if (!validLabels.includes(entry.label) || tasks.has(entry.taskId)) throw new Error("invalid/duplicate adopted library entry");
      tasks.add(entry.taskId); assertTree(entry.tree);
    }
    return structuredClone(snapshot.entries).sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0);
  }
  async context(beforeTaskIds?: readonly string[]): Promise<LibraryEntry[]> {
    const entries = await this.entries();
    return beforeTaskIds ? entries.filter(entry => beforeTaskIds.includes(entry.taskId)) : entries;
  }
  /** Full eligible trees, for explicit caller opt-in to proposal evidence. */
  async candidates(beforeTaskIds?: readonly string[]): Promise<Candidate[]> {
    return (await this.context(beforeTaskIds)).map(entry => ({ label: entry.taskId, tree: entry.tree, experience: entry.experience, provenance: {taskId:entry.taskId,runId:entry.runId,why:entry.why} }));
  }
  async treeOf(taskId: string): Promise<Tree | undefined> {
    return (await this.entries()).find(entry => entry.taskId === taskId)?.tree;
  }
  async add(selection: Selection, result: ModeResult): Promise<boolean> {
    // A delivered fallback is not an adoption; no lesson means no library entry.
    if (!selection.ok || selection.fallback || !hasExperience(selection.experience)) return false;
    if (selection.taskId !== result.taskId || selection.mode !== result.mode || selection.k !== result.k || result.mode !== this.scope.mode || result.k !== this.scope.k) throw new Error("adoption provenance mismatch");
    const run = selectionPool(result.mode, result.k, result.rollouts)[selection.chosenLabel];
    const tree = result.trees[selection.chosenLabel];
    if (!run?.ok || !run.runId || run.runId !== selection.chosenRunId || selection.idMap[selection.chosenId] !== selection.chosenLabel || !tree || (selection.evidence === "deliverable" && !run.delivered) || (selection.evidence === "trajectory" && !run.trajectory.trim())) return false;
    assertTree(tree);
    const entry: LibraryEntry = structuredClone({ scope: this.scope, taskId: result.taskId, label: selection.chosenLabel, runId: run.runId, why: selection.why, tree, experience: selection.experience });
    assertClean(entry);
    await this.update(entries => [...entries.filter(item => item.taskId !== entry.taskId), entry]);
    return true;
  }
  async forget(taskIds: readonly string[]): Promise<void> {
    await this.update(entries => entries.filter(entry => !taskIds.includes(entry.taskId)));
  }
  async retain(taskIds: readonly string[]): Promise<void> {
    await this.update(entries => entries.filter(entry => taskIds.includes(entry.taskId)));
  }
  private async update(change: (entries: LibraryEntry[]) => LibraryEntry[]): Promise<void> {
    // Serialize writers within process, even across Library instances for same scope.
    const previous = queues.get(this.file) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const entries = change(await this.entries()).sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0);
      const snapshot: Snapshot = { format: 1, scope: this.scope, entries };
      assertClean(snapshot);
      const directory = join(this.file, "..");
      await mkdir(directory, { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify(snapshot, null, 2) + "\n", "utf8"); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, this.file);
      } finally {
        try { await unlink(temporary); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    });
    queues.set(this.file, next);
    try { await next; } finally { if (queues.get(this.file) === next) queues.delete(this.file); }
  }
}
