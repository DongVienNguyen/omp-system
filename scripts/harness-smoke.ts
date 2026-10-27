import { AuthStorage,ModelRegistry,Settings } from '@oh-my-pi/pi-coding-agent';
import { join } from 'node:path';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { root,profileRoot } from './dev-preflight';
import { Store } from '../src/state';
import { snapshot } from '../src/workspaces';
import { RepositoryTaskAdapter } from '../src/harness/repository-task';
import { createSlots,runMode,type Tree } from '../src/harness/recursion';
import { selectFinal,reflectAdoption } from '../src/harness/selection';
import { Library } from '../src/harness/library';
import { ModelBudget } from '../src/model-budget';
const id='harness-'+randomUUID(),work=join(root,'.lab','workspaces',id),source=join(work,'source');mkdirSync(source,{recursive:true});writeFileSync(join(source,'app.ts'),'export const twice=(n:number)=>n;\n');writeFileSync(join(source,'app.test.ts'),"import {test,expect} from 'bun:test';import {twice} from './app';test('double boundaries',()=>{expect(twice(3)).toBe(6);expect(twice(-2)).toBe(-4)});\n");
const agentDir=join(profileRoot('omp-system-dev'),'agent'),auth=await AuthStorage.create(join(agentDir,'agent.db'));const registry=new ModelRegistry(auth,join(agentDir,'models.yml'),{settings:Settings.isolated({'memory.backend':'off'}),cacheDbPath:join(agentDir,'models.db')});const cfg=Bun.YAML.parse(readFileSync(join(process.env.USERPROFILE!,'.omp','agent','models.yml'),'utf8')) as any;const provider=cfg.providers['9router'];registry.registerProvider('9router',{...provider,models:provider.models.map((m:any)=>({...m,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},maxTokens:2048}))});
const store=new Store(join(root,'.lab','state',id));
try{
 const base=snapshot(store,source,['app.ts','app.test.ts']);const adapter=new RepositoryTaskAdapter(store,{tokenLimits:{max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},id,task:'Repair twice(n) to return n*2. Edit only app.ts using workspace tools; app.test.ts unchanged. Preserve export.',base,workspaceRoot:work,agentDir,outputPaths:['app.ts'],writeScope:['app.ts'],checks:[{id:'double',executable:process.execPath,args:['test','app.test.ts'],cwd:source,timeoutMs:20000,testCount:1}],trustedCode:true,workerEnv:{OMP_SYSTEM_API_KEY:provider.apiKey},modelBudget:new ModelBudget(12,Date.now()+360000,1),timeoutMs:45000,authStorage:auth,modelRegistry:registry});
 const tree:Tree={'SYSTEM.md':'Read all scoped files before editing. Implement arithmetic exactly and preserve APIs.','GUARDRAILS.md':'Never alter tests or acceptance. Use only scoped workspace tools.'};const baseRun=await adapter.rollout({taskId:'double',label:'base',tree});const slots=createSlots(1);const result=await runMode({mode:'agg',taskId:'double',task:adapter.config.task,k:1,base:[{...baseRun,label:'base'}],baseTree:tree,adapter,slots,budgets:{proposalWidth:1,rolloutWidth:1,transportAttempts:1,maxInvocations:6,maxRollouts:4}});
 const selection=await selectFinal({taskId:'double',task:adapter.config.task,mode:'agg',k:1,rollouts:result.rollouts,adapter,slots,transportAttempts:1});await reflectAdoption({selection,result,task:adapter.config.task,baseTree:tree,slots,transportAttempts:1,reflect:r=>adapter.reflect(r)});const library=new Library(join(work,'library'),{project:root,domain:'arithmetic',model:'code-sol:high',version:'1',runTag:id,mode:'agg',k:1});const learned=await library.add(selection,result);const retrieved=await new Library(join(work,'library'),{project:root,domain:'arithmetic',model:'code-sol:high',version:'1',runTag:id,mode:'agg',k:1}).context();
 const evidence={id,method:result.mode,stages:result.stages.map(s=>({label:s.label,error:s.error})),rollouts:Object.values(result.rollouts).map(r=>({label:r.label,ok:r.ok,delivered:r.delivered,error:r.error})),selection,learned,retrieved:retrieved.map(e=>e.taskId),receipts:adapter.receipts};writeFileSync(join(work,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(!selection.ok||!learned||retrieved.length!==1)process.exitCode=1;
}finally{store.close();auth.close()}
