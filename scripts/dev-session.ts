import { join } from 'node:path';
import { homedir } from 'node:os';
import { childEnvironment, root, preflight } from './dev-preflight';
import {openProvider} from '../src/provider';
const profile = process.argv[2] || 'omp-system-dev';
preflight();
const executable = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'omp.exe' : 'omp');
const environment=childEnvironment(profile);
if(process.argv.includes('--use-main-provider')){
 const main=await openProvider(join(homedir(),'.omp','agent'));
 try{const lab=await openProvider(join(homedir(),'.omp','profiles',profile,'agent'));
 try{
  const model=main.modelRegistry.find('9router','code-sol'),target=lab.modelRegistry.find('9router','code-sol');if(!model||!target||model.baseUrl!==target.baseUrl||model.api!==target.api)throw Error('Lab endpoint/API must match main 9router before credential sharing');
  const key=await main.modelRegistry.getApiKey(model);if(!key)throw Error('Main 9router credential unavailable');const previous=process.env.OMP_SYSTEM_API_KEY;
  try{process.env.OMP_SYSTEM_API_KEY=key;if(await lab.modelRegistry.getApiKey(target)!==key)throw Error('Lab credential selector mismatch');environment.OMP_SYSTEM_API_KEY=key;}finally{if(previous===undefined)delete process.env.OMP_SYSTEM_API_KEY;else process.env.OMP_SYSTEM_API_KEY=previous;}
 }finally{lab.close()}}finally{main.close()}
}
const child = Bun.spawn([executable, '--profile', profile, '--cwd', root, '--session-dir', join(root, '.lab', 'sessions', profile), '--no-extensions', '--no-rules', '--no-skills', '-e', join(root,'src','extension.ts')], {
  cwd: root, env: environment, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', windowsHide: true,
});
process.exitCode = await child.exited;
