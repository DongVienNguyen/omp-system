import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {resolveWorkflowInstructions} from './catalog';
import {digest,type Check} from './contracts';
import {parseWorkflow,type WorkflowSpec} from './workflow-spec';
import {createMethodHost} from './pstack-host';
import {snapshot} from './workspaces';
import {executeCheck} from './checks';
import {disposition,executeLocalProtocol,validateInvestigation} from './catalog-semantics';
import type {MethodHost} from './pstack';
export function prepareCatalogWorkflow(value:unknown){
 const spec=parseWorkflow(value);if(spec.kind!=='catalog'||!spec.workflow)throw Error('Catalog workflow required');
 const instructions=resolveWorkflowInstructions(spec.workflow.name,spec.workflow.sha256,spec.instructions),loaded=instructions.loaded,semantic=disposition(loaded.entry.name);
 if(loaded.entry.name==='investigation'&&spec.write_scope.length)throw Error('Investigation is read-only');
 if(['bug-fix','refactoring'].includes(loaded.entry.name)){
  if(!spec.write_scope.length)throw Error('Local change requires explicit write scope');
  if(spec.budget.maxCalls<(spec.workflow.boundaryChange?14:7))throw Error('Semantic grounding/edit/review call budget insufficient');
  if(spec.checks.some(c=>!c.input_scope?.length))throw Error('Frozen repro/characterization input_scope required');
  if(spec.checks.some(c=>c.input_scope!.some(p=>spec.write_scope.some(w=>p===w||p.startsWith(w+'/')||w.startsWith(p+'/')))))throw Error('Repro/characterization pin must be outside writer scope');
 }
 return {spec,loaded,instructions,semantic};
}
export async function runCatalogWorkflow(value:WorkflowSpec,options:Pick<Parameters<typeof createMethodHost>[0],'store'|'base'|'root'|'runtime'>){
 const {spec,loaded,instructions,semantic}=prepareCatalogWorkflow(value);
 const blocked=[...instructions.missing,...(!semantic.local?semantic.prerequisites:[])];
 const identity={id:spec.id,kind:'catalog' as const,execution:'local-semantic-protocol' as const,workflow:loaded.entry,source:options.base.id,specDigest:digest(spec),rubric:spec.rubric,instructionFingerprint:instructions.fingerprint,instructionSources:instructions.sources.map(({path,sha256})=>({path,sha256})),akFingerprint:instructions.akFingerprint,promotion:'NOT REQUESTED'};
 if(blocked.length){const result={...identity,verified:false,localVerified:false,status:'BLOCKED',blockers:blocked,artifacts:[],verification:[]};options.store.put('method-result',spec.id,result);return result}
 const raw=createMethodHost({tokenLimits:spec.budget,...options,task:spec.task,readScope:spec.paths,writeScope:spec.write_scope,checks:spec.checks,maxCalls:spec.budget.maxCalls,deadline:spec.budget.deadline,trustedCode:spec.trustedCode}),workspace=await raw.workspace('semantic-shared');
 const initialFiles=snapshot(options.store,workspace,spec.paths).files;
 const pins=new Map(spec.checks.flatMap(c=>c.input_scope??[]).map(p=>[p,digest(readFileSync(join(workspace,p),'utf8'))]));
 const check=async(phase:string)=>{if(Date.now()>=spec.budget.deadline)throw Error('Semantic deadline exhausted');for(const [path,hash]of pins)if(digest(readFileSync(join(workspace,path),'utf8'))!==hash)throw Error('Frozen check input changed: '+path);const candidate=snapshot(options.store,workspace,spec.paths).id,checks:Check[]=[];for(const c of spec.checks){const result=await executeCheck(options.store,{...c,cwd:workspace},{candidate,policy:digest(instructions.fingerprint),plan:digest(spec.checks)},{trustedCode:true,root:workspace});if(c.runner!=='command'&&result.selectedTests!==c.testCount)throw Error('Semantic check coverage differs from frozen test count');checks.push(result)}options.store.put('catalog-phase',spec.id+'-'+phase,{phase,candidate,checks});return checks};
 const host:MethodHost={workspace:async()=>workspace,run:(role,mission,inputs,runOptions)=>raw.run(role,mission+'\nPinned instruction closure (no external commands, nested controller, commits or publishing):\n'+instructions.content+(loaded.entry.name==='investigation'?'\nSynthesis MUST include Overview / Key Concepts / How It Works / Where Things Live / Gotchas; a read-only throughput checkpoint; cite scoped file:line using actual workspace reads.':'')+(/review|lead-judgment/.test(role)?'\nReturn JSON only {findings:[{blocking:boolean,resolved:boolean,evidence:string}]}. Empty findings allowed only after actual file reads. Preserve every unresolved finding from input reports.':''),(/review|lead-judgment/.test(role)?[...inputs,{id:spec.id+':baseline',role:'host-baseline',body:JSON.stringify({baseline:initialFiles.map(f=>({path:f.path,hash:f.hash,content:options.store.readArtifact(f.artifact).toString('utf8')})),current:snapshot(options.store,workspace,spec.paths).files.map(f=>({path:f.path,hash:f.hash})),frozenInputs:[...pins]}),evidence:initialFiles.map(f=>f.artifact)}]:inputs),{...runOptions,workspace,readOnly:loaded.entry.name==='investigation'||runOptions.readOnly}),verify:async()=>{const checks=await check('method-proof-'+crypto.randomUUID());return {passed:checks.every(c=>c.status==='passed'),evidence:checks.map(c=>c.log)}}};
 const local=await executeLocalProtocol(loaded.entry.name,spec.task,spec.rubric!,host,check,Math.max(1,spec.budget.maxCalls-(spec.workflow!.boundaryChange?13:6)),spec.workflow!.boundaryChange);
 if(loaded.entry.name==='investigation')validateInvestigation(local.selected.body,local.artifacts,new Map(initialFiles.map(f=>[f.path,readFileSync(join(workspace,f.path),'utf8').split('\n').length])));
 const unchanged=loaded.entry.name!=='investigation'||digest(snapshot(options.store,workspace,spec.paths).files)===digest(initialFiles);
 const result={...identity,...local,verified:local.localVerified&&unchanged&&semantic.prerequisites.length===0,status:semantic.prerequisites.length?'LOCAL_VERIFIED':'VERIFIED',blockers:semantic.prerequisites,verification:local.proofs.flatMap(p=>p.checks.map(c=>c.log))};
 options.store.put('method-result',spec.id,result);return result;
}
