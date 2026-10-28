import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath, collectPlugins, installVerified, LifecycleError, PACKAGE, readPluginList, rollback, snapshot, uninstallOwned, validateScope, validateSource, type Command, type Runner, type Scope, type SourceRecord } from '../src/lifecycle.ts';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'omp lifecycle 空 ')));
  const home = join(root, 'home'), projectRoot = join(root, 'project 空 with spaces');
  const profileRoot = join(home, '.omp', 'profiles', 'test-profile');
  const pluginsRoot = join(profileRoot, 'plugins'), stateRoot = join(profileRoot, 'agent', PACKAGE);
  for (const p of [home, projectRoot, pluginsRoot, stateRoot]) mkdirSync(p, { recursive: true });
  const executable = join(root, process.platform === 'win32' ? 'host.exe' : 'host');
  writeFileSync(executable, 'host runner fixture; never executed');
  const scope: Scope = { executable, home, projectRoot, profile: 'test-profile', profileRoot, pluginsRoot, stateRoot, env: {} };
  const runFile = join(stateRoot, 'active-runs.json');
  const setRuns = (runIds: string[]) => writeFileSync(runFile, JSON.stringify({ schemaVersion: 1, owner: PACKAGE, profile: scope.profile, projectRoot, runIds }));
  setRuns([]);
  const lockContents = '{"lockfileVersion":1,"workspaces":{},"packages":{}}\n';
  const source = (letter: string, version: string): SourceRecord => ({ package: PACKAGE, spec: `github:approved/omp-system#${letter.repeat(40)}`, commit: letter.repeat(40), version,
    hostVersion: '18.12.6', stateVersion: 1, dependencyLockSha256: createHash('sha256').update(lockContents).digest('hex') });
  const a = source('a', '1.0.0'), b = source('b', '1.1.0');
  const sources = [a, b];
  const packagePath = join(pluginsRoot, 'node_modules', PACKAGE);
  const pkgFile = join(pluginsRoot, 'package.json'), runtimeFile = join(pluginsRoot, 'omp-plugins.lock.json');
  writeFileSync(pkgFile, JSON.stringify({ dependencies: { foreign: '1.2.3' } }));
  writeFileSync(runtimeFile, JSON.stringify({ plugins: { foreign: { version: '1.2.3', enabled: false, enabledFeatures: [] } }, settings: { foreign: { keep: true } } }));
  writeFileSync(join(stateRoot, 'notes.txt'), 'user data');
  const calls: Command[] = [];
  let hostVersion = 'omp/18.12.6', wrongCommit = false;
  // Deliberate native-host simulator: writes real package/runtime/ownership inputs. Tests
  // assert public state transitions and refusal effects, not forwarding or source wording.
  const runner: Runner = async command => {
    calls.push(command);
    const args = command.argv.slice(2);
    if (args[0] === '--version') return { exitCode: 0, stdout: hostVersion, stderr: '' };
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { dependencies: Record<string, string> };
    const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8')) as { plugins: Record<string, { version: string; enabled: boolean; enabledFeatures: string[] | null }>; settings: Record<string, unknown> };
    if (args[1] === 'list') {
      const own = existsSync(packagePath) ? JSON.parse(readFileSync(join(packagePath, 'package.json'), 'utf8')) as { version: string } : null;
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ npm: own ? [{ name: PACKAGE, version: own.version, path: packagePath, enabled: runtime.plugins[PACKAGE].enabled, enabledFeatures: runtime.plugins[PACKAGE].enabledFeatures }] : [], marketplace: [] }) };
    }
    if (args[1] === 'install') {
      const approved = sources.find(s => s.spec === args[2]); assert.ok(approved);
      mkdirSync(packagePath, { recursive: true });
      writeFileSync(join(packagePath, 'package.json'), JSON.stringify({ name: PACKAGE, version: approved.version, omp: { extensions: ['entry.ts'] } }));
      writeFileSync(join(packagePath, 'entry.ts'), `export const version = '${approved.version}';\n`);
      writeFileSync(join(packagePath, 'bun.lock'), lockContents);
      pkg.dependencies[PACKAGE] = approved.spec;
      runtime.plugins[PACKAGE] = { version: approved.version, enabled: true, enabledFeatures: null };
      writeFileSync(join(pluginsRoot, 'bun.lock'), JSON.stringify({ packages: { [PACKAGE]: [`${PACKAGE}@github:approved/omp-system#${wrongCommit ? 'c'.repeat(40) : approved.commit}`, {}] } }));
    } else if (args[1] === 'uninstall') {
      rmSync(packagePath, { recursive: true }); delete pkg.dependencies[PACKAGE]; delete runtime.plugins[PACKAGE]; delete runtime.settings[PACKAGE];
    } else assert.fail('Unexpected native operation');
    writeFileSync(pkgFile, JSON.stringify(pkg)); writeFileSync(runtimeFile, JSON.stringify(runtime));
    return { exitCode: 0, stdout: '{}', stderr: '' };
  };
  return { root, scope, a, b, runner, calls, setRuns, packagePath, pkgFile, runtimeFile,
    setHostVersion: (value: string) => { hostVersion = value; }, setWrongCommit: () => { wrongCommit = true; },
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function code(expected: string) {
  return (error: unknown) => error instanceof LifecycleError && error.code === expected;
}

test('explicit scope, version and immutable provenance reject unsafe inputs before native mutation', async () => {
  const f = fixture();
  try {
    assert.equal(validateScope(f.scope).projectRoot, f.scope.projectRoot);
    assert.throws(() => validateScope({ ...f.scope, profile: 'default' }), code('DEFAULT_PROFILE_DENIED'));
    assert.throws(() => validateScope({ ...f.scope, env: { OMP_AGENT_DIR: f.root } }), code('ENV_SCOPE'));
    assert.throws(() => validateScope({ ...f.scope, pluginsRoot: f.scope.projectRoot }), code('PATH_SCOPE'));
    for (const spec of ['github:approved/omp-system#main', `https://user:secret@example.com/repo#${f.a.commit}`, `git://example.com/repo#${f.a.commit}`]) {
      assert.throws(() => validateSource({ ...f.a, spec }), code('SOURCE_INVALID'));
    }
    f.setHostVersion('omp/19.0.0');
    await assert.rejects(installVerified(f.scope, f.a, f.runner), code('HOST_INCOMPATIBLE'));
    assert.equal(existsSync(f.packagePath), false);
    assert.equal(existsSync(join(f.scope.stateRoot, 'lifecycle.lock')), false);
  } finally { f.cleanup(); }
});

test('native JSON parser rejects malformed, duplicate and marketplace ambiguity', () => {
  assert.deepEqual(readPluginList('{"npm":[],"marketplace":[]}'), []);
  for (const value of ['[]', '{}', 'not json', '{"npm":[{}],"marketplace":[]}']) assert.throws(() => readPluginList(value), code('LIST_INVALID'));
  assert.throws(() => readPluginList('{"npm":[],"marketplace":[{"id":"omp-system@foreign"}]}'), code('FOREIGN_REGISTRATION'));
});

test('install/update/exact rollback/uninstall preserve data, foreign registration and settings', async () => {
  const f = fixture();
  try {
    const installed = await installVerified(f.scope, f.a, f.runner);
    assert.equal(installed.before.registration, null);
    assert.equal(installed.after.source?.commit, f.a.commit);
    assert.ok(existsSync(join(f.scope.stateRoot, 'lifecycle-owner.json')));
    const updated = await installVerified(f.scope, f.b, f.runner);
    assert.equal(updated.after.registration?.version, '1.1.0');
    const reverted = await rollback(f.scope, updated.before, f.runner);
    assert.equal(reverted.after.source?.spec, f.a.spec);
    assert.equal(reverted.after.registration?.version, '1.0.0');
    assert.equal(readFileSync(join(f.packagePath, 'entry.ts'), 'utf8'), "export const version = '1.0.0';\n");
    assert.equal(reverted.after.data['notes.txt'], Buffer.from('user data').toString('base64'));
    const removed = await uninstallOwned(f.scope, f.runner);
    assert.equal(removed.dataRetained, true);
    assert.equal(removed.after.registration, null);
    assert.equal(readFileSync(join(f.scope.stateRoot, 'notes.txt'), 'utf8'), 'user data');
    const pkg = JSON.parse(readFileSync(f.pkgFile, 'utf8')) as { dependencies: Record<string, string> };
    assert.deepEqual(pkg.dependencies, { foreign: '1.2.3' });
    const runtime = JSON.parse(readFileSync(f.runtimeFile, 'utf8')) as { settings: Record<string, unknown> };
    assert.deepEqual(runtime.settings.foreign, { keep: true });
    assert.equal(existsSync(join(f.scope.stateRoot, 'lifecycle-owner.json')), false);
    assert.ok(f.calls.every(c => c.shell === false && c.executable === f.scope.executable && c.cwd === f.scope.projectRoot && c.argv[0] === '--profile' && c.argv[1] === f.scope.profile));
  } finally { f.cleanup(); }
});

test('foreign package and modified owned package cannot be overwritten or uninstalled', async () => {
  const f = fixture();
  try {
    await installVerified(f.scope, f.a, f.runner);
    writeFileSync(join(f.packagePath, 'entry.ts'), 'user modified package');
    await assert.rejects(installVerified(f.scope, f.b, f.runner), code('FOREIGN_OR_MODIFIED'));
    await assert.rejects(uninstallOwned(f.scope, f.runner), code('FOREIGN_OR_MODIFIED'));
    assert.equal(readFileSync(join(f.packagePath, 'entry.ts'), 'utf8'), 'user modified package');
    rmSync(join(f.scope.stateRoot, 'lifecycle-owner.json'));
    await assert.rejects(uninstallOwned(f.scope, f.runner), code('FOREIGN_OR_MODIFIED'));
    assert.ok(existsSync(f.packagePath));
  } finally { f.cleanup(); }
});

test('active owned runs and lifecycle lease block mutations; incompatible state blocks rollback', async () => {
  const f = fixture();
  try {
    f.setRuns(['run-1']);
    await assert.rejects(installVerified(f.scope, f.a, f.runner), code('OWNED_RUN_BUSY'));
    assert.equal(f.calls.length, 0);
    f.setRuns([]);
    writeFileSync(join(f.scope.stateRoot, 'lifecycle.lock'), 'another owner');
    await assert.rejects(installVerified(f.scope, f.a, f.runner), code('LIFECYCLE_BUSY'));
    assert.equal(readFileSync(join(f.scope.stateRoot, 'lifecycle.lock'), 'utf8'), 'another owner');
    rmSync(join(f.scope.stateRoot, 'lifecycle.lock'));
    await installVerified(f.scope, f.a, f.runner);
    const prior = await snapshot(f.scope, f.runner);
    assert.ok(prior.source);
    await assert.rejects(rollback(f.scope, { ...prior, source: { ...prior.source, stateVersion: 2 } }, f.runner), code('STATE_INCOMPATIBLE'));
    await assert.rejects(installVerified(f.scope, { ...f.b, stateVersion: 2 }, f.runner), code('STATE_INCOMPATIBLE'));
  } finally { f.cleanup(); }
});

test('resolved commit mismatch fails closed without claiming ownership', async () => {
  const f = fixture();
  try {
    f.setWrongCommit();
    await assert.rejects(installVerified(f.scope, f.a, f.runner), code('COMMIT_UNVERIFIED'));
    assert.equal(existsSync(join(f.scope.stateRoot, 'lifecycle-owner.json')), false);
    assert.equal(readFileSync(join(f.scope.stateRoot, 'notes.txt'), 'utf8'), 'user data');
  } finally { f.cleanup(); }
});

test('real directory symlink or Windows junction rejected, target content retained', async () => {
  const f = fixture();
  try {
    const target = join(f.root, 'foreign'), alias = join(f.root, 'junction');
    mkdirSync(target); writeFileSync(join(target, 'keep.txt'), 'foreign');
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => canonicalPath(alias), code('PATH_LINK'));
    assert.throws(() => canonicalPath(join(alias, 'keep.txt')), code('PATH_LINK'));
    assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'foreign');
    await assert.rejects(collectPlugins({ ...f.scope, stateRoot: alias }, f.runner), code('PATH_LINK'));
  } finally { f.cleanup(); }
});

