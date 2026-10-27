import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {scoped} from './workspaces';
import {canonical,digest,safeRelative} from './contracts';
import {runTraceForensics} from './trace-forensics';
import type {Store} from './state';
export interface RuntimeForensicsRequest {action:'runtime-forensics';id:string;project:string;endpoint:string;expectedPid:number;output:string;sampleMs:number;instrumentation:{expression:string;expected:unknown};deadline:number;}
export function validateRuntimeForensics(value:unknown,project:string):RuntimeForensicsRequest{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Runtime forensic object required');const v=value as Record<string,any>;
 if(Object.keys(v).some(k=>!['action','id','project','endpoint','expectedPid','output','sampleMs','instrumentation','deadline'].includes(k))||v.action!=='runtime-forensics'||typeof v.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.id)||typeof v.project!=='string'||resolve(v.project)!==resolve(project))throw Error('Runtime forensic identity mismatch');
 if(typeof v.endpoint!=='string')throw Error('Explicit inspector endpoint required');const url=new URL(v.endpoint);if(url.protocol!=='ws:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!url.port||url.pathname==='/')throw Error('Exact loopback inspector WebSocket required');
 if(!Number.isSafeInteger(v.expectedPid)||v.expectedPid<=0||!Number.isSafeInteger(v.sampleMs)||v.sampleMs<10||v.sampleMs>10000||!Number.isSafeInteger(v.deadline)||v.deadline<=Date.now()+v.sampleMs)throw Error('Bounded CPU capture and PID required');
 if(typeof v.output!=='string'||!v.output.endsWith('.cpuprofile'))throw Error('Explicit new cpuprofile output required');safeRelative(v.output);
 const i=v.instrumentation;if(!i||typeof i!=='object'||Array.isArray(i)||Object.keys(i).some(k=>!['expression','expected'].includes(k))||typeof i.expression!=='string'||!i.expression.trim()||!Object.hasOwn(i,'expected'))throw Error('Exact operator-approved live instrumentation expression/result required');canonical(i.expected);
 return v as RuntimeForensicsRequest;
}
export async function runRuntimeForensics(value:unknown,store:Store,project:string){
 const request=validateRuntimeForensics(value,project),destination=scoped(project,request.output),probePath=request.output+'.probe.cpuprofile',probeDestination=scoped(project,probePath);if(store.get('catalog-operator',request.id)||existsSync(destination)||existsSync(probeDestination))throw Error('Runtime capture ID/output already exists');
 store.put('catalog-operator',request.id,{action:request.action,id:request.id,project,state:'STARTED',expectedPid:request.expectedPid,expressionSha256:digest(request.instrumentation.expression)});
 const ws=new WebSocket(request.endpoint),pending=new Map<number,{method:string;resolve:(v:any)=>void;reject:(e:Error)=>void}>();let next=0,connected=false;
 const failure=(message:string)=>{for(const p of pending.values())p.reject(Error(message));pending.clear()};
 ws.addEventListener('message',event=>{try{const message=JSON.parse(String(event.data));const p=pending.get(message.id);if(!p)return;pending.delete(message.id);if(message.error)p.reject(Error('Inspector '+p.method+': '+JSON.stringify(message.error)));else p.resolve(message.result)}catch{failure('Invalid inspector response')}});
 ws.addEventListener('close',()=>failure('Inspector closed'));ws.addEventListener('error',()=>failure('Inspector connection failed'));
 let timer:ReturnType<typeof setTimeout>|undefined,started=false,stopping=false;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{stopping=true;failure('Runtime forensic deadline exhausted');reject(Error('Runtime forensic deadline exhausted'))},Math.max(1,request.deadline-Date.now()))});
 const command=(method:string,params:unknown={},cleanup=false)=>new Promise<any>((resolve,reject)=>{if(!cleanup&&(stopping||Date.now()>=request.deadline)){reject(Error('Runtime forensic deadline exhausted'));return}if(ws.readyState!==WebSocket.OPEN){reject(Error('Inspector not connected'));return}const id=++next;pending.set(id,{method,resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async(expression:string)=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails||r.result?.subtype==='error'||!r.result||!Object.hasOwn(r.result,'value'))throw Error('Live instrumentation failed or returned non-JSON value');return r.result.value;};
 try{return await Promise.race([expired,(async()=>{
  await new Promise<void>((resolve,reject)=>{ws.addEventListener('open',()=>{connected=true;resolve()},{once:true});ws.addEventListener('error',()=>reject(Error('Inspector connection failed')),{once:true});ws.addEventListener('close',()=>{if(!connected)reject(Error('Inspector closed before connection'))},{once:true})});
  const actualPid=await evaluate('process.pid');if(actualPid!==request.expectedPid)throw Error('Inspector PID mismatch; no instrumentation executed');
  await command('Profiler.enable');await command('Profiler.start');started=true;await delay(request.sampleMs);const baseline=await command('Profiler.stop');started=false;
  if(Date.now()>=request.deadline)throw Error('Runtime forensic deadline exhausted');mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,JSON.stringify(baseline.profile),{flag:'wx',mode:0o600});
  await command('Profiler.start');started=true;const observed=await evaluate(request.instrumentation.expression);const captured=await command('Profiler.stop');started=false;
  if(Date.now()>=request.deadline)throw Error('Runtime forensic deadline exhausted');writeFileSync(probeDestination,JSON.stringify(captured.profile),{flag:'wx',mode:0o600});if(canonical(observed)!==canonical(request.instrumentation.expected))throw Error('Live instrumentation result differs from approved expected mechanism evidence');
  const analyze=(id:string,path:string)=>runTraceForensics({action:'trace',id,project,paths:[path],before:path,deadline:request.deadline},store,project);
  const analysis=analyze(request.id+'-baseline',request.output),probe=analyze(request.id+'-probe',probePath);
  const result={action:request.action,id:request.id,project,expectedPid:request.expectedPid,signal:'live-node-cpu',capturePhase:'baseline-then-approved-instrumentation',analysis,probe,instrumentation:{expressionSha256:digest(request.instrumentation.expression),observed,matched:true},mechanism:'OPERATOR_OBSERVATION_MATCHED',confirmedCause:false,limits:'Baseline and instrumented profile retained separately. Observation match does not independently establish causality or browser/heap parity.'};store.put('catalog-operator',request.id,result);return result;
 })()]);}catch(error){stopping=true;store.put('catalog-operator',request.id,{action:request.action,id:request.id,project,state:'FAILED',error:error instanceof Error?error.message:String(error),output:request.output,probeOutput:probePath});throw error;}finally{stopping=true;if(timer)clearTimeout(timer);if(started){let cleanupTimer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([command('Profiler.stop',{},true),new Promise<never>((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('Profiler cleanup unconfirmed')),1000)})]);}catch(error){store.put('catalog-operator',request.id,{action:request.action,id:request.id,project,state:'FAILED',error:'Profiler cleanup unconfirmed; inspect target before further profiling',output:request.output,probeOutput:probePath});throw error;}finally{if(cleanupTimer)clearTimeout(cleanupTimer);failure('Inspector session ended');ws.close()}}else{failure('Inspector session ended');ws.close()}}
}
