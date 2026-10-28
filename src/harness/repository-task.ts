import { join } from 'node:path';
import { mkdirSync,readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runWorker,type WorkerRequest } from '../runtime';
import { Store } from '../state';
import { fsTools,snapshot,materialize,type Snapshot } from '../workspaces';
import { executeCheck } from '../checks';
import { digest,type Command } from '../contracts';
import { materialise,validateSurfaceTree } from './surfaces';
import type { HarnessAdapter,StageRequest,Tree,RunView } from './recursion';
import type { SelectionAdapter,ReflectionOptions } from './selection';
import { type ExecutableApproval } from './executable-authority';
import { surfaceTools } from './surface-tools';
import { ModelBudget } from '../model-budget';
import { supervised } from '../processes';
import { fileURLToPath } from 'node:url';
import {assertSnapshotCommand} from '../command-identity';
import type {TokenLimits} from '../token-limits';
export interface RepositoryExperiment {id:string;task:string;base:Snapshot;workspaceRoot:string;agentDir:string;outputPaths:string[];writeScope:string[];checks:Command[];trustedCode:boolean;approvals?:ExecutableApproval[];workerEnv?:NodeJS.ProcessEnv;modelBudget:ModelBudget;timeoutMs:number;tokenLimits:TokenLimits;authStorage:WorkerRequest['authStorage'];modelRegistry:WorkerRequest['modelRegistry'];}
export class RepositoryTaskAdapter implements HarnessAdapter,SelectionAdapter {
 readonly receipts:unknown[]=[];
 constructor(readonly store:Store,readonly config:RepositoryExperiment){for(const command of config.checks)assertSnapshotCommand(command)}
 validateTree(tree:Tree){validateSurfaceTree(tree,{executableCodeTrusted:this.config.trustedCode,approvals:this.config.approvals})}
 private async call(id:string,prompt:string,systemPrompt:string,cwd:string,tools:any[]=[],extensions:any[]=[],delegated=false){const execute=()=>runWorker({tokenLimits:this.config.tokenLimits,id,cwd,reserveRetry:()=>this.config.modelBudget.charge(1),agentDir:this.config.agentDir,authStorage:this.config.authStorage,modelRegistry:this.config.modelRegistry,model:{provider:'9router',id:'code-sol'},thinkingLevel:'high',systemPrompt,prompt,tools,extensions,timeoutMs:Math.min(this.config.timeoutMs,Math.max(1,this.config.modelBudget.deadline-Date.now()))});const r=await (delegated?this.config.modelBudget.delegate(execute):this.config.modelBudget.run(execute));this.receipts.push({id,status:r.status,wire:r.wire,attempts:r.attempts,usage:r.usage,tokenBudget:r.tokenBudget,disposed:r.disposed});if(r.status!=='success'||!r.disposed)throw Error('Harness worker failed '+(r.failure?.code||r.status));return r;}
 async propose(request:StageRequest){return this.refine(request)}
 async compose(request:StageRequest){return this.refine(request)}
 private async refine(request:StageRequest){const cwd=join(this.config.workspaceRoot,'stages',request.label+'-'+randomUUID());mkdirSync(cwd,{recursive:true});const r=await this.call(request.label,JSON.stringify({dimension:request.dimension,task:this.config.task,evidence:request.evidence,rejection:request.rejection}),'Improve harness, not task deliverable. Return JSON only {tree:Record<string,string>,notes:string}. Editable paths SYSTEM.md, GUARDRAILS.md, EXPERIENCE.md, TOOLS.md, agents/*.md, skills/*/SKILL.md, scripts/*.ts, plugins/*.ts. Preserve task and trusted policy. Propose concrete useful harness based on trajectory evidence.',cwd);const out=JSON.parse(r.reply);this.validateTree(out.tree);return {tree:out.tree as Tree,notes:String(out.notes||'')};}
 async rollout(request:{taskId:string;label:string;tree:Tree}):Promise<Omit<RunView,'label'>>{
  const runId=this.config.id+':'+request.label+':'+randomUUID(),cwd=join(this.config.workspaceRoot,'rollouts',request.label+'-'+randomUUID());materialize(this.store,this.config.base,cwd);this.validateTree(request.tree);
  const helperSlots=Object.keys(request.tree).filter(p=>p.startsWith('agents/')).length;
  const processRequest={id:request.label,cwd,agentDir:this.config.agentDir,surfaceRoot:join(cwd,'.harness'),tree:request.tree,trustedCode:this.config.trustedCode,approvals:this.config.approvals??[],model:'code-sol',effort:'high',tokenLimits:this.config.tokenLimits,timeoutMs:this.config.timeoutMs,deadline:this.config.modelBudget.deadline,maxCalls:Math.min(4*(1+helperSlots),this.config.modelBudget.remaining()),prompt:this.config.task+'\nOutput paths:'+JSON.stringify(this.config.outputPaths),readScope:this.config.base.scope,writeScope:this.config.writeScope};
  const reservation=this.config.modelBudget.reserve(Math.max(0,processRequest.maxCalls-1));
  const child=await this.config.modelBudget.run(()=>supervised(process.execPath,[fileURLToPath(new URL('./worker-process.ts',import.meta.url))],{cwd,env:{...this.config.workerEnv,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,BUN_BE_BUN:'1',OMP_PROFILE:process.env.OMP_PROFILE,TEMP:process.env.TEMP,TMP:process.env.TMP},timeoutMs:Math.min(this.config.timeoutMs+5000,Math.max(1,this.config.modelBudget.deadline-Date.now())),input:JSON.stringify(processRequest)}));
  if(child.status!=='exited'||child.exitCode!==0||child.truncated)throw Error('Harness worker process failed/expired');const envelope=JSON.parse(child.stdout);reservation.settle(Math.max(0,envelope.budget.calls-1));const r=envelope.result;this.receipts.push(...envelope.receipts);if(r.status!=='success'||!r.disposed)throw Error('Harness rollout incomplete');
  const checks=[];for(const command of this.config.checks)checks.push(await executeCheck(this.store,{...command,cwd},{candidate:digest(request.tree),policy:digest('experiment-frozen-policy'),plan:digest(this.config.checks)},{trustedCode:this.config.trustedCode,root:cwd}));
  const outputs=this.config.outputPaths.map(p=>({path:p,content:readFileSync(join(cwd,p),'utf8')}));const delivered=outputs.length>0&&outputs.every(x=>x.content.trim());const ok=checks.length>0&&checks.every(c=>c.exitCode===0&&c.status==='passed');const trajectory=JSON.stringify({reply:r.reply,wire:r.wire,checks:checks.map(c=>({id:c.id,status:c.status,observation:c.observation})),outputs});this.store.put('rollout',runId,{runId,taskId:request.taskId,source:this.config.base.id,workspace:cwd,tree:request.tree,checks,outputs});return {runId,ok,delivered:!!delivered,trajectory,deliverable:JSON.stringify(outputs),error:ok?'':'Required checks failed'};
 }
 async select(request:Parameters<SelectionAdapter['select']>[0]){const cwd=join(this.config.workspaceRoot,'selection');mkdirSync(cwd,{recursive:true});const r=await this.call('selector',JSON.stringify(request),'Compare all anonymous artifacts against task. Return JSON only {id:string,why:string}; choose exactly one existing candidate ID.',cwd);return JSON.parse(r.reply)}
 async reflect(request:Parameters<ReflectionOptions['reflect']>[0]){const cwd=join(this.config.workspaceRoot,'reflection');mkdirSync(cwd,{recursive:true});const r=await this.call('reflector',JSON.stringify(request),'Learn from actual task contrasts and adopted harness deltas. Return JSON only {experience:{cue:string,lesson:string,evidence:string,confidence:string,edits:string}}. Do not include hidden grader verdicts or invented outcomes.',cwd);return JSON.parse(r.reply)}
}
