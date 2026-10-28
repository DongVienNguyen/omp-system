import { AuthStorage,ModelRegistry,Settings } from '@oh-my-pi/pi-coding-agent';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root,profileRoot,protectedHashes } from './dev-preflight';
import { runWorker } from '../src/runtime';
import { models } from '../src/contracts';
const before=protectedHashes(),agentDir=join(profileRoot('omp-system-dev'),'agent'),cwd=join(root,'.lab','workspaces','routing');mkdirSync(cwd,{recursive:true});
const auth=await AuthStorage.create(join(agentDir,'agent.db'));const registry=new ModelRegistry(auth,join(agentDir,'models.yml'),{settings:Settings.isolated({'memory.backend':'off'}),cacheDbPath:join(agentDir,'models.db')});const provider=(Bun.YAML.parse(readFileSync(join(process.env.USERPROFILE!,'.omp','agent','models.yml'),'utf8')) as any).providers['9router'];registry.registerProvider('9router',{...provider,models:provider.models.map((m:any)=>({...m,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}))});
const results=[];
try{for(const [difficulty,[model,effort]] of Object.entries(models)){const result=await runWorker({tokenLimits:{max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144},id:'routing-'+difficulty,cwd,agentDir,authStorage:auth,modelRegistry:registry,model:{provider:'9router',id:model},thinkingLevel:effort,systemPrompt:'Reply exactly ROUTE_OK.',prompt:'Reply ROUTE_OK.',tools:[],timeoutMs:45000});const matched=result.status==='success'&&result.disposed&&result.wire.every(w=>w.provider==='9router'&&w.model===model&&w.effort.reasoning_effort===effort);results.push({difficulty,model,effort,matched,result});if(!matched)process.exitCode=1}if(JSON.stringify(before)!==JSON.stringify(protectedHashes()))throw Error('Protected config changed');writeFileSync(join(root,'.lab','evidence','routing-live.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results))}finally{auth.close()}
