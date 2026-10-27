import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const PACKAGE = 'omp-system';
export class LifecycleError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'LifecycleError'; }
}
function fail(code: string, message: string): never { throw new LifecycleError(code, message); }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function json(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fail('INVALID_RECORD', 'Missing or invalid scoped JSON record'); }
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function within(base: string, target: string): boolean {
  const r = relative(base, target);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('../') && !r.startsWith('..\\'));
}
/** Reject every symlink/junction component, including ancestors outside target root. */
export function canonicalPath(path: string): string {
  if (!isAbsolute(path)) fail('PATH_SCOPE', 'Absolute path required');
  const absolute = resolve(path);
  for (let p = absolute; ; p = dirname(p)) {
    try { if (lstatSync(p).isSymbolicLink()) fail('PATH_LINK', 'Symlink or junction forbidden'); }
    catch (e) { if (e instanceof LifecycleError) throw e; return fail('PATH_MISSING', 'Required path unavailable'); }
    if (dirname(p) === p) break;
  }
  let actual: string;
  try { actual = realpathSync.native(absolute); } catch { return fail('PATH_MISSING', 'Required path unavailable'); }
  if (relative(absolute, actual) !== '') fail('PATH_ALIAS', 'Path must match resolved filesystem location');
  return actual;
}
function scopedPath(root: string, path: string): string {
  const actual = canonicalPath(path);
  if (!within(root, actual)) fail('PATH_SCOPE', 'Path outside target root');
  return actual;
}
export interface Scope {
  executable: string;
  home: string;
  projectRoot: string;
  profile: string;
  allowDefault?: boolean;
  profileRoot: string;
  pluginsRoot: string;
  /** Existing plugin-owned data directory. Never removed, even during uninstall. */
  stateRoot: string;
  /** Explicit child environment; no process-global writes or ambient environment copying. */
  env: Record<string, string>;
}
export interface SourceRecord {
  package: typeof PACKAGE;
  /** Approved native Git source, ending in exact immutable 40-hex commit. */
  spec: string;
  commit: string;
  version: string;
  hostVersion: '18.12.6';
  stateVersion: number;
  /** Hash of dependency lock shipped in package, not live host DB/lock hash. */
  dependencyLockSha256: string;
}
export interface Command {
  executable: string; argv: string[]; cwd: string; env: Record<string, string>; shell: false;
}
export interface CommandResult { exitCode: number; stdout: string; stderr: string }
export type Runner = (command: Command) => Promise<CommandResult>;
export interface Registration {
  name: string; version: string; path: string; enabled: boolean; enabledFeatures: string[] | null;
}
export interface Snapshot {
  schemaVersion: 1; profile: string; projectRoot: string;
  registration: Registration | null;
  dependency: string | null;
  runtime: unknown;
  settings: unknown;
  source: SourceRecord | null;
  packageHashes: Record<string, string>;
  /** Only plugin-owned data, never all profile files or shared DBs. */
  data: Record<string, string>;
}
interface Ownership {
  schemaVersion: 1; owner: typeof PACKAGE; profile: string; projectRoot: string;
  source: SourceRecord; registrationHash: string; packageHashes: Record<string, string>;
}
export function validateScope(scope: Scope): Scope {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(scope.profile)) fail('PROFILE_INVALID', 'Explicit native profile required');
  if (scope.profile === 'default' && scope.allowDefault !== true) fail('DEFAULT_PROFILE_DENIED', 'Separate allowDefault authority required');
  const home = canonicalPath(scope.home), projectRoot = canonicalPath(scope.projectRoot);
  const profileRoot = canonicalPath(scope.profileRoot), pluginsRoot = canonicalPath(scope.pluginsRoot);
  const stateRoot = canonicalPath(scope.stateRoot), executable = canonicalPath(scope.executable);
  const expected = scope.profile === 'default' ? join(home, '.omp') : join(home, '.omp', 'profiles', scope.profile);
  if (relative(expected, profileRoot) || relative(join(profileRoot, 'plugins'), pluginsRoot) ||
      relative(join(profileRoot, 'agent', PACKAGE), stateRoot)) fail('PATH_SCOPE', 'Native profile layout mismatch');
  if (!lstatSync(executable).isFile() || /\.(cmd|bat|ps1)$/i.test(executable)) fail('EXECUTABLE_INVALID', 'Direct native executable required, no shell wrapper');
  if (!lstatSync(projectRoot).isDirectory() || !lstatSync(pluginsRoot).isDirectory() || !lstatSync(stateRoot).isDirectory()) fail('PATH_SCOPE', 'Scoped directories required');
  if (within(profileRoot, projectRoot) || within(projectRoot, profileRoot)) fail('PATH_SCOPE', 'Project and profile must not overlap');
  for (const [key, value] of Object.entries(scope.env)) {
    if (typeof value !== 'string' || /\0/.test(key + value)) fail('ENV_INVALID', 'Invalid explicit child environment');
    if (/^(OMP_|PI_|XDG_|BUN_BE_BUN$|BUN_OPTIONS$|NODE_OPTIONS$)/i.test(key)) fail('ENV_SCOPE', 'Host profile/runtime overrides forbidden');
  }
  return { ...scope, home, projectRoot, profileRoot, pluginsRoot, stateRoot, executable, env: { ...scope.env } };
}
export function validateSource(source: SourceRecord): SourceRecord {
  if (!object(source) || source.package !== PACKAGE || source.hostVersion !== '18.12.6' ||
      !/^[0-9a-f]{40}$/.test(source.commit) || !source.spec.endsWith(`#${source.commit}`) ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(source.version) ||
      !Number.isSafeInteger(source.stateVersion) || source.stateVersion < 1 || !/^[0-9a-f]{64}$/.test(source.dependencyLockSha256)) {
    return fail('SOURCE_INVALID', 'Approved package, exact commit, host, lock and state version required');
  }
  const repo = source.spec.slice(0, -(source.commit.length + 1));
  if (/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { ...source };
  let url: URL;
  try { url = new URL(repo); } catch { return fail('SOURCE_INVALID', 'Unsupported native Git source'); }
  if (url.username || url.password || url.search || url.hash || /[\s;&|`$(){}<>\\]/.test(repo) || !/^\/[A-Za-z0-9_./-]+$/.test(url.pathname) ||
      !(url.protocol === 'https:' || (url.protocol === 'git:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    fail('SOURCE_INVALID', 'Credential-free HTTPS Git or explicit loopback Git fixture required');
  }
  return { ...source };
}
function parseSourceRecord(record: Record<string, unknown>): SourceRecord {
  if (record.package !== PACKAGE || typeof record.spec !== 'string' || typeof record.commit !== 'string' ||
      typeof record.version !== 'string' || record.hostVersion !== '18.12.6' || typeof record.stateVersion !== 'number' ||
      typeof record.dependencyLockSha256 !== 'string') fail('SOURCE_INVALID', 'Invalid persisted source record');
  return validateSource({ package: PACKAGE, spec: record.spec, commit: record.commit, version: record.version,
    hostVersion: record.hostVersion, stateVersion: record.stateVersion, dependencyLockSha256: record.dependencyLockSha256 });
}
export function readPluginList(text: string): Registration[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return fail('LIST_INVALID', 'Native plugin list did not return JSON'); }
  if (!object(data) || !Array.isArray(data.npm) || !Array.isArray(data.marketplace)) fail('LIST_INVALID', 'Expected pinned native npm/marketplace list');
  if (data.marketplace.some(p => !object(p) || typeof p.id !== 'string')) fail('LIST_INVALID', 'Invalid marketplace list');
  if (data.marketplace.some(p => object(p) && typeof p.id === 'string' && p.id.split('@')[0] === PACKAGE)) fail('FOREIGN_REGISTRATION', 'Marketplace registration conflicts with owned Git package');
  const names = new Set<string>();
  return data.npm.map((p: unknown) => {
    if (!object(p) || typeof p.name !== 'string' || typeof p.version !== 'string' || typeof p.path !== 'string' || !isAbsolute(p.path) ||
        typeof p.enabled !== 'boolean' || !(p.enabledFeatures === null || (Array.isArray(p.enabledFeatures) && p.enabledFeatures.every((f: unknown) => typeof f === 'string'))) || names.has(p.name)) {
      return fail('LIST_INVALID', 'Invalid or duplicate native registration');
    }
    names.add(p.name);
    return { name: p.name, version: p.version, path: p.path, enabled: p.enabled, enabledFeatures: p.enabledFeatures };
  });
}
function tree(root: string, exclude: Readonly<Record<string, true>> = {}): Record<string, string> {
  const files: Record<string, string> = {};
  function visit(path: string, prefix: string) {
    for (const name of readdirSync(path).sort()) {
      const key = prefix ? `${prefix}/${name}` : name;
      if (!prefix && exclude[name]) continue;
      const child = scopedPath(root, join(path, name)), stat = lstatSync(child);
      if (stat.isDirectory()) visit(child, key);
      else if (stat.isFile()) files[key] = readFileSync(child).toString('base64');
      else fail('PATH_TYPE', 'Only regular files and directories supported');
    }
  }
  visit(root, '');
  return files;
}
const hashes = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([p, b]) => [p, sha(Buffer.from(b, 'base64'))]));
const controls: Readonly<Record<string, true>> = { 'lifecycle-owner.json': true, 'lifecycle.lock': true, 'active-runs.json': true };
function optionalJson(root: string, name: string): Record<string, unknown> {
  const path = join(root, name);
  const record = existsSync(path) ? json(scopedPath(root, path)) : {};
  if (!object(record)) fail('INVALID_RECORD', 'Expected scoped JSON object');
  return record;
}
function metadata(s: Scope) {
  const pkg = optionalJson(s.pluginsRoot, 'package.json'), lock = optionalJson(s.pluginsRoot, 'omp-plugins.lock.json');
  const dependency = object(pkg.dependencies) ? pkg.dependencies[PACKAGE] ?? null : null;
  if (dependency !== null && typeof dependency !== 'string') fail('INVALID_RECORD', 'Invalid package dependency');
  return { dependency, runtime: object(lock.plugins) ? lock.plugins[PACKAGE] ?? null : null, settings: object(lock.settings) ? lock.settings[PACKAGE] ?? null : null };
}
function owner(s: Scope): Ownership | null {
  const path = join(s.stateRoot, 'lifecycle-owner.json');
  if (!existsSync(path)) return null;
  const record = json(scopedPath(s.stateRoot, path));
  if (!object(record) || record.schemaVersion !== 1 || record.owner !== PACKAGE || record.profile !== s.profile || record.projectRoot !== s.projectRoot ||
      typeof record.registrationHash !== 'string' || !object(record.packageHashes) || !Object.values(record.packageHashes).every(v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) || !object(record.source)) fail('OWNERSHIP_INVALID', 'Foreign or invalid lifecycle manifest');
  const source = parseSourceRecord(record.source);
  return { schemaVersion: 1, owner: PACKAGE, profile: s.profile, projectRoot: s.projectRoot, source,
    registrationHash: record.registrationHash, packageHashes: record.packageHashes as Record<string, string> };
}
function idle(s: Scope) {
  const record = json(scopedPath(s.stateRoot, join(s.stateRoot, 'active-runs.json')));
  if (!object(record) || record.schemaVersion !== 1 || record.owner !== PACKAGE || record.profile !== s.profile || record.projectRoot !== s.projectRoot ||
      !Array.isArray(record.runIds) || !record.runIds.every((id: unknown) => typeof id === 'string' && id.length > 0)) fail('RUN_STATE_INVALID', 'Explicit owned-run inventory required');
  if (record.runIds.length) fail('OWNED_RUN_BUSY', 'Stop owned runs before lifecycle mutation');
}
async function command(s: Scope, runner: Runner, argv: string[]): Promise<string> {
  let result: CommandResult;
  try { result = await runner({ executable: s.executable, argv: ['--profile', s.profile, ...argv], cwd: s.projectRoot, env: { ...s.env }, shell: false }); }
  catch { return fail('NATIVE_COMMAND_FAILED', 'Native command runner failed; retained data unchanged by helper'); }
  if (result.exitCode !== 0) fail('NATIVE_COMMAND_FAILED', 'Native command failed; inspect host-owned output, no automatic retry or restore');
  return result.stdout;
}
export async function collectPlugins(scope: Scope, runner: Runner): Promise<Registration[]> {
  const s = validateScope(scope);
  return readPluginList(await command(s, runner, ['plugin', 'list', '--json']));
}
async function capture(s: Scope, runner: Runner): Promise<Snapshot> {
  const registration = (await collectPlugins(s, runner)).find(p => p.name === PACKAGE) ?? null;
  const own = owner(s), meta = metadata(s);
  if (registration) {
    const expected = join(s.pluginsRoot, 'node_modules', PACKAGE);
    if (relative(expected, registration.path) !== '') fail('PATH_SCOPE', 'Package path must match owned native package directory');
    scopedPath(s.pluginsRoot, registration.path);
  }
  return { schemaVersion: 1, profile: s.profile, projectRoot: s.projectRoot, registration, ...meta,
    source: own?.source ?? null, packageHashes: registration ? hashes(tree(registration.path)) : {}, data: tree(s.stateRoot, controls) };
}
export async function snapshot(scope: Scope, runner: Runner): Promise<Snapshot> {
  return capture(validateScope(scope), runner);
}
function registrationHash(s: Snapshot) { return sha(stable({ registration: s.registration, dependency: s.dependency, runtime: s.runtime, settings: s.settings })); }
function assertOwned(s: Scope, current: Snapshot) {
  const own = owner(s);
  if (!own || !current.registration || own.registrationHash !== registrationHash(current) || stable(own.packageHashes) !== stable(current.packageHashes)) {
    fail('FOREIGN_OR_MODIFIED', 'Refusing overwrite/uninstall of foreign or modified package or registration');
  }
}
function recordOwnership(s: Scope, current: Snapshot, source: SourceRecord) {
  const path = join(s.stateRoot, 'lifecycle-owner.json');
  if (existsSync(path)) scopedPath(s.stateRoot, path);
  const record: Ownership = { schemaVersion: 1, owner: PACKAGE, profile: s.profile, projectRoot: s.projectRoot,
    source, registrationHash: registrationHash(current), packageHashes: current.packageHashes };
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
}
async function guarded<T>(scope: Scope, operation: (s: Scope) => Promise<T>): Promise<T> {
  const s = validateScope(scope); idle(s);
  const path = join(s.stateRoot, 'lifecycle.lock'), token = randomUUID();
  let fd: number;
  try { fd = openSync(path, 'wx'); } catch { return fail('LIFECYCLE_BUSY', 'Lifecycle lease exists; reconcile owner, never delete blindly'); }
  try { writeFileSync(fd, token); idle(s); return await operation(s); }
  finally {
    closeSync(fd);
    if (existsSync(path) && readFileSync(scopedPath(s.stateRoot, path), 'utf8') === token) unlinkSync(path);
  }
}
function verifyPackage(s: Scope, current: Snapshot, source: SourceRecord) {
  if (!current.registration || current.registration.version !== source.version || current.dependency !== source.spec) fail('INSTALL_IDENTITY', 'Native installed package/ref mismatch');
  const pkg = json(scopedPath(s.pluginsRoot, join(current.registration.path, 'package.json')));
  if (!object(pkg) || pkg.name !== PACKAGE || pkg.version !== source.version) fail('INSTALL_IDENTITY', 'Installed manifest mismatch');
  const lock = scopedPath(s.pluginsRoot, join(current.registration.path, 'bun.lock'));
  if (sha(readFileSync(lock)) !== source.dependencyLockSha256) fail('DEPENDENCY_LOCK_MISMATCH', 'Installed dependency lock differs from approved record');
  // Read exact package resolution from native JSONC lock, never snapshot shared lock.
  const text = readFileSync(scopedPath(s.pluginsRoot, join(s.pluginsRoot, 'bun.lock')), 'utf8');
  let clean = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      clean += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; clean += c; }
    else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      clean += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      if (i >= text.length) fail('COMMIT_UNVERIFIED', 'Invalid native dependency lock comment');
      i++; clean += ' ';
    } else clean += c;
  }
  let strict = ''; quoted = false; escaped = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (!quoted && c === ',') {
      let next = i + 1;
      while (next < clean.length && /\s/.test(clean[next])) next++;
      if (clean[next] === '}' || clean[next] === ']') continue;
    }
    strict += c;
    if (quoted && escaped) escaped = false;
    else if (quoted && c === '\\') escaped = true;
    else if (c === '"') quoted = !quoted;
  }
  let lockRecord: unknown;
  try { lockRecord = JSON.parse(strict); } catch { return fail('COMMIT_UNVERIFIED', 'Invalid native dependency lock JSONC'); }
  const resolution = object(lockRecord) && object(lockRecord.packages) ? lockRecord.packages[PACKAGE] : null;
  if (!Array.isArray(resolution) || typeof resolution[0] !== 'string' || !resolution[0].startsWith(`${PACKAGE}@`) || !resolution[0].endsWith(`#${source.commit}`)) {
    fail('COMMIT_UNVERIFIED', 'Native dependency lock lacks exact approved resolved commit');
  }
}
function preserveRuntime(s: Scope, before: Snapshot, after: Snapshot) {
  const path = scopedPath(s.pluginsRoot, join(s.pluginsRoot, 'omp-plugins.lock.json'));
  const record = optionalJson(s.pluginsRoot, 'omp-plugins.lock.json');
  if (!object(record.plugins) || !object(record.settings)) fail('INVALID_RECORD', 'Native runtime lock missing maps');
  if (stable(record.plugins[PACKAGE] ?? null) !== stable(after.runtime) || stable(record.settings[PACKAGE] ?? null) !== stable(after.settings)) fail('FOREIGN_OR_MODIFIED', 'Runtime changed after native command');
  if (before.registration && after.registration) {
    if (!object(before.runtime) || !object(after.runtime)) fail('INVALID_RECORD', 'Installed runtime state missing');
    record.plugins[PACKAGE] = { ...before.runtime, version: after.registration.version };
  }
  if (before.settings !== null) {
    if (after.settings !== null && stable(before.settings) !== stable(after.settings)) fail('FOREIGN_OR_MODIFIED', 'Native command changed retained settings');
    record.settings[PACKAGE] = before.settings;
  }
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
}
/** Install/update only. No broad upgrade, migration, activation, global config edits or data deletion. */
export async function installVerified(scope: Scope, sourceRecord: SourceRecord, runner: Runner): Promise<{ before: Snapshot; after: Snapshot }> {
  const source = validateSource(sourceRecord);
  return guarded(scope, async s => {
    const version = (await command(s, runner, ['--version'])).trim();
    if (version !== `omp/${source.hostVersion}`) fail('HOST_INCOMPATIBLE', 'Expected pinned OMP 18.12.6; no automatic upgrade');
    const before = await capture(s, runner);
    if (before.registration) {
      assertOwned(s, before);
      if (before.source?.stateVersion !== source.stateVersion) fail('STATE_INCOMPATIBLE', 'Explicit matching state migration/snapshot required; retained data will not be coerced');
    } else if (before.dependency !== null || before.runtime !== null || before.settings !== null || owner(s)) fail('FOREIGN_OR_MODIFIED', 'Orphaned registration or ownership requires explicit reconciliation');
    idle(s);
    await command(s, runner, ['plugin', 'install', source.spec]);
    let after = await capture(s, runner);
    verifyPackage(s, after, source);
    if (stable(after.data) !== stable(before.data)) fail('DATA_DRIFT', 'Plugin data changed; retained for investigation, never auto-restored');
    if (before.registration) {
      preserveRuntime(s, before, after);
      after = await capture(s, runner);
    }
    recordOwnership(s, after, source);
    return { before, after: { ...after, source } };
  });
}
export async function rollback(scope: Scope, prior: Snapshot, runner: Runner): Promise<{ before: Snapshot; after: Snapshot }> {
  const s = validateScope(scope);
  if (prior.schemaVersion !== 1 || prior.profile !== s.profile || prior.projectRoot !== s.projectRoot || !prior.registration || !prior.source || prior.registration.name !== PACKAGE) {
    fail('ROLLBACK_INVALID', 'Exact prior scoped owned package snapshot required');
  }
  const own = owner(s);
  if (!own || own.source.stateVersion !== prior.source.stateVersion) fail('STATE_INCOMPATIBLE', 'Code rollback cannot downgrade retained data');
  return installVerified(s, prior.source, runner);
}
export async function uninstallOwned(scope: Scope, runner: Runner): Promise<{ before: Snapshot; after: Snapshot; dataRetained: true }> {
  return guarded(scope, async s => {
    const before = await capture(s, runner); assertOwned(s, before); idle(s);
    await command(s, runner, ['plugin', 'uninstall', PACKAGE]);
    let after = await capture(s, runner);
    if (after.registration || after.dependency !== null) fail('UNINSTALL_INCOMPLETE', 'Native package registration still exists');
    if (stable(before.data) !== stable(after.data)) fail('DATA_DRIFT', 'Retained data changed; never overwrite concurrent/user changes');
    if (before.settings !== null) {
      preserveRuntime(s, before, after);
      after = await capture(s, runner);
    }
    unlinkSync(scopedPath(s.stateRoot, join(s.stateRoot, 'lifecycle-owner.json')));
    return { before, after: { ...after, source: null }, dataRetained: true };
  });
}
