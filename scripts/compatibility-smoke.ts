import { AuthStorage, ModelRegistry, Settings } from '@oh-my-pi/pi-coding-agent';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWorker } from '../src/runtime';
import { root, profileRoot } from './dev-preflight';
const agentDir = join(profileRoot('omp-system-dev'), 'agent');
const cwd = join(root, '.lab', 'workspaces', 'compatibility');
mkdirSync(cwd, { recursive: true });
const settings = Settings.isolated({ 'memory.backend': 'off', 'autolearn.enabled': false });
const auth = await AuthStorage.create(join(agentDir, 'agent.db'));
const registry = new ModelRegistry(auth, join(agentDir, 'models.yml'), { settings, cacheDbPath: join(agentDir, 'models.db') });
// Explicit operator-owned provider configuration; no auth/config files are copied into the lab.
const config = Bun.YAML.parse(readFileSync(join(process.env.USERPROFILE!, '.omp', 'agent', 'models.yml'), 'utf8')) as any;
const provider = config.providers['9router'];
registry.registerProvider('9router', { ...provider, models: provider.models.map((m: any) => ({ ...m, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, maxTokens: 512 })) });
const result = await runWorker({tokenLimits:{max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},id: 'compatibility-smoke', cwd, agentDir, model: { provider: '9router', id: 'code-sol' }, thinkingLevel: 'high', systemPrompt: 'Reply exactly OMP_SDK_OK. Do not use tools.', prompt: 'Reply OMP_SDK_OK.', tools: [], timeoutMs: 45000, authStorage: auth, modelRegistry: registry});
auth.close();
console.log(JSON.stringify(result));
if (result.status !== 'success' || result.reply.trim() !== 'OMP_SDK_OK' || !result.disposed || !result.wire.some(w => w.model === 'code-sol' && w.effort.reasoning_effort === 'high')) process.exitCode = 1;
