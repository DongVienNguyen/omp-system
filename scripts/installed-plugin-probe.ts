import {createAgentSession,Settings,SessionManager,AgentRegistry,type AgentSession,type ExtensionUIContext,type ExtensionError} from '@oh-my-pi/pi-coding-agent';
import {join,resolve} from 'node:path';
import {realpathSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAgentDir,getPluginsDir} from '@oh-my-pi/pi-utils';
import {openProvider} from '../src/provider';
const started=Date.now();const phase=(name:string)=>console.error(JSON.stringify({phase:name,elapsedMs:Date.now()-started}));phase('sdk-imported');
// Module-loading probe: static source import pulls SDK internals against incompatible public declarations; pinned runtime source has no packaged JS entry.
const runtimeInitUrl=new URL('../node_modules/@oh-my-pi/pi-coding-agent/src/modes/runtime-init.ts',import.meta.url).href;
const runtimeInit:unknown=await import(runtimeInitUrl);if(!runtimeInit||typeof runtimeInit!=='object'||!('initializeExtensions'in runtimeInit)||typeof runtimeInit.initializeExtensions!=='function')throw Error('Pinned SDK runtime initializer missing');
// Pinned source module and public package declarations describe same runtime session.
const initializeExtensions=runtimeInit.initializeExtensions as (session:AgentSession,options:{uiContext:ExtensionUIContext;reportRuntimeError:(error:ExtensionError)=>void;reportSendError:(action:string,error:Error)=>void})=>Promise<void>;
if(process.env.OMP_PROFILE!=='omp-system-install-test')throw Error('Dedicated installed profile required before import');
const project=realpathSync(resolve(process.argv[2]!)),version=process.argv[3],agentDir=getAgentDir(),installed=join(getPluginsDir(),'node_modules','omp-system'),expected=realpathSync(join(installed,'src','extension.ts'));mkdirSync(project,{recursive:true});
const pkg=JSON.parse(readFileSync(join(installed,'package.json'),'utf8'));if(!version||pkg.version!==version)throw Error('Installed package version mismatch');
const manifest=JSON.parse(readFileSync(join(installed,'package-manifest.json'),'utf8')) as {path:string;sha256:string}[];for(const file of manifest){if(createHash('sha256').update(readFileSync(join(installed,file.path))).digest('hex')!==file.sha256)throw Error('Installed asset mismatch: '+file.path)}
const provider=await openProvider(agentDir);let created:Awaited<ReturnType<typeof createAgentSession>>|undefined;
phase('provider-registry-open');
try{
 const model=provider.modelRegistry.find('9router','code-sol');if(!model)throw Error('Probe model missing');
 created=await createAgentSession({cwd:project,agentDir,settings:Settings.isolated({'memory.backend':'off','autolearn.enabled':false}),...provider,model,hasUI:true,bindProcessState:false,sessionManager:SessionManager.inMemory(project),agentRegistry:new AgentRegistry(),skills:[],rules:[],contextFiles:[],promptTemplates:[],slashCommands:[],disableExtensionDiscovery:false,preloadedCustomToolPaths:[],toolNames:[],enableMCP:false,enableLsp:false,enableIrc:false,skipPythonPreflight:true,cacheWarming:false});
phase('native-session-created');
 const loaded=created.extensionsResult.extensions.filter(e=>!e.resolvedPath.startsWith('<')&&realpathSync(e.resolvedPath)===expected);if(created.extensionsResult.errors.length||loaded.length!==1||!loaded[0]!.commands.has('omp-system')||!loaded[0]!.tools.has('omp_system'))throw Error('Native installed extension discovery failed: '+JSON.stringify(created.extensionsResult.errors));
 const runner=created.session.extensionRunner;if(!runner?.getCommand('omp-system'))throw Error('Native slash command absent; refusing inference fallback');const errors:unknown[]=[],notifications:string[]=[];runner.onError(e=>errors.push(e));
 created.session.agent.streamFn=()=>{throw Error('Inference forbidden in installed plugin probe')};
 await initializeExtensions(created.session,{uiContext:{...runner.getUIContext(),notify:(text:string)=>notifications.push(text)},reportRuntimeError:error=>errors.push(error),reportSendError:(action,error)=>errors.push({action,error:String(error)})});await created.session.prompt('/omp-system status');
 const status=notifications.map(t=>{try{return JSON.parse(t)}catch{return null}}).find(x=>x?.plugin==='omp-system');if(errors.length||!status||status.enabled!==false)throw Error('Installed command did not report disabled project: '+JSON.stringify({errors,notifications}));
 const approvedKey=process.env.OMP_SYSTEM_API_KEY;delete process.env.OMP_SYSTEM_API_KEY;let missingAuth:unknown;try{notifications.length=0;await created.session.prompt('/omp-system doctor');missingAuth=notifications.map(t=>{try{return JSON.parse(t)}catch{return null}}).find(x=>Array.isArray(x?.checks));if(!missingAuth||typeof missingAuth!=='object'||!('canEnable' in missingAuth)||missingAuth.canEnable!==false)throw Error('Installed missing credential did not block activation')}finally{if(approvedKey!==undefined)process.env.OMP_SYSTEM_API_KEY=approvedKey}
 notifications.length=0;await created.session.prompt('/omp-system doctor');const doctor=notifications.map(t=>{try{return JSON.parse(t)}catch{return null}}).find(x=>Array.isArray(x?.checks));if(errors.length||!doctor||doctor.canEnable!==true||doctor.inference!=='NOT RUN')throw Error('Installed doctor blocked activation: '+JSON.stringify({errors,checks:doctor?.checks?.map((c:{id:string;status:string;severity:string})=>({id:c.id,status:c.status,severity:c.severity}))}));
 notifications.length=0;await created.session.prompt('/omp-system enable');const enabled=notifications.map(t=>{try{return JSON.parse(t)}catch{return null}}).find(x=>x?.plugin==='omp-system');if(errors.length||enabled?.enabled!==true)throw Error('Installed enable did not honor verified doctor');await created.session.prompt('/omp-system disable');
 console.log(JSON.stringify({passed:true,version:pkg.version,installed:expected,assets:manifest.length,loaded:loaded.length,project:status.project,enabledAfterProbe:false,catalog:status.catalog.length,missingAuthBlocked:true,doctorCanEnable:doctor.canEnable,inference:false}));
}finally{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([created?.session.dispose(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Installed session disposal unconfirmed')),10000)})])}finally{clearTimeout(timer);provider.close()}}
