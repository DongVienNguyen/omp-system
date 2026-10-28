import {createAgentSession,Settings,SessionManager,AgentRegistry,type CreateAgentSessionResult} from '@oh-my-pi/pi-coding-agent';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {openProvider} from '../src/provider';
import {getAgentDir} from '@oh-my-pi/pi-utils';
import plugin from '../src/extension';
const request=JSON.parse(await Bun.stdin.text()) as {project:string;plugin:boolean;port:number};
const started=Date.now();const phase=(name:string)=>console.error(JSON.stringify({phase:name,elapsedMs:Date.now()-started}));phase('request-read');
const provider=await openProvider(getAgentDir());
phase('provider-registry-open');
let created:CreateAgentSessionResult|undefined;
try{
 const model=provider.modelRegistry.find('9router','code-sol');if(!model)throw Error('Probe model missing');
 created=await createAgentSession({cwd:request.project,agentDir:getAgentDir(),settings:Settings.isolated({'memory.backend':'off','autolearn.enabled':false}),...provider,model,hasUI:true,bindProcessState:false,sessionManager:SessionManager.inMemory(request.project),agentRegistry:new AgentRegistry(),skills:[],rules:[],contextFiles:[],promptTemplates:[],slashCommands:[],disableExtensionDiscovery:true,preloadedCustomToolPaths:[],restrictToolNames:true,toolNames:[],enableMCP:false,enableLsp:false,enableIrc:false,skipPythonPreflight:true,cacheWarming:false,preloadedPreparedExtensions:request.plugin?[{path:'<omp-system>',resolvedPath:'<omp-system>',factory:plugin,error:null}]:[]});
phase('native-session-created');
 created.session.agent.streamFn=()=>{throw Error('Inference forbidden in coexistence probe')};
 const session=created.session;
 const snapshot=()=>({sessionId:session.getSessionStats().sessionId,project:session.sessionManager.getCwd(),agentDir:getAgentDir(),model:{provider:session.model?.provider,id:session.model?.id},tools:session.getEnabledToolNames().sort(),commands:session.extensionRunner?.getRegisteredCommands().map(c=>c.name).sort()??[],extensions:session.extensionRunner?.getExtensionPaths().sort()??[]});
 const before=snapshot(),socket=createConnection(request.port,'127.0.0.1');await once(socket,'connect');socket.write(JSON.stringify({phase:'before',snapshot:before})+'\n');
 const lines=createInterface({input:socket,crlfDelay:Infinity});let after:typeof before|undefined;
 for await(const line of lines){if(line==='snapshot'){after=snapshot();socket.write(JSON.stringify({phase:'after',snapshot:after})+'\n')}else if(line==='finish')break;else throw Error('Unknown probe control message')}
 if(!after||JSON.stringify(before)!==JSON.stringify(after))throw Error('Surrogate session identity/discovery changed');
 lines.close();socket.end();console.log(JSON.stringify({before,after,unchanged:true,inference:false}));
}finally{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([created?.session.dispose(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Native session disposal unconfirmed')),10000)})])}finally{clearTimeout(timer);provider.close()}}
