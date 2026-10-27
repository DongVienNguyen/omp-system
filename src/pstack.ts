import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from './contracts';
export type PstackMethod='how'|'why'|'architect'|'arena'|'interrogate'|'blast-radius'|'verify';
export interface MethodArtifact {id:string;role:string;body:string;evidence:string[];actualReads?:string[];}
export interface MethodHost {run(role:string,mission:string,inputs:MethodArtifact[],options:{readOnly:boolean;workspace:string}):Promise<MethodArtifact>;verify(artifact:MethodArtifact):Promise<{passed:boolean;evidence:string[]}>;workspace(id:string):Promise<string>;}
export interface MethodResult {method:PstackMethod;artifacts:MethodArtifact[];selected?:MethodArtifact;verified:boolean;verification:string[];}
const catalog=(name:string)=>readFileSync(new URL('../vendor/pstack/skills/'+name+'/SKILL.md',import.meta.url),'utf8');
export async function runMethod(method:PstackMethod,request:{task:string;angles?:string[];candidates?:number;rubric?:string[];evidence?:MethodArtifact[];verificationMode?:'create'|'maintain'},host:MethodHost):Promise<MethodResult>{
 const artifacts:MethodArtifact[]=[];const invoke=async(role:string,mission:string,inputs:MethodArtifact[],readOnly=true)=>{const workspace=await host.workspace(role);const result=await host.run(role,mission,inputs,{readOnly,workspace});if(!result?.id||!result.body?.trim()||!Array.isArray(result.evidence))throw Error('Missing method artifact');artifacts.push(result);return result};
 const result:MethodResult={method,artifacts,verified:false,verification:[]};
 if(request.verificationMode!==undefined&&(method!=='verify'||!['create','maintain'].includes(request.verificationMode)))throw Error('Verification mode requires verify method');
 if(method==='how'||method==='why'){
  const angles=request.angles??(method==='how'?['entry/dataflow','ownership/dependencies']:['history/commits','design constraints/evidence gaps']);if(angles.length<2||angles.length>4)throw Error('Two to four explorer angles required');const reports=[];for(const angle of angles)reports.push(await invoke('explore-'+digest(angle).slice(0,10),catalog(method)+'\nTask:'+request.task+'\nAngle:'+angle,request.evidence??[]));
  result.selected=await invoke('synthesize',catalog(method)+'\nGround every fact in evidence. Separate FACT/INFERENCE/UNKNOWN. Task:'+request.task,reports);
 }else if(method==='arena'||method==='architect'){
  const n=request.candidates??2;if(!Number.isInteger(n)||n<2||n>6)throw Error('Arena requires2–6 candidates');const rubric=request.rubric;if(!rubric||rubric.length<3||rubric.length>6)throw Error('Three to six frozen rubric criteria required');
  const grounding:MethodArtifact[]=[...(request.evidence??[])];
  if(method==='architect'){grounding.push(await invoke('architecture-how',catalog('how')+'\nGround existing system, callers and constraints before designing. Task:'+request.task,request.evidence??[]));grounding.push(await invoke('architecture-why',catalog('why')+'\nExplain current ownership and layering with evidence; unknown history remains UNKNOWN. Task:'+request.task,grounding));}
  const mission=(method==='architect'?catalog('architect')+'\n':'')+catalog('arena')+'\nSame task and frozen rubric:'+JSON.stringify({task:request.task,rubric})+'\nProduce independent structurally distinct artifact; no other candidate context.';
  const candidates=[];for(let i=0;i<n;i++)candidates.push(await invoke('candidate-'+(i+1),mission,grounding,method==='architect'));
  const judgments=[];for(let i=0;i<n;i++)judgments.push(await invoke('cross-judge-'+(i+1),'Read all candidate artifacts; grade each frozen rubric criterion, identify strongest base and useful parts; no code edits. '+JSON.stringify(rubric),candidates));
  result.selected=await invoke('primary-graft','Primary owns selection: read candidates and judgments, choose one base, graft at most two valuable parts deliberately. Never mechanically merge. Produce concrete artifact and rationale; architecture requires caller usage/types/module map. '+request.task,[...grounding,...candidates,...judgments],method==='architect');
 }else if(method==='interrogate'){
  const reports=[];for(const role of ['correctness-review','boundary-review'])reports.push(await invoke(role,catalog('correct')+'\nAdversarial independent review, no fix. Same intent:'+request.task,request.evidence??[]));
  result.selected=await invoke('lead-judgment','Synthesize agreement/disagreement into Act on/Consider/Noted/Dismissed with evidence. Do not auto-fix.',reports);
 }else if(method==='blast-radius'){
  const report=await invoke('failure-path',catalog('blast-radius')+'\nTask:'+request.task,request.evidence??[]);result.selected=await invoke('prove-impact','Find safety-critical fact, trace failure path, specify and exercise cheapest actual-app proof through host verification; do not mark source-only as verified.',[report]);
 }else if(method==='verify')result.selected=await invoke('verification-map',catalog(request.verificationMode==='maintain'?'maintain-verification-skill':'create-verification-skill')+'\n'+(request.verificationMode==='maintain'?'Maintain existing project-local verification skill and feature map; preserve verified behavior, distinguish doc drift from product regressions.':'Create actual project-local verification skill and feature map within declared writer scope.')+' Read existing files before updating. Do not merely describe proposed files. Preserve evidence after cleanup. Task:'+request.task,request.evidence??[],false);
 else throw Error('Unsupported method');
 if(!result.selected)throw Error('No method output');const proof=await host.verify(result.selected);result.verified=proof.passed;result.verification=proof.evidence;if(!proof.evidence.length)throw Error('Actual verification evidence missing');return result;
}
