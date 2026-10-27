import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/state';
import {snapshot} from '../src/workspaces';
import {authorizeExecution} from '../src/authority';
import {runLocalCatalog,localAuthoritySpec} from '../src/catalog-local';
import type {RuntimeContext} from '../src/coordinator';
import {parseLocalCatalog} from '../src/catalog-local';
import {workflowCatalog} from '../src/catalog';
import {parseBrowserPrototype} from '../src/browser-prototype';
const command=(id:string)=>({id,executable:process.execPath,args:['pin.ts',id],timeoutMs:1000,runner:'command',proof:{kind:'exit-code',reason:'Observe actual output'},input_scope:['pin.ts']});
const metric=command('metric'),trace=command('trace'),regression=command('regression');
const workflow={id:'performance',project:import.meta.dir,trustedCode:true,kind:'catalog',workflow:{name:'perf-issue',sha256:workflowCatalog().find(e=>e.name==='perf-issue')!.sha256},paths:['app.ts','pin.ts'],write_scope:['app.ts'],checks:[metric,trace,regression],task:'Remove redundant work',rubric:['Same result','Measured improvement','Frozen workload'],budget:{maxCalls:24,deadline:Date.now()+60000,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144}};
const operation={kind:'perf-issue',metric,trace,tracePath:'output.cpuprofile',surface:'cli',unit:'ms',expectedWork:1000,noise:1,samples:5,target:5,minimumDelta:2,limiter:'Repeated calculation on one CPU',hypothesis:'Calculate once'};
assert.equal(parseLocalCatalog({workflow,operation}).operation.kind,'perf-issue');
assert.throws(()=>parseLocalCatalog({workflow,operation:{...operation,samples:3}}),/five/);
assert.throws(()=>parseLocalCatalog({workflow:{...workflow,checks:[metric,trace]},operation}),/regression/);
assert.throws(()=>parseLocalCatalog({workflow,operation:{...operation,tracePath:'app.ts/output.cpuprofile'}}),/Frozen perf/);
const browser={executable:process.execPath,entry:'index.html',width:900,height:560,actions:[{kind:'expect-text',selector:'#result',value:'Saved'}]};
assert.equal(parseBrowserPrototype(browser).actions[0]!.kind,'expect-text');
assert.throws(()=>parseBrowserPrototype({...browser,entry:'../outside.html'}),/Unsafe/);
assert.throws(()=>parseBrowserPrototype({...browser,actions:[{kind:'eval',selector:'body',value:'code'}]}),/interactions/);
const prototype={...workflow,workflow:{name:'prototype',sha256:workflowCatalog().find(e=>e.name==='prototype')!.sha256},paths:['index.html','pin.ts'],write_scope:['index.html']};
assert.equal(parseLocalCatalog({workflow:prototype,operation:{kind:'prototype',decision:'Choose density',variants:['Compact','Spacious'],surface:'browser',prerequisites:[],browser}}).operation.kind,'prototype');
assert.throws(()=>parseLocalCatalog({workflow:prototype,operation:{kind:'prototype',decision:'Choose density',variants:['Compact','Spacious'],surface:'cli',prerequisites:[],browser}}),/browser surface/);
const dir=mkdtempSync(join(tmpdir(),'perf-noise-')),storePath=join(dir,'state'),store=new Store(storePath),project=join(dir,'project');
try{
 mkdirSync(project);const app='export const work=16000000;';writeFileSync(join(project,'app.ts'),app);
 // Controlled metric sequence exercises rejection deterministically through real frozen commands, not timing claims.
 writeFileSync(join(project,'pin.ts'),`import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {work} from './app';const path='sample-count';const count=existsSync(path)?Number(readFileSync(path,'utf8')):0;writeFileSync(path,String(count+1));console.log(JSON.stringify({metric:100+(count%2)*21,errors:0,work}));`);
 const actual=(id:string)=>({...command(id),timeoutMs:10000});const actualMetric=actual('metric'),actualTrace=actual('trace'),actualRegression=actual('regression');
 const noisy=parseLocalCatalog({workflow:{...workflow,id:'noisy-perf',project,paths:['app.ts','pin.ts'],checks:[actualMetric,actualTrace,actualRegression],budget:{...workflow.budget,deadline:Date.now()+60000}},operation:{...operation,metric:actualMetric,trace:actualTrace,expectedWork:16000000,noise:20,samples:5,target:50,minimumDelta:21}});
 const base=snapshot(store,project,noisy.workflow.paths),authority=authorizeExecution(store,localAuthoritySpec(noisy),true);
 const result=await runLocalCatalog(noisy,{store,base,root:join(dir,'work'),runtime:{} as RuntimeContext,authorityId:authority.id});
 assert.equal(result.status,'BLOCKED');assert.equal(result.localVerified,false);assert.deepEqual(result.blockers,['Performance samples exceed frozen noise']);
 assert.equal(readFileSync(join(result.workspace!,'app.ts'),'utf8'),app);
 // Reopen persisted Store: evidence must survive caller catch and source restoration.
 const retained=new Store(storePath);
 try{
  const rejection=retained.get<any>('catalog-decision','noisy-perf');
  assert.equal(rejection.status,'BLOCKED');assert.equal(rejection.verdict,'rejected');assert.equal(rejection.localVerified,false);assert.equal(rejection.verified,false);
  assert.equal(rejection.rejectionReason,result.blockers[0]);assert.deepEqual(rejection.frozen.operation,noisy.operation);assert.equal(rejection.frozen.deadline,noisy.workflow.budget.deadline);
  assert.deepEqual(rejection.baseline,{samples:[100,121,100,121,100],median:100,minimum:100,maximum:121});assert.deepEqual(rejection.before,{samples:[]});assert.deepEqual(rejection.after,{samples:[]});assert.deepEqual(rejection.traces,{});
  assert.equal(rejection.actualChecks.length,5);assert.equal(result.checks.length,5);
  for(const proof of rejection.actualChecks){assert.equal(proof.status,'passed');assert.equal(proof.exitCode,0);assert.equal(JSON.parse(proof.observation).work,16000000);assert.equal(retained.readArtifact(proof.log).toString().trim(),proof.observation)}
 }finally{retained.close()}
}finally{store.close();rmSync(dir,{recursive:true,force:true})}
console.log('perf-browser: frozen five-sample metric/trace/regression, trace overlap, browser authority and interaction scope PASS');
