import {join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {root,profileRoot} from './dev-preflight';
import {openProvider} from '../src/provider';
import {Store} from '../src/state';
import {snapshot} from '../src/workspaces';
import {runCatalogWorkflow} from '../src/catalog-method';
import {workflowCatalog} from '../src/catalog';
import {parseWorkflow} from '../src/workflow-spec';
import {admitResources} from '../src/resource-admission';
// Parent schedules this one process only after granting cap=1 model admission.
const selected=process.argv.slice(2);if(selected.some(n=>!['investigation','bug-fix','refactoring'].includes(n)))throw Error('Unknown semantic scenario');
const admission=await admitResources(root,true),id='semantic-'+randomUUID(),project=join(root,'.lab','workspaces',id);mkdirSync(project,{recursive:true});const store=new Store(join(root,'.lab','state',id)),provider=await openProvider(join(profileRoot('omp-system-dev'),'agent'));const results:unknown[]=[];
const deadline=Date.now()+300000;const watchdog=setTimeout(()=>{writeFileSync(join(project,'deadline-evidence.json'),JSON.stringify({passed:false,id,results,reason:'Global300s deadline'}));store.close();provider.close();admission.release();process.exit(1)},300000);
try{
 for(const name of selected.length?selected:['investigation','bug-fix','refactoring']){
  const source=join(project,name);mkdirSync(source);const initial=name==='bug-fix'?'export const add=(a:number,b:number)=>a-b;':'function unused(){return 99}\nexport const add=(a:number,b:number)=>a+b;';writeFileSync(join(source,'app.ts'),initial);writeFileSync(join(source,'pin.ts'),'import {add} from "./app";const got=add(2,3);console.log("actual add(2,3)",got);if(got!==5)process.exit(1)');
  const entry=workflowCatalog().find(e=>e.name===name)!;const spec=parseWorkflow({id:id+'-'+name,project:source,trustedCode:true,paths:['app.ts','pin.ts'],write_scope:name==='investigation'?[]:['app.ts'],checks:[{id:'actual',executable:process.execPath,args:['pin.ts'],timeoutMs:15000,runner:'command',proof:{kind:'exit-code',reason:'Real app addition result'},input_scope:['pin.ts']}],task:name==='investigation'?'Explain addition implementation; cited how-shaped output and read-only checkpoint.':name==='bug-fix'?'Fix add(2,3) producing -1 instead of 5; app.ts only. Preserve pin.ts.':'Remove unused helper from app.ts; preserve every add behavior and frozen pin.ts. No new behavior.',kind:'catalog',workflow:{name,sha256:entry.sha256},rubric:['Requested local outcome','Actual frozen runtime proof','No out-of-scope changes'],budget:{deadline,maxCalls:name==='investigation'?3:7,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144}});
  const work=join(project,'work-'+name),result=await runCatalogWorkflow(spec,{store,base:snapshot(store,source,spec.paths),root:work,runtime:{agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider}});if(!result.localVerified)throw Error(name+' local protocol not verified: '+JSON.stringify(result));const workspace=join(work,readdirSync(work)[0]!),after=readFileSync(join(workspace,'app.ts'),'utf8');if(name==='investigation'?after!==initial:after===initial)throw Error(name+' actual artifact effect absent');if(readFileSync(join(source,'app.ts'),'utf8')!==initial)throw Error('Original app mutated');results.push({name,result,after});
 }
 const evidence={passed:true,id,results};writeFileSync(join(project,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){writeFileSync(join(project,'evidence.json'),JSON.stringify({passed:false,id,results,error:String(error)},null,2));throw error}finally{clearTimeout(watchdog);store.close();provider.close();admission.release()}
