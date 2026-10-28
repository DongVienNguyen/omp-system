import type {ExtensionAPI,ExtensionContext} from '@oh-my-pi/pi-coding-agent';
import {realpathSync,existsSync,lstatSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {digest,safeRelative} from './contracts';
import {scoped} from './workspaces';
import type {Store} from './state';
export interface WakeSpec {id:string;project:string;standingOrders:string;intervalMs:number;maxWakes:number;deadline:number;watch?:{path:string};}
export function parseWakeSpec(value:unknown,project:string):WakeSpec {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Native wake specification required');const v=value as WakeSpec;
 if(Object.keys(v).some(k=>!['id','project','standingOrders','intervalMs','maxWakes','deadline','watch'].includes(k))||typeof v.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.id)||typeof v.project!=='string'||realpathSync(v.project)!==realpathSync(project)||typeof v.standingOrders!=='string'||!v.standingOrders.trim()||v.standingOrders.length>16384||!Number.isSafeInteger(v.intervalMs)||v.intervalMs<1000||v.intervalMs>3600000||!Number.isSafeInteger(v.maxWakes)||v.maxWakes<1||v.maxWakes>100||!Number.isSafeInteger(v.deadline)||v.deadline<=Date.now()||v.deadline-Date.now()>86400000)throw Error('Invalid bounded native wake authority');
 if(v.watch){if(typeof v.watch!=='object'||Array.isArray(v.watch)||Object.keys(v.watch).some(k=>k!=='path')||typeof v.watch.path!=='string')throw Error('Explicit local watch path required');safeRelative(v.watch.path);scoped(project,v.watch.path)}return v;
}
interface WakeState {id:string;project:string;state:'ARMED'|'WAITING_ACK'|'STOPPED';sent:number;deadline:number;reason?:string;}
/** Sends native follow-up messages only. Never dispatches a worker, evaluates commands or creates another Coordinator. */
export function nativeWake(api:ExtensionAPI){
 const active=new Map<string,{stop:(reason:string)=>void;ack:()=>void}>();
 const key=(project:string,id:string)=>realpathSync(project)+':'+id;
 const stop=(project:string,id:string,reason='Operator stopped wake')=>{const entry=active.get(key(project,id));if(!entry)throw Error('Native wake not active in this session');entry.stop(reason);return {id,state:'STOPPED'};};
 const ack=(project:string,id:string)=>{const entry=active.get(key(project,id));if(!entry)throw Error('Native wake not active in this session');entry.ack();return {id,acknowledged:true};};
 const arm=(value:unknown,store:Store,ctx:ExtensionContext)=>{
  const spec=parseWakeSpec(value,ctx.cwd),identity=key(ctx.cwd,spec.id);if(active.has(identity)||store.get('native-wake',spec.id))throw Error('Native wake ID already exists; cold/interrupted state never auto-replays');
  let state:WakeState={id:spec.id,project:realpathSync(ctx.cwd),state:'ARMED',sent:0,deadline:spec.deadline},pendingEvent=false;
  const observation=()=>{if(!spec.watch)return '';const path=scoped(ctx.cwd,spec.watch.path);if(!existsSync(path))return 'absent';const before=lstatSync(path);if(!before.isFile()||before.size>1024**2)throw Error('Native watch requires file at most 1 MiB');const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const held=fstatSync(fd);scoped(ctx.cwd,spec.watch.path);if(held.dev!==before.dev||held.ino!==before.ino||!held.isFile()||held.size>1024**2)throw Error('Native watch file changed during open');const bytes=Buffer.allocUnsafe(1024**2+1);let size=0,n=0;do{n=readSync(fd,bytes,size,bytes.length-size,null);size+=n}while(n&&size<bytes.length);const after=fstatSync(fd),current=lstatSync(scoped(ctx.cwd,spec.watch.path));if(size>1024**2||after.size!==held.size||after.mtimeMs!==held.mtimeMs||current.dev!==held.dev||current.ino!==held.ino)throw Error('Native watch file changed during read');return digest(bytes.subarray(0,size).toString('base64'));}finally{closeSync(fd)}};
  let previous=observation();const publish=()=>store.put('native-wake',spec.id,state);publish();
  const stopLocal=(reason:string)=>{ctx.clearTimer(timer);ctx.clearTimer(expiry);active.delete(identity);state={...state,state:'STOPPED',reason};publish();};
  const timer=ctx.setInterval(()=>{try{
   if(Date.now()>=spec.deadline){stopLocal('Wake deadline exhausted');return}if(spec.watch){const now=observation();if(now!==previous){pendingEvent=true;previous=now}}
   if(state.state==='WAITING_ACK'||!ctx.isIdle()||ctx.hasPendingMessages()||existsSync(scoped(ctx.cwd,'.omp-system-execution.lock')))return;
   const reason=pendingEvent?'local-artifact-change':'heartbeat';pendingEvent=false;state={...state,state:'WAITING_ACK',sent:state.sent+1};publish();
   const continuation=state.sent>=spec.maxWakes?'Final authorized wake; no ACK needed. Wake limit now exhausted.':'Acknowledge with /omp-system wake-ack '+spec.id+' or stop with /omp-system wake-stop '+spec.id+'.';api.sendMessage({customType:'omp-system-wake',content:'Bounded operator-authorized wake '+spec.id+' ('+reason+'). Standing orders (verbatim):\n'+spec.standingOrders+'\nRecheck frozen exit predicate; execute only separately admitted actions. '+continuation+' Wake grants no worker, file-write, publish or merge authority.',display:true,details:{id:spec.id,reason,sent:state.sent,maxWakes:spec.maxWakes}},{triggerTurn:true,deliverAs:'nextTurn'});
   if(state.sent>=spec.maxWakes)stopLocal('Wake count exhausted');
  }catch(error){stopLocal(error instanceof Error?error.message:'Wake failed')}},spec.intervalMs);
  const expiry=ctx.setTimeout(()=>stopLocal('Wake deadline exhausted'),spec.deadline-Date.now());
  active.set(identity,{stop:stopLocal,ack:()=>{if(state.state!=='WAITING_ACK')throw Error('No outstanding native wake');state={...state,state:'ARMED'};publish()}});return state;
 };
 api.on('session_shutdown',()=>{for(const entry of [...active.values()])entry.stop('Session shutdown; explicit new authority required');active.clear()});
 api.on('session_switch',()=>{for(const entry of [...active.values()])entry.stop('Session switched; explicit new authority required');active.clear()});
 api.on('session_branch',()=>{for(const entry of [...active.values()])entry.stop('Session branched; explicit new authority required');active.clear()});
 return {arm,ack,stop,status(store:Store,project:string){return store.list<WakeState>('native-wake').map(state=>({...state,persistedState:state.state,state:state.state==='STOPPED'?'STOPPED':active.has(key(project,state.id))&&Date.now()<state.deadline?state.state:'INTERRUPTED',active:active.has(key(project,state.id))&&Date.now()<state.deadline}))},stopProject(project:string){for(const [identity,entry]of [...active])if(identity.startsWith(realpathSync(project)+':'))entry.stop('Project disabled')}};
}
