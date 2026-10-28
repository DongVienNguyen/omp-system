import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
export const profiles = ['omp-system-dev', 'omp-system-install-test'] as const;
const home = realpathSync(homedir());
const marker = { owner: 'omp-system/lab-v1', source: root };
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

export function requireHeadroom(target: string, minimumBytes = 2 * 1024 ** 3): number {
  if (!Number.isSafeInteger(minimumBytes) || minimumBytes <= 0) throw new Error('Invalid disk headroom limit');
  const stats = statfsSync(target);
  const free = stats.bavail * stats.bsize;
  if (free < minimumBytes) throw new Error(`Insufficient disk headroom at ${target}: ${free} bytes available, ${minimumBytes} required; no mutation permitted`);
  return free;
}

export function assertRealComponents(target: string): void {
  const absolute = resolve(target);
  let cursor = absolute;
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing linked path: ${cursor}`);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
export function within(base: string, target: string): boolean {
  const r = relative(resolve(base), resolve(target));
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('../') && !r.startsWith('..\\'));
}
export function profileRoot(name: string): string {
  if (!profiles.includes(name as typeof profiles[number])) throw new Error('Unknown lab profile');
  return join(home, '.omp', 'profiles', name);
}
export function protectedHashes(): Record<string, string> {
  const files = ['.omp/agent/config.yml', '.omp/agent/models.yml', '.omp/agent/mcp.json', '.omp/plugins/package.json', '.omp/plugins/omp-plugins.lock.json', '.agentkit/adapters/omp/engineer/omp-ownership.json'];
  const result: Record<string, string> = {};
  for (const file of files) { const p = join(home, file); if (existsSync(p)) result[file] = hash(p); }
  return result;
}
export function verifyOwnership(p: string): void {
  assertRealComponents(p);
  const owner = join(p, '.omp-system-owner.json');
  if (!existsSync(owner) || JSON.stringify(JSON.parse(readFileSync(owner, 'utf8'))) !== JSON.stringify(marker)) throw new Error(`Foreign lab directory: ${p}`);
}
export function childEnvironment(profile: string): NodeJS.ProcessEnv {
  verifyOwnership(profileRoot(profile));
  const lab = join(root, '.lab');
  verifyOwnership(lab);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (!['OMP_SYSTEM_API_KEY','OMP_SYSTEM_EXECUTABLE'].includes(key) && /^(OMP_|PI_|AGENTKIT_|CREWS_|CONTEXT_MODE_|XDG_)/.test(key)) delete env[key];
  }
  Object.assign(env, {
    OMP_PROFILE: profile, PI_PROFILE: profile,
    TEMP: join(lab, 'tmp'), TMP: join(lab, 'tmp'), TMPDIR: join(lab, 'tmp'),
    BUN_INSTALL_CACHE_DIR: join(lab, 'bun-cache'),
    OMP_SYSTEM_LAB_ROOT: root,
  });
  delete env.BUN_BE_BUN;
  return env;
}
export function preflight(): object {
  assertRealComponents(root);
  if (root === home || within(root, join(home, '.omp', 'agent'))) throw new Error('Source overlaps protected OMP home');
  requireHeadroom(root);
  requireHeadroom(home);
  const before = protectedHashes();
  const omp = process.env.OMP_SYSTEM_EXECUTABLE || join(home, '.local', 'bin', process.platform === 'win32' ? 'omp.exe' : 'omp');
  assertRealComponents(omp);
  const runtime = spawnSync(omp, ['--version'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, BUN_BE_BUN: '1' }, windowsHide: true });
  if (runtime.status !== 0 || !/^1\./.test(runtime.stdout.trim())) throw new Error('Embedded Bun runtime unavailable; no automatic install');
  const version = spawnSync(omp, ['--version'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, BUN_BE_BUN: '' }, windowsHide: true });
  if (version.status !== 0 || version.stdout.trim() !== 'omp/18.12.6') throw new Error('Unsupported OMP; expected 18.12.6');
  const owned = [join(root, '.lab'), ...profiles.map(profileRoot)];
  // Validate every existing directory before creating anything.
  for (const p of owned) { assertRealComponents(p); if (existsSync(p)) verifyOwnership(p); }
  for (const p of owned) {
    if (!existsSync(p)) { mkdirSync(p, { recursive: true }); writeFileSync(join(p, '.omp-system-owner.json'), JSON.stringify(marker)); }
  }
  for (const p of ['workspaces', 'tmp', 'bun-cache', 'evidence', 'state', 'sources']) mkdirSync(join(root, '.lab', p), { recursive: true });
  for (const name of profiles) {
    const agent = join(profileRoot(name), 'agent');
    mkdirSync(agent, { recursive: true });
    const config = join(agent, 'config.yml');
    if (!existsSync(config)) writeFileSync(config, 'autoResume: false\nmemory:\n  backend: off\nautolearn:\n  enabled: false\nadvisor:\n  enabled: false\nprewalk:\n  enabled: false\ntask:\n  maxConcurrency: 1\n  maxRecursionDepth: 1\n');
    const mcp = join(agent, 'mcp.json');
    if (!existsSync(mcp)) writeFileSync(mcp, '{"mcpServers":{}}\n');
  }
  const after = protectedHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Protected config drift; investigate, do not restore over concurrent work');
  const result = { owner: marker.owner, source: root, omp, ompVersion: version.stdout.trim(), bunVersion: runtime.stdout.trim(), profiles: Object.fromEntries(profiles.map(p => [p, profileRoot(p)])), protectedHashes: after, workerLimit: 1, sharedResources: 'CPU/RAM/disk/API remain shared; no OS sandbox guarantee' };
  writeFileSync(join(root, '.lab', 'preflight.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (import.meta.main) {
  try { console.log(JSON.stringify(preflight(), null, 2)); } catch (e) { console.error(String(e)); process.exitCode = 1; }
}