test('user-changed disabled state and settings block update without overwriting changes', async () => {
  const f = fixture();
  try {
    await installVerified(f.scope, f.a, f.runner);
    const runtime = JSON.parse(readFileSync(f.runtimeFile, 'utf8')) as { plugins: Record<string, { version: string; enabled: boolean; enabledFeatures: string[] | null }>; settings: Record<string, unknown> };
    runtime.plugins[PACKAGE].enabled = false;
    runtime.plugins[PACKAGE].enabledFeatures = ['retained-feature'];
    runtime.settings[PACKAGE] = { userPreference: 'retain' };
    writeFileSync(f.runtimeFile, JSON.stringify(runtime));
    // User modification invalidates ownership; helper must not silently adopt it.
    await assert.rejects(installVerified(f.scope, f.b, f.runner), code('FOREIGN_OR_MODIFIED'));
    assert.deepEqual(JSON.parse(readFileSync(f.runtimeFile, 'utf8')), runtime);
    assert.equal(readFileSync(join(f.scope.stateRoot, 'notes.txt'), 'utf8'), 'user data');
  } finally { f.cleanup(); }
});

test('foreign ownership manifest and data mutation fail closed without restoration', async () => {
  const f = fixture();
  try {
    await installVerified(f.scope, f.a, f.runner);
    const manifestPath = join(f.scope.stateRoot, 'lifecycle-owner.json');
    const original = readFileSync(manifestPath, 'utf8');
    const record = JSON.parse(original) as { projectRoot: string };
    record.projectRoot = f.root;
    writeFileSync(manifestPath, JSON.stringify(record));
    await assert.rejects(uninstallOwned(f.scope, f.runner), code('OWNERSHIP_INVALID'));
    assert.ok(existsSync(f.packagePath));
    writeFileSync(manifestPath, original);
    const mutatingHost: Runner = async command => {
      const result = await f.runner(command);
      if (command.argv[3] === 'install') writeFileSync(join(f.scope.stateRoot, 'notes.txt'), 'concurrent user update');
      return result;
    };
    await assert.rejects(installVerified(f.scope, f.b, mutatingHost), code('DATA_DRIFT'));
    assert.equal(readFileSync(join(f.scope.stateRoot, 'notes.txt'), 'utf8'), 'concurrent user update');
    assert.equal(readFileSync(manifestPath, 'utf8'), original);
  } finally { f.cleanup(); }
});
