import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runMethod,type MethodHost,type MethodArtifact} from './pstack';
import type {Command,Check} from './contracts';
import type {Store} from './state';
import {runTraceForensics} from './trace-forensics';
import {scoped} from './workspaces';
import {validateSemanticReview} from './catalog-semantics';
export interface PerfOperation {kind:'perf-issue';metric:Command;trace:Command;tracePath:string;surface:'cli';unit:string;expectedWork:number;noise:number;samples:number;target:number;minimumDelta:number;limiter:string;hypothesis:string;}
/** Baseline before reasoning/edit, paired unprofiled measurements, separate profiled captures, then fresh review. */
export async function executePerfIssue(o:PerfOperation,context:{id:string;task:string;rubric:string[];workspace:string;baselineWorkspace:string;host:MethodHost;store:Store;deadline:number;boundaryChange:boolean;check:(dir:string,commands?:Command[])=>Promise<Check[]>;regression:Command[];observe:(body:string,work:number)=>{metric:number;work:number};restore:()=>void}){
 const {workspace,baselineWorkspace,host,store}=context;
 const green=(checks:Check[])=>checks.length>0&&checks.every(c=>c.status==='passed');
 const observedChecks:Check[]=[],samples:{baseline:number[];before:number[];after:number[]}={baseline:[],before:[],after:[]};
 const frozen=structuredClone({operation:o,regression:context.regression,deadline:context.deadline,boundaryChange:context.boundaryChange});
 const traces:Record<string,{artifact?:string;analysis?:unknown;work?:number}>={};let pairedComparison:unknown;
 const check=async(dir:string,commands:Command[])=>{const proof=await context.check(dir,commands);observedChecks.push(...proof);return proof;};
 const metric=async(dir:string)=>{const proof=await check(dir,[o.metric]);if(!green(proof))throw Error('Performance measurement command failed');return context.observe(proof[0]!.observation,o.expectedWork).metric;};
 const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]!;
 const range=(a:number[])=>a.length?{median:median(a),minimum:Math.min(...a),maximum:Math.max(...a),samples:a}:{samples:a};
 const vet=(a:number[])=>{if(a.length!==o.samples||Math.max(...a)-Math.min(...a)>o.noise)throw Error('Performance samples exceed frozen noise');return {median:median(a),minimum:Math.min(...a),maximum:Math.max(...a),samples:a};};
 const capture=async(dir:string,label:string)=>{const retained:typeof traces[string]=traces[label]={};const proof=await check(dir,[o.trace]);if(!green(proof))throw Error('Performance trace capture failed');const observation:unknown=JSON.parse(proof[0]!.observation);if(!observation||typeof observation!=='object'||!('errors'in observation)||observation.errors!==0||!('work'in observation)||observation.work!==o.expectedWork)throw Error('Trace workload differs from frozen metric workload');retained.work=observation.work;const bytes=readFileSync(scoped(dir,o.tracePath));const artifact=retained.artifact=store.artifact(bytes),analysis=retained.analysis=runTraceForensics({action:'trace',id:'perf-'+randomUUID(),project:dir,paths:[o.tracePath],before:o.tracePath,deadline:context.deadline},store,dir);if(analysis.before.format!=='cpuprofile'||analysis.before.nonMonotonicSamples||!analysis.before.sourceMapped)throw Error('CPU trace timing/source attribution inconclusive');return {artifact,analysis,work:observation.work};};
 let accepted=false;
 try{
 const beforeSamples=samples.baseline;for(let i=0;i<o.samples;i++)beforeSamples.push(await metric(baselineWorkspace));const baseline=vet(beforeSamples);
 const beforeTrace=await capture(baselineWorkspace,'before');
 const evidence:MethodArtifact={id:context.id+'-baseline',role:'host-measurement',body:JSON.stringify({baseline,beforeTrace,limiter:o.limiter,unit:o.unit,surface:o.surface}),evidence:[beforeTrace.artifact]};
 const ground=await runMethod('how',{task:context.task+'\nActual baseline and frozen measurement: '+evidence.body,rubric:context.rubric,evidence:[evidence]},host);let design:MethodArtifact[]=[];
 if(context.boundaryChange)design=(await runMethod('architect',{task:context.task,rubric:context.rubric,candidates:2,evidence:[evidence]},host)).artifacts;
  const change=await host.run('perf-change','Apply ONE smallest performance fix justified by actual trace. Mantras in order: remove unused work, avoid repeating, reduce, defer, background, concurrency, cheaper. Frozen workload and measurement inputs unchanged. Hypothesis: '+o.hypothesis,[evidence,...ground.artifacts,...design],{workspace,readOnly:false});
  const regression=await check(workspace,context.regression);if(!green(regression))throw Error('Performance change failed regression');
  const a=samples.before,b=samples.after;for(let i=0;i<o.samples;i++){a.push(await metric(baselineWorkspace));b.push(await metric(workspace));}const before=vet(a),after=vet(b),delta=before.median-after.median;
  const afterTrace=await capture(workspace,'after'),pair=join(store.directory,'perf-comparison',context.id);mkdirSync(pair,{recursive:true});writeFileSync(join(pair,'before.cpuprofile'),store.readArtifact(beforeTrace.artifact),{flag:'wx'});writeFileSync(join(pair,'after.cpuprofile'),store.readArtifact(afterTrace.artifact),{flag:'wx'});const comparison=runTraceForensics({action:'trace',id:'perf-pair-'+randomUUID(),project:pair,paths:['before.cpuprofile','after.cpuprofile'],before:'before.cpuprofile',after:'after.cpuprofile',deadline:context.deadline},store,pair);pairedComparison=comparison;
  if(delta<=Math.max(o.minimumDelta,o.noise)||after.median>o.target)throw Error('No measured performance target improvement beyond noise');
  const measurement:MethodArtifact={id:context.id+'-paired',role:'host-measurement',body:JSON.stringify({before,after,delta,unit:o.unit,surface:o.surface,expectedWork:o.expectedWork,actualChecks:observedChecks.map(c=>({id:c.id,status:c.status,exitCode:c.exitCode,observation:c.observation,log:c.log})),limiter:o.limiter,comparison,profiledNumbersReported:false}),evidence:[beforeTrace.artifact,afterTrace.artifact,...observedChecks.map(c=>c.log)]};
  const reviews=await runMethod('interrogate',{task:context.task+'\nIndependent final perf review. Read actual changed source and frozen harness. Return JSON only {findings:[{blocking:boolean,resolved:boolean,evidence:string}]}. Judge workload correctness, actual result consumption, limiter/source trace, production tuning, plausible ceiling and matched surface. No prose PASS.',rubric:context.rubric,evidence:[evidence,change,measurement]}, {...host,workspace:async()=>workspace});
  for(const report of reviews.artifacts){validateSemanticReview(report.body);if(report.role!=='lead-judgment'&&!report.actualReads?.length)throw Error('Performance review lacks actual source reads');}
  if(!reviews.verified||!green(await check(workspace,context.regression)))throw Error('Performance final review/regression incomplete');accepted=true;return {before,after,delta,unit:o.unit,surface:o.surface,limiter:o.limiter,traces:{before:beforeTrace,after:afterTrace,comparison},review:reviews,openingPR:'NOT REQUESTED',scope:'Local measured fix on supplied CLI workload. No universal throughput, source-equivalence, remote or production adoption claim.'};
 }catch(error){
  const rejectionReason=error instanceof Error?error.message:String(error);
  store.put('catalog-decision',context.id,{id:context.id,kind:'perf-issue',verdict:'rejected',status:'BLOCKED',localVerified:false,verified:false,frozen,rejectionReason,baseline:range(samples.baseline),before:range(samples.before),after:range(samples.after),...(samples.before.length&&samples.after.length?{delta:median(samples.before)-median(samples.after)}:{}),traces:{...traces,...pairedComparison?{comparison:pairedComparison}:{}},actualChecks:observedChecks,profiledNumbersReported:false});
  throw error;
 }finally{if(!accepted)context.restore()}
}
