import { isAbsolute } from 'node:path';
import { safeRelative,validateRuntimeProof,type Command } from './contracts';
import type { PstackMethod } from './pstack';
import type { Tree,Mode } from './harness/recursion';
import type { ExecutableApproval } from './harness/executable-authority';
import type {AkSelection} from './ak-inventory';
import {assertSnapshotCommand} from './command-identity';
import {validateTokenLimits,type TokenLimits} from './token-limits';
export interface WorkflowSpec {id:string;project:string;trustedCode:true;paths:string[];write_scope:string[];checks:Command[];task:string;kind:'pstack'|'harness'|'catalog';workflow?:{name:string;sha256:string;boundaryChange?:boolean};instructions?:AkSelection;method?:PstackMethod;verificationMode?:'create'|'maintain';mode?:Mode;k?:number;tree?:Tree;rubric?:string[];candidates?:number;approvals?:ExecutableApproval[];budget:TokenLimits&{deadline:number;maxCalls:number};library?:{domain:string;model:string;version:string;runTag:string};}
export function parseWorkflow(value:unknown):WorkflowSpec{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Workflow object required');const v=value as any;
 const allowed:Record<string,true>={id:true,project:true,trustedCode:true,paths:true,write_scope:true,checks:true,task:true,kind:true,workflow:true,instructions:true,method:true,verificationMode:true,mode:true,k:true,tree:true,rubric:true,candidates:true,approvals:true,budget:true,library:true};if(Object.keys(v).some(k=>!Object.hasOwn(allowed,k)))throw Error('Unknown workflow field');
 if(typeof v.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.id)||typeof v.project!=='string'||!isAbsolute(v.project)||v.trustedCode!==true||typeof v.task!=='string'||!v.task.trim())throw Error('Invalid workflow identity/authority');
 for(const key of ['paths','write_scope']){if(!Array.isArray(v[key])||v[key].some((p:unknown)=>typeof p!=='string'))throw Error('Explicit workflow scope required');v[key].forEach(safeRelative)}if(!v.paths.length||!v.checks?.length||!Array.isArray(v.checks))throw Error('Workflow source/checks required');
 if(!v.budget||Object.keys(v.budget).some(k=>!['deadline','maxCalls','max_output_tokens','max_input_bytes','max_output_bytes'].includes(k))||!Number.isSafeInteger(v.budget.deadline)||v.budget.deadline<=Date.now()||!Number.isSafeInteger(v.budget.maxCalls)||v.budget.maxCalls<1||v.budget.maxCalls>100)throw Error('Bounded workflow budget required');validateTokenLimits(v.budget);
 if(!['pstack','harness','catalog'].includes(v.kind))throw Error('Workflow kind invalid');
 if(v.kind==='catalog'){
  if(!v.workflow||typeof v.workflow!=='object'||Array.isArray(v.workflow)||Object.keys(v.workflow).some(k=>!['name','sha256','boundaryChange'].includes(k))||typeof v.workflow.name!=='string'||!/^[a-z][a-z0-9-]*$/.test(v.workflow.name)||typeof v.workflow.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.workflow.sha256)||(v.workflow.boundaryChange!==undefined&&typeof v.workflow.boundaryChange!=='boolean'))throw Error('Pinned catalog workflow required');
  if(['method','mode','k','tree','candidates','approvals','library'].some(k=>v[k]!==undefined))throw Error('Catalog execution cannot add another controller');
  if(v.budget.maxCalls<3)throw Error('Catalog semantic stage budget requires at least three calls');
  if(!Array.isArray(v.rubric)||v.rubric.length<3||v.rubric.length>6||v.rubric.some((r:unknown)=>typeof r!=='string'||!r.trim())||new Set(v.rubric).size!==v.rubric.length)throw Error('Three to six distinct frozen rubric criteria required');
  if(v.write_scope.some((p:string)=>!v.paths.some((r:string)=>p===r||p.startsWith(r+'/'))))throw Error('Catalog writes outside snapshot scope');
  if(new Set(v.checks.map((c:Command)=>c.id)).size!==v.checks.length)throw Error('Catalog checks require unique IDs');
  for(const c of v.checks as Command[])assertSnapshotCommand(c);
  for(const c of v.checks as Command[]){if(Object.keys(c).some(k=>!['id','executable','args','cwd','timeoutMs','testCount','runner','proof','input_scope'].includes(k))||c.cwd!==undefined)throw Error('Catalog checks require host-owned cwd');if(c.input_scope){if(!Array.isArray(c.input_scope)||c.input_scope.some(p=>typeof p!=='string'||!v.paths.some((r:string)=>p===r||p.startsWith(r+'/'))))throw Error('Command input scope outside snapshot');c.input_scope.forEach(safeRelative)}if(c.runner==='command'){validateRuntimeProof(c.proof);if(c.testCount!==undefined)throw Error('Command proof cannot claim test count')}else if((c.runner!==undefined&&c.runner!=='bun-test')||c.proof||!Number.isSafeInteger(c.testCount)||c.testCount!<=0)throw Error('Catalog Bun checks require exact test counts')}
 }else if(v.workflow!==undefined)throw Error('Catalog workflow only valid for catalog kind');
 if(v.kind==='pstack'&&!['how','why','architect','arena','interrogate','blast-radius','verify'].includes(v.method))throw Error('Pstack method invalid');
 if(v.verificationMode!==undefined&&(v.kind!=='pstack'||v.method!=='verify'||!['create','maintain'].includes(v.verificationMode)))throw Error('Verification mode requires pstack verify');
 if(v.kind==='harness'&&(!['agg','seq'].includes(v.mode)||!Number.isSafeInteger(v.k)||v.k<1||v.k>4||(v.tree!==undefined&&(!v.tree||typeof v.tree!=='object'||Array.isArray(v.tree)))))throw Error('Harness mode/k/tree required');
 for(const c of v.checks){if(!c||typeof c.id!=='string'||!c.id.trim()||!isAbsolute(c.executable)||!Array.isArray(c.args)||c.args.some((a:unknown)=>typeof a!=='string')||!Number.isSafeInteger(c.timeoutMs)||c.timeoutMs<=0)throw Error('Invalid approved workflow command')}
 if(v.library){for(const key of ['domain','model','version','runTag'])if(typeof v.library[key]!=='string'||!v.library[key].trim())throw Error('Library scope incomplete')}
 return v;
}
