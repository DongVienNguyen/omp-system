import assert from 'node:assert/strict';
import {createAgentSession,Settings,SessionManager,AgentRegistry,type ExtensionAPI,type CreateAgentSessionResult} from '@oh-my-pi/pi-coding-agent';
import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {nativeWake} from '../src/native-wake';
import {Store} from '../src/state';
import {openProvider} from '../src/provider';
import {root,profileRoot,protectedHashes} from './dev-preflight';
import {admitResources} from '../src/resource-admission';
const admission=await admitResources(root,true);let created:CreateAgentSessionResult|undefined;let store:Store|undefined;let provider:Awaited<ReturnType<typeof openProvider>>|undefined;
try{
 const id='native-wake-'+randomUUID(),project=join(root,'.lab','workspaces',id),agentDir=join(profileRoot('omp-system-dev'),'agent'),before=protectedHashes();mkdirSync(project,{recursive:true});store=new Store(join(root,'.lab','state',id));provider=await openProvider(agentDir);
 let wakes:ReturnType<typeof nativeWake>|undefined;const errors:unknown[]=[],turns:unknown[]=[],wakeSeen=Promise.withResolvers<void>();
 const factory=(api:ExtensionAPI)=>{wakes=nativeWake(api);api.registerCommand('wake-smoke',{description:'Authorized isolated bounded native wake probe',handler:async(_args,ctx)=>{wakes!.arm({id,project,standingOrders:'Read-only native wake observation; no tools, writes or provider calls.',intervalMs:1000,maxWakes:1,deadline:Date.now()+8000},store!,ctx)}});api.on('before_provider_request',()=>{turns.push('provider-boundary-blocked');wakeSeen.resolve();throw Error('Smoke forbids provider inference')});};
 const model=provider.modelRegistry.find('9router','code-sol');if(!model)throw Error('Native smoke model missing');created=await createAgentSession({cwd:project,agentDir,settings:Settings.isolated({'memory.backend':'off','autolearn.enabled':false}),...provider,model,hasUI:true,bindProcessState:false,sessionManager:SessionManager.inMemory(project),agentRegistry:new AgentRegistry(),skills:[],rules:[],contextFiles:[],promptTemplates:[],slashCommands:[],disableExtensionDiscovery:true,preloadedCustomToolPaths:[],restrictToolNames:true,toolNames:[],enableMCP:false,enableLsp:false,enableIrc:false,skipPythonPreflight:true,cacheWarming:false,preloadedPreparedExtensions:[{path:'<native-wake-smoke>',resolvedPath:'<native-wake-smoke>',factory,error:null}]});
 const runtimeInit=await import(new URL('../node_modules/@oh-my-pi/pi-coding-agent/src/modes/runtime-init.ts',import.meta.url).href),runner=created.session.extensionRunner!;runner.onError(e=>errors.push(e));await runtimeInit.initializeExtensions(created.session,{uiContext:{...runner.getUIContext(),notify:()=>{}},reportRuntimeError:(e:unknown)=>errors.push(e),reportSendError:(_a:unknown,e:unknown)=>errors.push(e)});created.session.agent.streamFn=()=>{turns.push('stream-boundary-blocked');wakeSeen.resolve();throw Error('Inference forbidden')};
 await created.session.prompt('/wake-smoke');await Promise.race([wakeSeen.promise,Bun.sleep(10000).then(()=>{throw Error('Native wake did not start a turn')})]);await created.session.abort();assert(turns.includes('stream-boundary-blocked'),'Wake must reach replaced streamFn which throws before provider transport');const state=store.get<any>('native-wake',id);assert.equal(state.sent,1);assert.equal(state.state,'STOPPED');assert.deepEqual(protectedHashes(),before);
 const evidence={passed:true,project,state,turns,errors:errors.map(String),protectedConfigUnchanged:true,inference:false};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,project,sent:state.sent,nativeTurnObserved:true,inference:false,protectedConfigUnchanged:true}));
}finally{await created?.session.dispose();store?.close();provider?.close();admission.release()}
