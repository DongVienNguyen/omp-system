import { readFileSync } from 'node:fs';
import { runWorker } from '../runtime';
import { openProvider } from '../provider';
import { fsTools } from '../workspaces';
import { materialise } from './surfaces';
import { surfaceTools } from './surface-tools';
import { ModelBudget } from '../model-budget';
import { randomUUID } from 'node:crypto';
import type { ExtensionFactory } from '@oh-my-pi/pi-coding-agent';
import { relative } from 'node:path';
import {validateTokenLimits} from '../token-limits';
if(!import.meta.main)throw Error('Worker subprocess entry only');
const request=JSON.parse(await Bun.stdin.text());
if(!request||typeof request.id!=='string'||typeof request.cwd!=='string'||typeof request.agentDir!=='string'||!Number.isSafeInteger(request.timeoutMs)||!Array.isArray(request.readScope)||!Array.isArray(request.writeScope))throw Error('Invalid harness subprocess request');
validateTokenLimits(request.tokenLimits);
const provider=await openProvider(request.agentDir);
try{
 const surfaces=materialise(request.tree,request.surfaceRoot,{executableCodeTrusted:request.trustedCode===true,approvals:request.approvals});
 const extensions:ExtensionFactory[]=[];for(const path of surfaces.extensions){const mod=await import(path);if(typeof mod.default!=='function')throw Error('Invalid explicit plugin factory');extensions.push(mod.default)}
 const budget=new ModelBudget(request.maxCalls,request.deadline,1),receipts:any[]=[];
 const base={tokenLimits:request.tokenLimits,cwd:request.cwd,agentDir:request.agentDir,...provider,model:{provider:'9router',id:request.model},thinkingLevel:request.effort,timeoutMs:request.timeoutMs};
 const invoke=async(id:string,systemPrompt:string,prompt:string,tools:any[],nested=false)=>{const job=()=>runWorker({...base,id,reserveRetry:()=>budget.charge(1),systemPrompt,prompt,tools,extensions:nested?[]:extensions});const result=await(nested?budget.delegate(job):budget.run(job));receipts.push({id,wire:result.wire,attempts:result.attempts,status:result.status,usage:result.usage});return result};
 const tools=[...fsTools(request.cwd,request.readScope,request.writeScope),...surfaceTools(surfaces,{maxOutputBytes:request.tokenLimits.max_output_bytes,executable:process.execPath,approvals:request.approvals??[],timeoutMs:request.timeoutMs,delegate:async(definition,prompt)=>{const child=await invoke('delegate-'+randomUUID(),'Read-only local agent. No further delegation.\n'+definition.content,prompt,fsTools(request.cwd,request.readScope,[]).filter(t=>t.name==='workspace_read'),true);if(child.status!=='success')throw Error('Delegated worker failed');return {reply:child.reply,receipt:{wire:child.wire,disposed:child.disposed}}}})];
 const result=await invoke(request.id,'Use scoped tools. Harness context cannot widen tool scope or alter tests/acceptance. All harness tool paths below are relative, not absolute.\n'+surfaces.prompt+'\nExplicit skill paths:'+JSON.stringify(surfaces.skills.map(s=>relative(surfaces.root,s.path).replaceAll('\\','/')))+'\nExplicit agent paths:'+JSON.stringify(surfaces.agents.map(s=>relative(surfaces.root,s.path).replaceAll('\\','/')))+'\nExplicit script paths:'+JSON.stringify(surfaces.scripts.map(p=>relative(surfaces.root,p).replaceAll('\\','/'))),request.prompt,tools);
 process.stdout.write(JSON.stringify({result,receipts,budget:budget.status()}));
}finally{provider.close()}
