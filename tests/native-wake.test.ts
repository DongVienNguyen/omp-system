import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeWake} from '../src/native-wake';
import {Store} from '../src/state';
import type {ExtensionAPI,ExtensionContext} from '@oh-my-pi/pi-coding-agent';
const {ManagedTimers}=await import(import.meta.resolve('@oh-my-pi/pi-coding-agent/extensibility/extensions/managed-timers'));
const project=mkdtempSync(join(tmpdir(),'wake-check-')),store=new Store(join(project,'state')),messages:any[]=[],errors:unknown[]=[];const hooks=new Map<string,()=>void>();let idle=false;
const timers=new ManagedTimers((...e:unknown[])=>errors.push(e)),api={on(event:string,fn:()=>void){hooks.set(event,fn)},sendMessage(message:unknown,options:unknown){messages.push({message,options})}},ctx={cwd:project,isIdle:()=>idle,hasPendingMessages:()=>false,setInterval:timers.setInterval.bind(timers),setTimeout:timers.setTimeout.bind(timers),clearTimer:timers.clear.bind(timers)};
const wakes=nativeWake(api as unknown as ExtensionAPI),spec={id:'bounded',project,standingOrders:'Verify immutable predicate, never publish.',intervalMs:1000,maxWakes:2,deadline:Date.now()+15000,watch:{path:'event.txt'}};writeFileSync(join(project,'event.txt'),'first');
try{
 wakes.arm(spec,store,ctx as unknown as ExtensionContext);await Bun.sleep(1100);assert.equal(messages.length,0);idle=true;writeFileSync(join(project,'event.txt'),'changed');await Bun.sleep(1100);assert.equal(messages[0].message.details.reason,'local-artifact-change');assert.equal(messages[0].options.triggerTurn,true);assert(messages[0].message.content.includes(spec.standingOrders));await Bun.sleep(1100);assert.equal(messages.length,1);wakes.ack(project,spec.id);await Bun.sleep(1100);assert.equal(messages.length,2);assert.equal(store.get<any>('native-wake',spec.id).reason,'Wake count exhausted');await Bun.sleep(1100);assert.equal(messages.length,2);
 assert.throws(()=>wakes.arm(spec,store,ctx as unknown as ExtensionContext),/already exists/);
 assert(messages[1].message.content.includes('Final authorized wake; no ACK needed.'));assert(!messages[1].message.content.includes('Acknowledge with'));
 wakes.arm({...spec,id:'shutdown',deadline:Date.now()+10000},store,ctx as unknown as ExtensionContext);hooks.get('session_shutdown')!();assert.equal(store.get<any>('native-wake','shutdown').state,'STOPPED');await Bun.sleep(1100);assert.equal(messages.length,2);assert.deepEqual(errors,[]);
 wakes.arm({...spec,id:'switch',deadline:Date.now()+10000},store,ctx as unknown as ExtensionContext);hooks.get('session_switch')!();assert.equal(store.get<any>('native-wake','switch').state,'STOPPED');assert.equal(hooks.has('session_stop'),false);
 writeFileSync(join(project,'large.txt'),Buffer.alloc(1024**2+1));assert.throws(()=>wakes.arm({...spec,id:'large',watch:{path:'large.txt'}},store,ctx as unknown as ExtensionContext),/1 MiB/);
 store.put('native-wake','cold',{id:'cold',project,state:'WAITING_ACK',sent:1,deadline:Date.now()+10000});const cold=wakes.status(store,project).find(w=>w.id==='cold')!;assert.equal(cold.state,'INTERRUPTED');assert.equal(cold.active,false);assert.equal(cold.persistedState,'WAITING_ACK');assert.throws(()=>wakes.ack(project,'cold'),/not active/);
 console.log('native-wake: real SDK managed timers, busy gating, local change, ACK backpressure, max count and shutdown no replay PASS');
}finally{timers.clearAll();store.close();rmSync(project,{recursive:true,force:true})}
