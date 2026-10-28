import { AuthStorage,ModelRegistry,Settings } from '@oh-my-pi/pi-coding-agent';
import { join } from 'node:path';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Coordinator } from '../src/coordinator';
import { Store } from '../src/state';
import { root,profileRoot } from './dev-preflight';
import { authorizeExecution } from '../src/authority';
const id='repair-'+randomUUID();const project=join(root,'.lab','workspaces',id);mkdirSync(project,{recursive:true});
writeFileSync(join(project,'app.ts'),'export function total(a:number,b:number){return a-b}\n');
writeFileSync(join(project,'app.test.ts'),"import {test,expect} from 'bun:test';import {total} from './app';test('adds positive and negative inputs',()=>{expect(total(7,5)).toBe(12);expect(total(-3,2)).toBe(-1)});\n");
const agentDir=join(profileRoot('omp-system-dev'),'agent');const auth=await AuthStorage.create(join(agentDir,'agent.db'));const settings=Settings.isolated({'memory.backend':'off'});const registry=new ModelRegistry(auth,join(agentDir,'models.yml'),{settings,cacheDbPath:join(agentDir,'models.db')});
const cfg=Bun.YAML.parse(readFileSync(join(process.env.USERPROFILE!,'.omp','agent','models.yml'),'utf8')) as any;const provider=cfg.providers['9router'];registry.registerProvider('9router',{...provider,models:provider.models.map((m:any)=>({...m,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},maxTokens:2048}))});
const store=new Store(join(root,'.lab','state',id));const coordinator=new Coordinator(store,{agentDir,authStorage:auth,modelRegistry:registry});
try{
 const spec={id,project,trustedCode:true,budget:{concurrency:1,max_worker_calls:2,max_rollouts:0,max_stages:0,max_transport_retries:0,max_repairs:0,deadline:Date.now()+150000,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},tasks:[{id:'repair',goal:'Fix total(a,b) to add numbers, not subtract. Read app.ts and app.test.ts, edit only app.ts. Preserve export and signatures.',acceptance:['total(7,5)=12','total(-3,2)=-1'],depends_on:[],read_scope:['app.ts','app.test.ts'],write_scope:['app.ts'],difficulty:'medium' as const,state:'PLANNED' as const,attempt:0,snapshot:''}],checks:{repair:[{id:'test',executable:process.execPath,args:['test','app.test.ts'],cwd:project,timeoutMs:20000,testCount:1}]}};
 const authority=authorizeExecution(store,spec,true);const result=await coordinator.run(spec,authority.id);
 console.log(JSON.stringify(result));if(result.tasks.some(t=>t.state!=='LOCAL_VERIFIED'))process.exitCode=1;
}finally{store.close();auth.close()}
