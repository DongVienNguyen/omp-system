import {readFileSync,mkdirSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {getAgentDir} from '@oh-my-pi/pi-utils';
import {parseWorkflow} from './workflow-spec';import {Store} from './state';import {digest} from './contracts';import {verifiedEvidence} from './evidence';import {openProvider} from './provider';import {snapshot} from './workspaces';import {createMethodHost} from './pstack-host';import {runMethod} from './pstack';
import {RepositoryTaskAdapter} from './harness/repository-task';import {runMode,createSlots} from './harness/recursion';import {selectFinal,reflectAdoption} from './harness/selection';import {Library} from './harness/library';import {ModelBudget} from './model-budget';
import {runCatalogWorkflow,prepareCatalogWorkflow} from './catalog-method';
import {resolveActiveHarness} from './harness/active-policy';
import {materialise} from './harness/surfaces';
import {loadSourceEvidence,validateEvidenceCitations} from './source-evidence';
const [file,approval]=process.argv.slice(2);if(!file||!approval)throw Error('Workflow file and sealed operator approval required');const spec=parseWorkflow(JSON.parse(readFileSync(file,'utf8'))),project=realpathSync(spec.project);const agentDir=getAgentDir(),store=new Store(join(agentDir,'omp-system',digest(project)));
const auth=verifiedEvidence<any>(store,'authority',approval);if(auth.action!=='workflow'||auth.project!==project||auth.specDigest!==digest(spec)||auth.expires<=Date.now())throw Error('Workflow approval mismatch');
if(store.get('experiment',spec.id)||store.get('method-result',spec.id))throw Error('Workflow ID already exists');
if(spec.kind==='catalog')prepareCatalogWorkflow(spec);
const provider=await openProvider(agentDir);const work=join(store.directory,'experiments',spec.id);mkdirSync(work,{recursive:true});const base=snapshot(store,spec.project,spec.paths);
try{
 if(spec.kind==='pstack'){
  const packet=spec.sourceEvidence?loadSourceEvidence(store,spec.sourceEvidence,spec.project):undefined,evidence=packet?[{id:packet.id,role:'host-source',body:JSON.stringify(packet),evidence:[]}]:undefined;
  const task=spec.task+(packet?' Source anchors use [source:ID:ROW]; report every consulted source including nulls as [coverage:ID:STATUS]. No causal intent claim without captured source citation.':'');
  const host=createMethodHost({tokenLimits:spec.budget,store,base,root:work,task,readScope:spec.paths,writeScope:spec.write_scope,checks:spec.checks,runtime:{agentDir,...provider},maxCalls:spec.budget.maxCalls,deadline:spec.budget.deadline,trustedCode:true});const result=await runMethod(spec.method!,{task,candidates:spec.candidates,rubric:spec.rubric,verificationMode:spec.verificationMode,evidence},host);if(packet)validateEvidenceCitations(result.selected!.body,packet);store.put('method-result',spec.id,result);console.log(JSON.stringify(result));if(!result.verified)process.exitCode=1;
 }else if(spec.kind==='catalog'){
  const result=await runCatalogWorkflow(spec,{store,base,root:work,runtime:{agentDir,...provider}});console.log(JSON.stringify(result));if(!result.verified)process.exitCode=1;
 }else{
  const activeHarness=resolveActiveHarness(store,spec.project,spec.tree!,spec.approvals),baselineTree=activeHarness.tree;
  const initialRoot=join(work,'initial-harness');materialise(baselineTree,initialRoot,{executableCodeTrusted:true,approvals:spec.approvals});const initialPaths=Object.keys(baselineTree),initialSnapshot=snapshot(store,initialRoot,initialPaths),initialHarness={candidate:initialSnapshot.id,root:initialRoot,paths:initialPaths,treeDigest:digest(baselineTree),source:base.id};
  store.put('experiment',spec.id,{id:spec.id,project:spec.project,task:spec.task,source:base.id,activeHarness,initialHarness,state:'RUNNING',promotion:'NOT REQUESTED'});
  const modelBudget=new ModelBudget(spec.budget.maxCalls,spec.budget.deadline,1);const adapter=new RepositoryTaskAdapter(store,{tokenLimits:spec.budget,id:spec.id,task:spec.task,base,workspaceRoot:work,agentDir,outputPaths:spec.write_scope,writeScope:spec.write_scope,checks:spec.checks,trustedCode:true,approvals:spec.approvals,workerEnv:process.env,modelBudget,timeoutMs:Math.min(60000,Math.max(1,spec.budget.deadline-Date.now())),...provider});
  const slots=createSlots(1),baseRuns=[];for(let i=0;i<spec.k!;i++)baseRuns.push({...await adapter.rollout({taskId:spec.id,label:'base'+(i+1),tree:baselineTree}),label:'base'+(i+1)});
  let library:Library|undefined;if(spec.library)library=new Library(join(store.directory,'library'),{project:spec.project,...spec.library,mode:spec.mode!,k:spec.k!});
  const prior=library?await library.candidates():[];const result=await runMode({mode:spec.mode!,taskId:spec.id,task:spec.task,k:spec.k!,base:baseRuns,baseTree:baselineTree,library:prior,adapter,slots,budgets:{proposalWidth:1,rolloutWidth:1,transportAttempts:1,maxInvocations:spec.budget.maxCalls,maxRollouts:4*spec.k!}});
  const selection=await selectFinal({taskId:spec.id,task:spec.task,mode:spec.mode!,k:spec.k!,rollouts:result.rollouts,adapter,slots,transportAttempts:1});await reflectAdoption({selection,result,task:spec.task,baseTree:baselineTree,slots,transportAttempts:1,reflect:r=>adapter.reflect(r)});const learned=library?await library.add(selection,result):false;
  let selectedHarness;if(selection.ok){const tree=result.trees[selection.chosenLabel]??(selection.chosenIsBase?baselineTree:undefined);if(!tree)throw Error('Selected harness tree missing');const root=join(work,'selected-harness');materialise(tree,root,{executableCodeTrusted:true,approvals:spec.approvals});const paths=Object.keys(tree),selectedSnapshot=snapshot(store,root,paths);selectedHarness={candidate:selectedSnapshot.id,root,paths,treeDigest:digest(tree),source:base.id};}
  const record={id:spec.id,project:spec.project,task:spec.task,producerActor:'workflow:'+spec.id,method:result.mode,k:spec.k,source:base.id,activeHarness,initialHarness,selectedHarness,priorExperienceTasks:prior.map(c=>c.label),result,selection,learned,receipts:adapter.receipts,budget:modelBudget.status(),promotion:'NOT REQUESTED'};store.put('experiment',spec.id,record);console.log(JSON.stringify(record));if(!selection.ok)process.exitCode=1;
 }
}finally{provider.close();store.close()}
