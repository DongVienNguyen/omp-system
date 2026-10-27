import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {freemem} from 'node:os';
import {root,profileRoot,protectedHashes} from './dev-preflight';
import {openProvider} from '../src/provider';
import {runWorker,type WorkerResult} from '../src/runtime';
import {Store} from '../src/state';
import {Coordinator,type RunSpec} from '../src/coordinator';
import {authorizeExecution} from '../src/authority';
import {fsTools} from '../src/workspaces';
import {digest,type Task} from '../src/contracts';

// Instruction-backed OMP SDK baseline, not a claim to benchmark the native AK CLI.
// Both arms use the same model, tools, frozen tasks and host checks; managed arm adds independent review/certification.
const id='baseline-comparison-'+randomUUID(),home=join(root,'.lab','workspaces',id),evidencePath=join(home,'evidence.json');
mkdirSync(home,{recursive:true});
const started=Date.now(),deadline=Math.min(started+600000,Number(process.env.OMP_SYSTEM_ADMITTED_DEADLINE)||Infinity),MAX_WORKERS=Math.min(16,Number(process.env.OMP_SYSTEM_ADMITTED_MAX_CALLS)||16);
const agentDir=join(profileRoot('omp-system-dev'),'agent'),snapshotRoot=join(root,'.lab','ak-snapshot');
const before=protectedHashes();
const sources=[
 ['rules/development-rules.md','4c93039aa1f6210f3126a1c9e30fe857ed6d041d1684b245891c42794878fad3'],
 ['rules/primary-workflow.md','e8943072e63e5e7d70094430925227407c2a780a3447fe8c578fd7073b9a5d2e'],
 ['skills/ak-cook/SKILL.md','fb1551b6faf8c5605483f7c5bd679afddaf87620cdfc75d40481d43312484ecd'],
 ['skills/ak-debug/SKILL.md','bead05d76313566aba051f54bb55fada5993de590a510109da1c76df8a01f720'],
 ['skills/ak-test/SKILL.md','bf1e2550b6f387fc680271808caa7250ef237b8828f1e42c59e1f2aea7f9aa3a'],
] as const;
const instructions=new Map<string,string>();
for(const [path,expected]of sources){const bytes=readFileSync(join(snapshotRoot,path));if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Frozen AK snapshot hash mismatch: '+path);instructions.set(path,bytes.toString('utf8'))}
const fixtures=[
 {id:'bug',goal:'Fix clamp(value,min,max): clamp to inclusive bounds; reject min > max with RangeError. Preserve API. Never edit tests.',source:'app.ts',code:'export function clamp(value:number,min:number,max:number){return Math.max(min,Math.max(max,value))}\n',tests:"import {test,expect} from 'bun:test';import {clamp} from './app';test('bounds and interior',()=>{expect(clamp(-1,0,10)).toBe(0);expect(clamp(4,0,10)).toBe(4);expect(clamp(11,0,10)).toBe(10)});test('reversed bounds',()=>expect(()=>clamp(3,10,0)).toThrow(RangeError));\n",count:2,skill:'skills/ak-debug/SKILL.md'},
 {id:'feature',goal:'Implement uniqueLabels(values:string[]): trim labels, discard blank labels, deduplicate case-insensitively while preserving first trimmed spelling and first-seen order. Never edit tests.',source:'app.ts',code:'export function uniqueLabels(values:string[]):string[]{return values}\n',tests:"import {test,expect} from 'bun:test';import {uniqueLabels} from './app';test('stable case-insensitive labels',()=>expect(uniqueLabels([' A ','a','B',' b ','C'])).toEqual(['A','B','C']));test('blanks and empty',()=>{expect(uniqueLabels(['','  '])).toEqual([]);expect(uniqueLabels([])).toEqual([])});test('no input mutation',()=>{const v=[' A ','a'];uniqueLabels(v);expect(v).toEqual([' A ','a'])});\n",count:3,skill:'skills/ak-cook/SKILL.md'},
 {id:'refactor',goal:'Refactor sumPositive and countPositive to share exactly one non-exported positive-number predicate passed directly to both Array.filter calls. Preserve exported API and behavior. Independent reviewer must inspect predicate reuse; behavior tests do not establish internal structure. Never edit tests.',source:'app.ts',code:'export function sumPositive(values:number[]){return values.filter(n=>Number.isFinite(n)&&n>0).reduce((a,b)=>a+b,0)}\nexport function countPositive(values:number[]){return values.filter(n=>Number.isFinite(n)&&n>0).length}\n',tests:"import {test,expect} from 'bun:test';import {sumPositive,countPositive} from './app';test('behavior',()=>{const v=[-1,0,2,3,NaN,Infinity];expect(sumPositive(v)).toBe(5);expect(countPositive(v)).toBe(2)});test('empty and no mutation',()=>{const v=[1,-1];sumPositive(v);expect(v).toEqual([1,-1]);expect(countPositive([])).toBe(0)});test('finite positive edge cases',()=>{const v=[-Infinity,-0,Number.MIN_VALUE,0.5,NaN];expect(sumPositive(v)).toBe(Number.MIN_VALUE+0.5);expect(countPositive(v)).toBe(2);expect(sumPositive([])).toBe(0)});\n",count:3,skill:'skills/ak-cook/SKILL.md'},
 {id:'harness',goal:'Implement harness/scripts/report.ts as an actual Bun entrypoint: accept exactly one argv label matching /^[a-z][a-z0-9-]*$/, print exactly one JSON line {label,status:"ready"}, exit 0. Invalid/missing/extra args: exit 2 without stdout. Never edit tests.',source:'harness/scripts/report.ts',code:'console.log(JSON.stringify({status:"unfinished"}));\n',tests:"import {test,expect} from 'bun:test';import {spawnSync} from 'node:child_process';const run=(args:string[])=>spawnSync(process.execPath,['run','harness/scripts/report.ts',...args],{cwd:import.meta.dir,encoding:'utf8',timeout:5000,env:{...process.env,BUN_BE_BUN:'1'}});test('actual harness entrypoint',()=>{const r=run(['task-42']);expect(r.status).toBe(0);expect(r.stdout).toBe(JSON.stringify({label:'task-42',status:'ready'})+'\\n')});test('reject invalid input',()=>{for(const args of [[],['../escape'],['a','b'],['A']]){const r=run(args);expect(r.status).toBe(2);expect(r.stdout).toBe('')}});\n",count:2,skill:'skills/ak-cook/SKILL.md'},
];
interface BehaviorObservation {passed:boolean;unchangedTests:boolean;selectedTests:number;exitCode:number|null;log:string;sourceHash:string;}
type Row={task:string;arm:'omp-ak-baseline'|'managed-sdk';status:string;elapsedMs:number;workerCalls:number;usage:unknown[];interventions:number;checks:BehaviorObservation|null;candidateChecks?:unknown[];certified?:boolean;workers:unknown[];error?:string};
const results:Row[]=[];
let workerCalls=0,stopReason:string|undefined,finished=false;
function save(){writeFileSync(evidencePath,JSON.stringify({id,started,elapsedMs:Date.now()-started,deadline,maxWorkerCalls:MAX_WORKERS,workerCalls,concurrency:1,fixtureDigest:digest(fixtures),akSources:sources.map(([path,sha256])=>({path,sha256})),baseline:'OMP isolated SDK + hash-verified installed AK rules and relevant skill text; not native AK CLI',managed:'Coordinator isolated SDK + checks + independent review/certificate',models:{implementer:{provider:'9router',id:'code-sol',effort:'high'},managedReviewer:{provider:'9router',id:'code-astra',effort:'low'}},results,stopReason,cost:'UNKNOWN',claim:'Bounded four-task observation only; managed arm has extra reviewer/model budget; no universal gain claim',finished},null,2))}
// Host process enforces hard wall clock; runWorker deadline alone is cooperative.
const hardStop=setTimeout(()=>{stopReason='600s hard wall-clock cap';save();process.exit(1)},Math.max(1,deadline-Date.now()));
function verify(work:string,source:string,tests:string,count:number):BehaviorObservation{
 const unchanged=readFileSync(join(work,'app.test.ts'),'utf8')===tests;
 const result=spawnSync(process.execPath,['test','app.test.ts'],{cwd:work,encoding:'utf8',timeout:Math.max(1,Math.min(15000,deadline-Date.now())),maxBuffer:1024*1024,env:{...process.env,BUN_BE_BUN:'1'}});
 const log=result.stdout+result.stderr,selected=Number(log.match(/(\d+) pass/)?.[1]??-1);
 return {passed:unchanged&&!result.error&&result.status===0&&selected===count,unchangedTests:unchanged,selectedTests:selected,exitCode:result.status,log,sourceHash:digest(readFileSync(join(work,source)).toString('base64'))};
}
const provider=await openProvider(agentDir);
try{
 for(const fixture of fixtures){
  for(const arm of ['omp-ak-baseline','managed-sdk'] as const){
   if(Date.now()>=deadline||workerCalls+(arm==='managed-sdk'?2:1)>MAX_WORKERS){stopReason='Comparison resource cap reached';break}
   if(freemem()<256*1024*1024||process.memoryUsage().rss>2*1024*1024*1024){stopReason='Host resource pressure; comparison stopped before worker admission';break}
   const work=join(home,fixture.id,arm);mkdirSync(dirname(join(work,fixture.source)),{recursive:true});writeFileSync(join(work,fixture.source),fixture.code);writeFileSync(join(work,'app.test.ts'),fixture.tests);
   const row:Row={task:fixture.id,arm,status:'UNKNOWN',elapsedMs:0,workerCalls:0,usage:[],interventions:0,checks:null,workers:[]};results.push(row);const at=Date.now();
   try{
    if(arm==='omp-ak-baseline'){
     workerCalls++;row.workerCalls=1;
     const baselineRules=['rules/development-rules.md','rules/primary-workflow.md',fixture.skill,'skills/ak-test/SKILL.md'].map(path=>'\n--- '+path+' ---\n'+instructions.get(path)).join('\n');
     const result=await runWorker({tokenLimits:{max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},id:id+'-'+fixture.id+'-baseline',cwd:work,agentDir,...provider,model:{provider:'9router',id:'code-sol'},thinkingLevel:'high',systemPrompt:'You are OMP coding agent using installed AK instructions below. Available tools are scoped workspace_read/workspace_write only. Host runs frozen tests after completion; do not invoke unavailable tools or claim tests ran. No nested agents, no remote actions.\n'+baselineRules,prompt:JSON.stringify({goal:fixture.goal,paths:[fixture.source,'app.test.ts'],acceptance:['All frozen behavior tests pass','Tests remain byte-identical']}),tools:fsTools(work,[fixture.source,'app.test.ts'],[fixture.source]),timeoutMs:Math.max(1,Math.min(70000,deadline-Date.now()))});
     row.workers=[result];row.usage=[result.usage];row.checks=verify(work,fixture.source,fixture.tests,fixture.count);row.status=result.status==='success'&&result.disposed&&row.checks.passed?'PASSED':'FAILED';
     // SDK redacts provider failures, so any worker failure stops whole comparison (includes 429/resource pressure).
     if(result.status!=='success'||!result.disposed)stopReason='Worker failed; stop without retry (provider 429/resource pressure cannot be excluded)';
    }else{
     const store=new Store(join(home,'state',fixture.id));
     workerCalls+=2;row.workerCalls=2; // Reserve worst-case producer + reviewer before invoking managed host.
     try{
      const task:Task={id:'implement',goal:fixture.goal,acceptance:['All frozen behavior tests pass','Tests remain byte-identical'],depends_on:[],read_scope:[fixture.source,'app.test.ts'],write_scope:[fixture.source],difficulty:'medium',state:'PLANNED',attempt:0,snapshot:''};
      const spec:RunSpec={id:id+'-'+fixture.id,project:work,trustedCode:true,tasks:[task],budget:{concurrency:1,max_worker_calls:2,max_rollouts:0,max_stages:0,max_transport_retries:0,max_repairs:0,deadline:Math.min(deadline,Date.now()+140000),max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},checks:{implement:[{id:'behavior',executable:process.execPath,args:['test','app.test.ts'],cwd:work,timeoutMs:15000,testCount:fixture.count}]}};
      const outcome=await new Coordinator(store,{agentDir,...provider}).run(spec,authorizeExecution(store,spec,true).id);
      const dispatch=store.list<{status?:string;receipt?:WorkerResult}>('dispatch');workerCalls-=2-dispatch.length;row.workerCalls=dispatch.length;row.workers=dispatch;row.usage=dispatch.map(d=>d.receipt?.usage??null);
      const deliverable=store.get<{workspace:string}>('deliverable',spec.id+':implement');row.candidateChecks=store.list('check');row.certified=!!deliverable;
      row.checks=deliverable?verify(deliverable.workspace,fixture.source,fixture.tests,fixture.count):null;row.status=outcome.tasks[0]?.state==='LOCAL_VERIFIED'&&row.checks?.passed?'PASSED':'FAILED';
      if(dispatch.some(d=>d.status!=='success'))stopReason='Managed worker failed; stop without retry (provider 429/resource pressure cannot be excluded)';
     }finally{store.close()}
    }
   }catch(error){row.error=error instanceof Error?error.message:String(error);row.status='UNKNOWN';stopReason='Comparison error; no retry'}
   row.elapsedMs=Date.now()-at;save();if(stopReason)break;
  }
  if(stopReason)break;
 }
 if(JSON.stringify(before)!==JSON.stringify(protectedHashes())){stopReason='Protected baseline config hashes changed';throw Error(stopReason)}
 finished=!stopReason&&results.length===8;save();console.log(JSON.stringify({id,evidencePath,finished,workerCalls,elapsedMs:Date.now()-started,results:results.map(r=>({task:r.task,arm:r.arm,status:r.status,elapsedMs:r.elapsedMs,workerCalls:r.workerCalls,interventions:r.interventions})),stopReason,cost:'UNKNOWN',claim:'No universal gain claim'}));if(!finished||results.some(r=>r.status!=='PASSED'))process.exitCode=1;
}finally{clearTimeout(hardStop);provider.close();save()}
