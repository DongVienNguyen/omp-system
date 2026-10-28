import { readFileSync,writeFileSync,mkdirSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root,profileRoot } from './dev-preflight';
import { Store } from '../src/state';
import { Library } from '../src/harness/library';
import { RepositoryTaskAdapter } from '../src/harness/repository-task';
import { ModelBudget } from '../src/model-budget';
import { snapshot } from '../src/workspaces';
import { openProvider } from '../src/provider';
const existing=readdirSync(join(root,'.lab','workspaces')).filter(n=>n.startsWith('harness-')).sort().map(n=>join(root,'.lab','workspaces',n)).filter(p=>{try{return JSON.parse(readFileSync(join(p,'evidence.json'),'utf8')).learned===true}catch{return false}}).at(-1);
if(!existing)throw Error('A prior eligible live experiment is required');const record=JSON.parse(readFileSync(join(existing,'evidence.json'),'utf8'));
const library=new Library(join(existing,'library'),{project:root,domain:'arithmetic',model:'code-sol:high',version:'1',runTag:record.id,mode:'agg',k:1});const prior=await library.context();if(prior.length!==1)throw Error('Eligible experience missing');
const work=join(root,'.lab','workspaces','follow-on-'+Date.now()),source=join(work,'source');mkdirSync(source,{recursive:true});writeFileSync(join(source,'app.ts'),'export const triple=(n:number)=>n;\n');writeFileSync(join(source,'app.test.ts'),"import {test,expect} from 'bun:test';import {triple} from './app';test('triple new task boundaries',()=>{expect(triple(4)).toBe(12);expect(triple(-2)).toBe(-6)});\n");
const provider=await openProvider(join(profileRoot('omp-system-dev'),'agent'));const store=new Store(join(root,'.lab','state','follow-on-'+Date.now()));
try{const base=snapshot(store,source,['app.ts','app.test.ts']);const adapter=new RepositoryTaskAdapter(store,{tokenLimits:{max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},id:'follow-on',task:'New task: repair triple(n) to multiply by3. Edit app.ts only. Apply useful eligible prior lesson if relevant.',base,workspaceRoot:work,agentDir:join(profileRoot('omp-system-dev'),'agent'),outputPaths:['app.ts'],writeScope:['app.ts'],checks:[{id:'triple',executable:process.execPath,args:['test','app.test.ts'],cwd:source,timeoutMs:15000,testCount:1}],trustedCode:true,workerEnv:{OMP_SYSTEM_API_KEY:process.env.OMP_SYSTEM_API_KEY},modelBudget:new ModelBudget(1,Date.now()+90000),timeoutMs:60000,...provider});const tree={...prior[0]!.tree,'EXPERIENCE.md':JSON.stringify({taskId:prior[0]!.taskId,runId:prior[0]!.runId,experience:prior[0]!.experience})};const result=await adapter.rollout({taskId:'triple',label:'follow-on',tree});const evidence={passed:result.ok&&result.delivered,priorTask:prior[0]!.taskId,priorRun:prior[0]!.runId,currentTask:'triple',result,receipts:adapter.receipts};writeFileSync(join(work,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(!evidence.passed)process.exitCode=1}finally{store.close();provider.close()}
