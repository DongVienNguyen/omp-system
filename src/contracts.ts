import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
export type State = 'PLANNED'|'READY'|'RUNNING'|'VERIFYING'|'LOCAL_VERIFIED'|'DELIVERING'|'REMOTE_VERIFIED'|'DELIVERED'|'BLOCKED'|'FAILED'|'CANCEL_REQUESTED'|'CANCELLED';
export type Difficulty = 'easy'|'medium'|'hard';
export const models = { easy: ['code-seek','high'], medium: ['code-sol','high'], hard: ['code-astra','low'] } as const;
export interface InstructionSelection {agent?:{name:string;sha256:string};skills?:{name:string;sha256:string}[];rules?:{name:string;sha256:string}[];}
export interface Task { id:string; depends_on:string[]; goal:string; acceptance:string[]; read_scope:string[]; write_scope:string[]; difficulty:Difficulty; state:State; attempt:number; snapshot:string; instructions?:InstructionSelection; }
export interface Budget { concurrency:number; max_worker_calls:number; max_rollouts:number; max_stages:number; max_transport_retries:number; max_repairs:number; deadline:number; max_output_tokens:number; max_input_bytes:number; max_output_bytes:number; }
export interface RuntimeProof {kind:'exit-code';reason:string;}
export interface Command { id:string; executable:string; args:string[]; cwd:string; timeoutMs:number; testCount?:number; noTestsReason?:string; runner?:'bun-test'|'command'; proof?:RuntimeProof; input_scope?:string[]; }
export interface Check { id:string; candidate:string; policy:string; plan:string; exitCode:number|null; status:'passed'|'failed'|'cancelled'|'timed_out'; selectedTests:number|null; log:string; observation:string; runner?:'bun-test'|'command'; proof?:RuntimeProof; }
export function validateRuntimeProof(value:unknown):asserts value is RuntimeProof {if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['kind','reason'].includes(k))||!('kind'in value)||value.kind!=='exit-code'||!('reason'in value)||typeof value.reason!=='string'||!value.reason.trim())throw Error('Explicit exit-code runtime proof required')}
export interface Review { id:string; candidate:string; base:string; policy:string; plan:string; session:string; implementerSession:string; status:'complete'|'partial'|'failed'; reviewed_paths:string[]; findings:{id:string;blocking:boolean;resolved:boolean; evidence:string}[]; }
export interface Certificate { id:string; run?:string; generation?:string; candidate:string; base:string; policy:string; plan:string; review:string; checks:string[]; scope:'LOCAL_VERIFIED'|'REMOTE_VERIFIED'; valid:boolean; reason?:string; }
export function canonical(value:unknown):string {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Nonfinite value');return JSON.stringify(value)}
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(typeof value==='object')return '{'+Object.keys(value as object).filter(k=>(value as any)[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical((value as any)[k])).join(',')+'}';
  throw Error('Non-JSON value');
}
export const digest=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export function nonempty(value:unknown,label:string):asserts value is string {if(typeof value!=='string'||!value.trim())throw Error(label+' required')}
export function safeRelative(value:string):string {nonempty(value,'path');const p=value.replaceAll('\\','/');if(isAbsolute(value)||/^[a-z]:/i.test(p)||p.split('/').some(x=>x==='..'||x==='')||p.startsWith('/'))throw Error('Unsafe relative path');return p}
export function contained(base:string,target:string):boolean {const r=relative(resolve(base),resolve(target));return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..\\')&&!r.startsWith('../'))}
export function validateTasks(tasks:Task[]):void {
 const index=new Map<string,Task>();for(const t of tasks){nonempty(t.id,'task.id');if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(t.id))throw Error('Unsafe task id');nonempty(t.goal,'task.goal');if(index.has(t.id))throw Error('Duplicate task');if(!Array.isArray(t.depends_on)||!Array.isArray(t.acceptance)||!Array.isArray(t.read_scope)||!Array.isArray(t.write_scope)||!t.acceptance.length||t.acceptance.some(x=>typeof x!=='string'||!x.trim()))throw Error('Acceptance/dependencies/scopes required');if(!models[t.difficulty]||t.state!=='PLANNED'||t.attempt!==0)throw Error('New tasks require known difficulty and initial state/attempt');for(const p of [...t.read_scope,...t.write_scope])safeRelative(p);index.set(t.id,t)}
 const active=new Set<string>(),done=new Set<string>();const visit=(id:string)=>{if(active.has(id))throw Error('Dependency cycle');if(done.has(id))return;const t=index.get(id);if(!t)throw Error('Missing dependency '+id);active.add(id);t.depends_on.forEach(visit);active.delete(id);done.add(id)};tasks.forEach(t=>visit(t.id));
}
export const transitions:Record<State,State[]>={PLANNED:['READY','BLOCKED','CANCEL_REQUESTED'],READY:['RUNNING','BLOCKED','CANCEL_REQUESTED'],RUNNING:['VERIFYING','FAILED','BLOCKED','CANCEL_REQUESTED'],VERIFYING:['LOCAL_VERIFIED','FAILED','BLOCKED','CANCEL_REQUESTED'],LOCAL_VERIFIED:['DELIVERING','BLOCKED','CANCEL_REQUESTED'],DELIVERING:['REMOTE_VERIFIED','DELIVERED','FAILED','BLOCKED','CANCEL_REQUESTED'],REMOTE_VERIFIED:['DELIVERED','BLOCKED'],DELIVERED:[],BLOCKED:['READY','CANCEL_REQUESTED'],FAILED:[],CANCEL_REQUESTED:['CANCELLED'],CANCELLED:[]};
