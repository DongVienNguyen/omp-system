import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {root,profileRoot} from './dev-preflight';
import {openProvider} from '../src/provider';
import {runWorker} from '../src/runtime';

const cwd=join(root,'.lab','workspaces','token-limits-'+randomUUID());mkdirSync(cwd,{recursive:true});
const provider=await openProvider(join(profileRoot('omp-system-dev'),'agent'));
let mode='turns',requests:any[]=[],effects=0;
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
 const body=await request.json() as any;requests.push(body);
 if(mode==='auth')return new Response(JSON.stringify({error:{message:'Unauthorized',type:'authentication_error'}}),{status:401,headers:{'content-type':'application/json'}});
 if(mode==='delayed')await Bun.sleep(1500);
 if(mode==='no-retry')return new Response(JSON.stringify({error:{message:'Temporary upstream failure',type:'server_error'}}),{status:503,headers:{'content-type':'application/json'}});
 const tool=(mode==='turns'||mode==='helper')&&requests.length===1||mode==='exhausted';
 const output=tool?6:4;
 if(mode==='retry'&&requests.length===1){const chunk={id:'partial',object:'chat.completion.chunk',created:1,model:'cap-model',choices:[{index:0,delta:{role:'assistant',content:'PARTIAL'},finish_reason:null}],usage:{prompt_tokens:5,completion_tokens:6,total_tokens:11}};return new Response('data: '+JSON.stringify(chunk)+'\n\n',{headers:{'content-type':'text/event-stream'}});}
 const delta=tool?{role:'assistant',tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'record_effect',arguments:'{}'}}]}:{role:'assistant',content:'DONE'};
 const chunk={id:'cap',object:'chat.completion.chunk',created:1,model:'cap-model',choices:[{index:0,delta,finish_reason:null}]};
 const end={...chunk,choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:5,completion_tokens:output,total_tokens:5+output}};
 if(mode==='unknown')delete (end as any).usage;
 return new Response('data: '+JSON.stringify(chunk)+'\n\ndata: '+JSON.stringify(end)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}});
try{
 provider.modelRegistry.registerProvider('cap-provider',{baseUrl:'http://127.0.0.1:'+server.port+'/v1',apiKey:'local-only',api:'openai-completions',models:[{id:'cap-model',name:'Owned cap fixture',reasoning:true,input:['text'],contextWindow:32768,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
 const base={id:'caps',cwd,agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider,model:{provider:'cap-provider',id:'cap-model'},thinkingLevel:'off' as const,systemPrompt:'Use admitted tool then finish.',prompt:'Exercise cap.',timeoutMs:20000,tokenLimits:{max_output_tokens:10,max_input_bytes:1048576,max_output_bytes:262144},tools:[{name:'record_effect',label:'Record effect',description:'Record owned effect',parameters:{type:'object',properties:{},additionalProperties:false},execute:async()=>{effects++;return {content:[{type:'text' as const,text:'Recorded'}],details:{}}}}]};
 const turns=await runWorker(base);assert.equal(turns.status,'success',JSON.stringify(turns));assert.deepEqual(requests.map(r=>r.max_tokens??r.max_completion_tokens),[10,4]);assert.equal(effects,1);assert.equal(turns.tokenBudget?.outputTokens,10);
 mode='exhausted';requests=[];effects=0;
 const exhausted=await runWorker({...base,tokenLimits:{...base.tokenLimits,max_output_tokens:6}});assert.equal(exhausted.failure?.code,'output_budget_exhausted',JSON.stringify(exhausted));assert.equal(requests.length,1);assert.equal(effects,0,'Exhausted output must not execute pending tool');
 mode='input';requests=[];
 const input=await runWorker({...base,tokenLimits:{...base.tokenLimits,max_input_bytes:1}});assert.equal(input.failure?.code,'input_byte_limit',JSON.stringify(input));assert.equal(requests.length,0);
 mode='retry';requests=[];
 const retry=await runWorker({...base,thinkingLevel:'low',tools:[],reserveRetry:()=>{}});assert.equal(retry.status,'success',JSON.stringify(retry));assert.deepEqual(requests.map(r=>r.max_tokens??r.max_completion_tokens),[10,4]);assert.equal(retry.tokenBudget?.outputTokens,10);
 mode='bytes';requests=[];
 const bytes=await runWorker({...base,tokenLimits:{...base.tokenLimits,max_output_bytes:1}});assert.equal(bytes.failure?.code,'output_budget_exhausted');assert.equal(bytes.reply,'');assert.equal(requests.length,1);
 mode='unknown';requests=[];
 const unknown=await runWorker({...base,thinkingLevel:'low',tools:[]});assert.equal(unknown.failure?.code,'output_usage_unknown');assert.equal(unknown.reply,'');assert.equal(requests.length,1);
 mode='helper';requests=[];let helperBudget:unknown;
 const helper=await runWorker({...base,tools:[{...base.tools[0]!,execute:async()=>{const child=await runWorker({...base,id:'helper',tools:[]});assert.equal(child.status,'success');helperBudget=child.tokenBudget;return {content:[{type:'text' as const,text:child.reply}],details:{}}}}]});assert.equal(helper.status,'success',JSON.stringify(helper));assert.deepEqual(requests.map(r=>r.max_tokens??r.max_completion_tokens),[10,10,4]);assert.equal((helperBudget as any).max_output_tokens,10);
 mode='auth';requests=[];
 const auth=await runWorker({...base,thinkingLevel:'low',tools:[],tokenLimits:{...base.tokenLimits,max_output_bytes:1}});assert.equal(auth.authRejected,true);assert.equal(auth.failure?.code,'auth_rejected');assert.equal(requests.length,1);assert.equal(auth.reply,'');
 mode='delayed';requests=[];
 const delayed=await runWorker({...base,thinkingLevel:'low',tools:[],timeoutMs:5000});assert.equal(delayed.status,'success',JSON.stringify(delayed));assert.equal(requests.length,1);
 mode='no-retry';requests=[];
 const unadmitted=await runWorker({...base,thinkingLevel:'low',tools:[]});assert.equal(unadmitted.status,'failed');assert.equal(unadmitted.recoveryStop,'budget');assert.equal(requests.length,1);
 const evidence={passed:true,scope:'Owned localhost actual SDK HTTP/SSE; no external provider',turns,exhausted,input,retry,bytes,unknown,helper,helperBudget,auth,delayed,unadmitted};writeFileSync(join(cwd,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,cwd,turnCaps:[10,4],retryCaps:[10,4],helperCaps:[10,10,4],authStop:auth.authRejected,exhaustedToolEffects:effects,fullDeadline:true,unadmittedRetryRequests:1}));
}finally{server.stop(true);provider.close()}
