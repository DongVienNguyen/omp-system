import { AuthStorage,ModelRegistry,Settings } from '@oh-my-pi/pi-coding-agent';
import { getAgentDir } from '@oh-my-pi/pi-utils';
import { readFileSync,realpathSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Coordinator,type RunSpec } from './coordinator';
import { Store } from './state';
import { digest,validateTasks } from './contracts';
import { parseRunSpec } from './run-spec';
const args=process.argv.slice(2);if(args.length<2||args.length>3||args[2]&&!['continue'].includes(args[2])&&!args[2].startsWith('repair:'))throw Error('Usage: run-cli.ts <approved-run-spec.json> <sealed-authority-id> [continue|repair:<task>]');
const spec=parseRunSpec(JSON.parse(readFileSync(args[0]!,'utf8')));
const project=realpathSync(spec.project),agentDir=getAgentDir(),stateDir=join(agentDir,'omp-system',digest(project));mkdirSync(stateDir,{recursive:true});
const auth=await AuthStorage.create(join(agentDir,'agent.db'));const settings=Settings.isolated({'memory.backend':'off','autolearn.enabled':false,'retry.fallbackChains':{}});const registry=new ModelRegistry(auth,join(agentDir,'models.yml'),{settings,cacheDbPath:join(agentDir,'models.db')});
const store=new Store(stateDir);const coordinator=new Coordinator(store,{agentDir,authStorage:auth,modelRegistry:registry});
const monitor=setInterval(()=>{if(store.get<any>('run',spec.id)?.cancelled)coordinator.cancel(spec.id)},200);
process.once('SIGINT',()=>coordinator.cancel(spec.id));process.once('SIGTERM',()=>coordinator.cancel(spec.id));
try{const result=await(args[2]==='continue'?coordinator.continue(spec,args[1]!):args[2]?.startsWith('repair:')?coordinator.repair(spec,args[2].slice(7),args[1]!):coordinator.run(spec,args[1]!));console.log(JSON.stringify(result));if(result.tasks.some(t=>!['LOCAL_VERIFIED','REMOTE_VERIFIED','DELIVERED'].includes(t.state)))process.exitCode=1}finally{clearInterval(monitor);store.close();auth.close()}
