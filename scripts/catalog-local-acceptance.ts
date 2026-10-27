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
const admission=await admitResources(root,true),id='catalog-current-'+randomUUID(),project=join(root,'.lab','workspaces',id);mkdirSync(project,{recursive:true});const store=new Store(join(root,'.lab','state',id)),provider=await openProvider(join(profileRoot('omp-system-dev'),'agent')),results:unknown[]=[],globalDeadline=Date.now()+480000;
const save=(passed:boolean,error?:string)=>writeFileSync(join(project,'evidence.json'),JSON.stringify({passed,id,results,error},null,2));
const timer=setTimeout(()=>{save(false,'Global480s deadline');store.close();provider.close();admission.release();process.exit(1)},480000);
try{
 for(const name of ['bug-fix','refactoring']){
  const source=join(project,name);mkdirSync(source);const initial=name==='bug-fix'?'export const add=(a:number,b:number)=>a-b;':'function unused(){return 99}\nexport const add=(a:number,b:number)=>a+b;';writeFileSync(join(source,'app.ts'),initial);writeFileSync(join(source,'pin.ts'),'import {add} from "./app";const got=add(2,3);console.log("actual add(2,3)",got);if(got!==5)process.exit(1)');
  const entry=workflowCatalog().find(e=>e.name===name)!;const spec=parseWorkflow({id:id+'-'+name,project:source,trustedCode:true,paths:['app.ts','pin.ts'],write_scope:['app.ts'],checks:[{id:'actual',executable:process.execPath,args:['pin.ts'],timeoutMs:15000,runner:'command',proof:{kind:'exit-code',reason:'Actual app addition'},input_scope:['pin.ts']}],task:name==='bug-fix'?'Fix subtraction typo in app.ts add: 2+3 must equal5. One local function. Preserve pin.ts.':'Delete unused helper from app.ts only. Preserve add behavior and pin.ts. One local function.',kind:'catalog',workflow:{name,sha256:entry.sha256,boundaryChange:false},rubric:['Requested tiny change','Actual frozen app proof','Scope held'],budget:{deadline:Math.min(globalDeadline,Date.now()+240000),maxCalls:28,max_output_tokens:16384,max_input_bytes:1048576,max_output_bytes:262144}});
  const work=join(project,'work-'+name),result=await runCatalogWorkflow(spec,{store,base:snapshot(store,source,spec.paths),root:work,runtime:{agentDir:join(profileRoot('omp-system-dev'),'agent'),...provider}});if(!result.localVerified)throw Error(name+' local protocol failed: '+JSON.stringify(result));const after=readFileSync(join(work,readdirSync(work)[0]!,'app.ts'),'utf8');if(after===initial||(name==='refactoring'&&after.includes('unused')))throw Error(name+' actual effect absent');if(readFileSync(join(source,'app.ts'),'utf8')!==initial)throw Error('Original changed');results.push({name,result,after});save(false,'Acceptance still running');
 }
 save(true);console.log(JSON.stringify({passed:true,id,evidence:join(project,'evidence.json')}));
}catch(error){save(false,String(error));throw error}finally{clearTimeout(timer);store.close();provider.close();admission.release()}
