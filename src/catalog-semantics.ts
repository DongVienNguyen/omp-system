import {runMethod,type MethodHost,type MethodArtifact,type PstackMethod} from './pstack';
import type {Check} from './contracts';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import type {Store} from './state';
import {Coordinator,type RunSpec} from './coordinator';
import {removeWorktree} from './git-worktrees';
import {snapshot} from './workspaces';
import {safeRelative} from './contracts';
import {validateTraceRequest,runTraceForensics,type TraceRequest} from './trace-forensics';
import {validateRuntimeForensics,runRuntimeForensics,type RuntimeForensicsRequest} from './runtime-forensics';
import {validateVisualRequest,runVisualParity,type VisualRequest} from './visual-parity';
import {validateSessionPickup,runSessionPickup,type SessionPickupRequest} from './session-pickup';
import {validateFormalRequest,runFormalVerification,type FormalRequest} from './formal-verification';
import {validateVideoRequest,runEvidenceVideo,type VideoRequest} from './media-video';
import {parseMediaCatchup,runMediaCatchup,type MediaCatchupRequest} from './media-catchup';
export interface PlaybookDisposition {route?:PstackMethod;verification:string;prerequisites:string[];local:boolean;runtimeInvocation?:string;boundedAdapter?:boolean;}
// Requirements describe pinned playbooks, not advertised prompt compatibility.
export const playbookSemantics:Record<string,PlaybookDisposition>={
 investigation:{route:'how',local:true,verification:'Read-only cited how output; frozen source unchanged; actual supplied checks pass',prerequisites:[]},
 'bug-fix':{route:'how',local:true,verification:'Actual same-surface failing repro before writes; mechanism grounded; original frozen repro passes after each accepted fix',prerequisites:['Ordered failing-repro/fix commits and Opening a PR require separately authorized delivery']},
 refactoring:{route:'how',local:true,verification:'Actual characterization/equivalence passes before structure moves and after every bounded edit; immutable pin; no behavior change',prerequisites:['Ordered commits and Opening a PR require separately authorized delivery']},
 feature:{route:'architect',local:false,verification:'Ground with how; parallel architecture; throughput checkpoint; isolated delegated implementation; matching-surface proof; contested choices interrogated',prerequisites:['Configured feature worker resolution and complete PR lifecycle adapter']},
 'authoring-a-skill':{local:false,verification:'Packaged authoring guide; frontmatter, reference and cross-skill validation; structural tests; Opening a PR',prerequisites:['Pinned installed ak-skill-creator validator digest, frozen consumer command and native skill writer scope; PR requires separate delivery authority']},
 'autonomous-run':{local:false,verification:'Frozen exit predicate; verify every iteration; keep/revert evidence and checkpoints; native wake until predicate',prerequisites:['Approved bounded standing units, frozen predicate and native wake; advancing commits/reverts and full forge loop not supplied by standing adapter']},
 'autopilot-full':{local:false,verification:'One PR owner; independent swarm at exact patch; CI, fresh rebase, patch-id and merge-tree gates; countersigns',prerequisites:['Explicit operator go/merge authority, forge, native owners, swarm, audit sentinel']},
 'autopilot-stack':{local:false,verification:'Autopilot-full proof without merge; one root topology writer; patch-id revalidation; linear verified stack',prerequisites:['Forge, native owners/swarm, audit sentinel and explicit stack topology authority']},
 babysit:{local:false,verification:'Declared mode; one frontier; conflicts then threads then CI; forge merge-ready verdict; no merge',prerequisites:['Authenticated forge watcher, review threads and exact remote head evidence']},
 eval:{route:'arena',local:false,verification:'Sanitized independent environments; organic candidate prompt; hidden rubric; different-family blind judge; transcript audit',prerequisites:['Blinded multi-model dispatch and workspace-scoped transcript reader']},
 hillclimb:{local:false,verification:'Sensitive frozen benchmark; target and attempt floor; one hypothesis; before/after metric and regression gate; keep/revert log',prerequisites:['Metric/noise parser, sensitive workload evidence and transactional keep/revert adapter']},
 'multi-phase-plan':{route:'architect',local:false,verification:'Prototype unresolved questions; exact plan skeleton; packaged check-plan; unit/live/perf boxes; explicit go gate',prerequisites:['Packaged plan checker execution and prototype evidence/specified live verification lanes']},
 'opening-a-pr':{route:'interrogate',local:false,verification:'Isolated checkout; documentation gate; ordered commits; deslop/no-comments; ready PR observed on resolved forge',prerequisites:['Explicit publishing authority and authenticated forge/PR adapter']},
 orchestrate:{local:false,verification:'Standing orders in every brief; durable queue/inbox/frontier/ledger; independent verifiers and supervised owners',prerequisites:['Native persistent task/inbox and forge frontier lifecycle; no second controller allowed']},
 'pause-safely':{local:false,verification:'Owned jobs settled; atomic boundary; durable WIP commit and resume note; no new push/PR',prerequisites:['Owned native job cancellation/settlement and scoped WIP commit authority']},
 'perf-issue':{route:'how',local:false,verification:'Matching-surface baseline and post-fix trace; benchmark-checklist; parsed comparison and actual regression proof',prerequisites:['Live trace capture and measurement comparison adapter']},
 prototype:{route:'arena',local:false,verification:'Isolated throwaway variants; observed timing/output or screenshots; decision and tradeoffs; no production build',prerequisites:['Approved catalog-local prototype with frozen checks; browser surface requires explicit browser entry, executable and per-variant interactions; native surface remains blocked']},
 'runtime-forensics':{route:'how',local:false,verification:'Live CPU/heap/CDP signal; reduced smoking gun; instrument running process to prove mechanism; source attribution',prerequisites:['Live process/CDP profiler, instrumentation authority and trace parser']},
 'session-pickup':{local:false,verification:'Read scoped prior trail; reconstruct operational state without repeating completed repro; verify inherited artifact and route',prerequisites:['Workspace-scoped native session history/archive and inherited artifact provenance']},
 shipping:{local:false,verification:'Explicit landing grant; forge gates, exact head/patch identity, stack retarget and merge evidence',prerequisites:['Explicit shipping authority and authenticated forge/merge lifecycle']},
 'trace-forensics':{route:'how',local:false,verification:'Existing capture parsed to queryable form; hot path/retainer attribution; paired diff or explicit hypothesis',prerequisites:['Format-aware trace-to-query parser and source symbols; no capture rerun']},
 'visual-parity':{local:false,verification:'Immutable pre-migration screenshot baseline; component-wise zero pixel diff on matching surface',prerequisites:['Approved visual-baseline then visual-compare operator requests, matching browser executable and declared component/state baseline custody; simulator parity not supplied']},
 'worktree-cleanup':{local:false,verification:'Audit git-listed paths; explicit owned targets; active/pinned chat and ignored/WIP review; irreversible approval; before/after disk and relist',prerequisites:['Explicit per-worktree owned deletion authority, pinned/active chat evidence, WIP/ignored artifact decisions and audit tool; generic write_scope never grants deletion']}
};
// Available routes are bounded entry points, never observed PASS or full pinned parity.
export const catalogRuntimeRoutes:Record<string,string>={
 investigation:'/omp-system workflow <spec>; kind=catalog, workflow.name=investigation',
 'bug-fix':'/omp-system workflow <spec>; kind=catalog, workflow.name=bug-fix',
 refactoring:'/omp-system workflow <spec>; kind=catalog, workflow.name=refactoring',
 ...Object.fromEntries(['feature','authoring-a-skill','multi-phase-plan','hillclimb','eval','perf-issue','prototype','create-formal-verification-skill','maintain-formal-verification-skill'].map(name=>[name,`/omp-system catalog-local <spec>; workflow.name=${name}, operation.kind=${name}`])),
 'autonomous-run':'/omp-system standing <spec>; resume: /omp-system standing-resume <spec>; cancel: /omp-system standing-cancel <id>',
 'trace-forensics':'/omp-system catalog-operator <spec>; action=trace',
 'runtime-forensics':'/omp-system catalog-operator <spec>; action=runtime-forensics',
 'session-pickup':'/omp-system catalog-operator <spec>; action=session-history (native history) or action=pickup (stored run)',
 'visual-parity':'/omp-system catalog-operator <spec>; action=visual-baseline then action=visual-compare',
 'pause-safely':'/omp-system catalog-operator <spec>; action=pause',
 'worktree-cleanup':'/omp-system catalog-operator <spec>; action=cleanup',
 'ketchup-video':'/omp-system catalog-operator <spec>; action=media-catchup'
};
export function disposition(name:string){
 const specializedPrerequisites:Record<string,string[]>={
  'create-formal-verification-skill':['Approved catalog-local formal operation; read-only real source coverage, frozen verifier/property ID, bounded assumptions and broken-source sensitivity; native skill placement and cold-reader evidence required'],
  'maintain-formal-verification-skill':['Approved catalog-local formal operation; existing coverage/sync history, frozen verifier/property ID, drift classification and cold-reader evidence; product writes forbidden'],
  'ketchup-video':['Approved media-catchup operator; same-workspace native history, frozen last-user window and calls, source artifacts, renderer and rendered frame/hold review']
 };
 const semantic=playbookSemantics[name]??{local:false,verification:'Pinned guidance only; task-specific semantic acceptance required',prerequisites:specializedPrerequisites[name]??['Dedicated semantic protocol evidence required']};
 return {...semantic,runtimeInvocation:catalogRuntimeRoutes[name],boundedAdapter:!!catalogRuntimeRoutes[name]};
}
export interface SemanticProof {phase:string;checks:Check[];}
export function assertSemanticChecks(checks:Check[],expected:'passed'|'failed'){
 if(!checks.length)throw Error('Actual semantic checks required');
 if(expected==='failed'){if(!checks.some(c=>c.status==='failed'&&c.exitCode!==null&&c.exitCode!==0&&c.observation.trim()))throw Error('Bug fix requires actual failing repro before edit');if(checks.some(c=>c.status==='cancelled'||c.status==='timed_out'))throw Error('Inconclusive pre-check is not reproduction');}
 else if(checks.some(c=>c.status!=='passed'||c.exitCode!==0||!c.observation.trim()))throw Error('Actual characterization/after checks must be green');
}
/** Uses existing single-owner MethodHost. check executes frozen commands on this same workspace. */
export function validateInvestigation(body:string,artifacts:MethodArtifact[],lineCounts:Map<string,number>){
 for(const heading of ['Overview','Key Concepts','How It Works','Where Things Live','Gotchas'])if(!body.includes(heading))throw Error('Investigation missing section: '+heading);
 if(!/checkpoint[^\n]*read.only/i.test(body))throw Error('Investigation read-only checkpoint missing');
 const reads=new Set(artifacts.flatMap(a=>a.actualReads??[])),citations=[...body.matchAll(/(?:`|\b)([A-Za-z0-9_./-]+):([0-9]+)(?:-[0-9]+)?/g)];if(!citations.length)throw Error('Investigation requires actual file:line citations');
 for(const c of citations){const path=c[1]!,line=Number(c[2]);if(!reads.has(path)||!lineCounts.has(path)||line<1||line>lineCounts.get(path)!)throw Error('Investigation citation lacks actual scoped read: '+path+':'+line)}
}
export function validateSemanticReview(body:string){
 const value:unknown=JSON.parse(body);if(!value||typeof value!=='object'||Array.isArray(value)||!('findings' in value)||!Array.isArray(value.findings))throw Error('Structured independent findings required');
 for(const f of value.findings){if(!f||typeof f!=='object'||typeof f.blocking!=='boolean'||typeof f.resolved!=='boolean'||typeof f.evidence!=='string'||!f.evidence.trim())throw Error('Invalid independent finding');if(f.blocking&&!f.resolved)throw Error('Unresolved blocking semantic finding: '+f.evidence)}
}
export async function executeLocalProtocol(name:string,task:string,rubric:string[],host:MethodHost,check:(phase:string)=>Promise<Check[]>,maxSteps:number,boundaryChange=false){
 const artifacts:MethodArtifact[]=[],proofs:SemanticProof[]=[];const d=disposition(name);
 if(!d.local)throw Error('Semantic capabilities unavailable: '+d.prerequisites.join('; '));
 const checkPhase=async(phase:string,expected:'passed'|'failed')=>{const checks=await check(phase);proofs.push({phase,checks});assertSemanticChecks(checks,expected);artifacts.push({id:phase,role:'host-check',body:JSON.stringify({phase,checks}),evidence:checks.map(c=>c.log)})};
 if(name==='bug-fix')await checkPhase('reproduce-before-edit','failed');
 else await checkPhase(name==='refactoring'?'characterize-before-edit':'read-only-baseline','passed');
 // Analysis executes actual checks but does not convert a reproduced failure into a pass.
 const ground=await runMethod('how',{task:task+' Frozen runtime baseline: '+JSON.stringify(proofs),rubric},host);artifacts.push(...ground.artifacts);
 if(name==='investigation')return {artifacts,selected:ground.selected!,proofs,localVerified:ground.verified};
 if(boundaryChange){const design=await runMethod('architect',{task,rubric,candidates:2},host);artifacts.push(...design.artifacts)}
 let selected=ground.selected!;
 for(let step=1;step<=maxSteps;step++){
  selected=await host.run('semantic-edit-'+step,'Perform ONE smallest '+name+' step on existing workspace. Hold frozen checks unchanged. Use evidence and design. Return JSON object {"complete":boolean,"summary":string}; complete only when requested local change finished. Do not commit, publish, delegate or claim unavailable delivery.',[...artifacts],{readOnly:false,workspace:await host.workspace('semantic-shared')});artifacts.push(selected);
  await checkPhase('green-step-'+step,'passed');
  let body:{complete?:unknown};try{body=JSON.parse(selected.body)}catch{throw Error('Semantic edit requires completion protocol JSON')}
  if(body.complete===true){const review=await runMethod('interrogate',{task:task+' Review completed '+name+' against baseline and actual check evidence. No auto-fix.',rubric,evidence:artifacts.filter(a=>a.role==='host-check')},host);artifacts.push(...review.artifacts);for(const report of review.artifacts){validateSemanticReview(report.body);if(report.role!=='lead-judgment'&&!report.actualReads?.length)throw Error('Independent semantic review lacks actual file reads')}return {artifacts,selected,proofs,localVerified:review.verified};}
  if(body.complete!==false)throw Error('Semantic completion must be boolean');
 }
 throw Error('Semantic stage budget exhausted before completion');
}

export const playbookOperators={
 investigation:['pstack.runMethod:how','checks.executeCheck'],
 'bug-fix':['pstack.runMethod:how','catalog-semantics.executeLocalProtocol','delivery.prepareDeliveryBranch'],
 refactoring:['pstack.runMethod:how','catalog-semantics.executeLocalProtocol','delivery.prepareDeliveryBranch'],
 feature:['pstack.runMethod:architect','Coordinator.run','gate.certify','deliveryCommand'],
 'authoring-a-skill':['catalog-semantics.executeLocalProtocol','checks.executeCheck','deliveryCommand'],
 'autonomous-run':['Coordinator.run','Coordinator.continue','resume.validateContinuation'],
 'autopilot-full':['Coordinator.run','delivery.reconcileGitHubDelivery','deliveryCommand'],
 'autopilot-stack':['Coordinator.run','delivery.prepareDeliveryBranch','delivery.reconcileGitHubDelivery'],
 babysit:['delivery.reconcileGitHubDelivery','Coordinator.repair'],
 eval:['pstack.runMethod:arena','harness.runMethod'],
 hillclimb:['checks.executeCheck','workspaces.snapshot','workspaces.materialize','Coordinator.run'],
 'multi-phase-plan':['pstack.runMethod:architect','checks.executeCheck'],
 'opening-a-pr':['pstack.runMethod:interrogate','deliveryCommand'],
 orchestrate:['Coordinator.run','Coordinator.continue','Coordinator.status'],
 'pause-safely':['Coordinator.cancel','Store.artifact','catalog-semantics.runCatalogOperator'],
 'perf-issue':['pstack.runMethod:how','checks.executeCheck','Coordinator.run'],
 prototype:['pstack.runMethod:arena','workspaces.materialize','checks.executeCheck'],
 'runtime-forensics':['runtime-forensics.runRuntimeForensics','trace-forensics.runTraceForensics','catalog-semantics.runCatalogOperator'],
 'session-pickup':['session-pickup.runSessionPickup','Store.events','Store.readArtifact','catalog-semantics.runCatalogOperator'],
 shipping:['deliveryCommand','delivery.reconcileGitHubDelivery'],
 'trace-forensics':['trace-forensics.runTraceForensics','catalog-semantics.runCatalogOperator'],
 'visual-parity':['visual-parity.runVisualParity','catalog-semantics.runCatalogOperator'],
 'worktree-cleanup':['git-worktrees.removeWorktree','catalog-semantics.runCatalogOperator']
} as const;
/** Parent routes these actions through its existing controller; this never creates a scheduler. */
export function catalogAcceptance(name:string){const d=disposition(name),operators=playbookOperators[name as keyof typeof playbookOperators]??[];return {name,operators,acceptance:[{id:name+':protocol',requirement:d.verification},{id:name+':authority',requirement:d.prerequisites.join('; ')||'Declared read scope; no mutation authority'}],local:d.local};}
type OwnedTree=Parameters<typeof removeWorktree>[0];
export type CatalogOperatorRequest=
 |TraceRequest
 |RuntimeForensicsRequest
 |VisualRequest
 |SessionPickupRequest
 |FormalRequest
 |VideoRequest
 |MediaCatchupRequest
 |{action:'pickup';run:string;project:string}
 |{action:'pause';run:string;project:string;paths:string[];deadline:number;commit?:{approved:true;message:string}}
 |{action:'cleanup';record:OwnedTree;workspaceRoot:string;authority:{approved:true;destination:string;ownerId:string;inactive:true;pinned:false;ignoredArtifacts:'none'}};
export function validateCatalogOperator(value:unknown,project:string):CatalogOperatorRequest{
 const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const exact=(v:Record<string,unknown>,keys:string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))throw Error('Unknown catalog operator field')};
 const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
 if(!object(value))throw Error('Catalog operator object required');const v=value;
 if(v.action==='trace')return validateTraceRequest(v,project);
 if(v.action==='runtime-forensics')return validateRuntimeForensics(v,project);
 if(v.action==='visual-baseline'||v.action==='visual-compare')return validateVisualRequest(v,project);
 if(v.action==='session-history')return validateSessionPickup(v,project);
 if(v.action==='formal-check')return validateFormalRequest(v,project);
 if(v.action==='evidence-video')return validateVideoRequest(v,project);
 if(v.action==='media-catchup')return parseMediaCatchup(v,project);
 if(v.action==='pickup'||v.action==='pause'){exact(v,v.action==='pickup'?['action','run','project']:['action','run','project','paths','deadline','commit']);if(!text(v.run)||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.run)||!text(v.project)||resolve(v.project)!==resolve(project))throw Error('Same-workspace operator identity required');
  if(v.action==='pause'){if(!Array.isArray(v.paths)||!v.paths.length||v.paths.some(p=>typeof p!=='string'))throw Error('Explicit pause paths required');v.paths.forEach(p=>safeRelative(p));if(typeof v.deadline!=='number'||!Number.isSafeInteger(v.deadline)||v.deadline<=Date.now())throw Error('Bounded pause deadline required');if(v.commit!==undefined){if(!object(v.commit))throw Error('WIP authority required');exact(v.commit,['approved','message']);if(v.commit.approved!==true||!text(v.commit.message)||!v.commit.message.startsWith('wip:'))throw Error('Explicit wip: commit authority required')}}
 }else if(v.action==='cleanup'){exact(v,['action','record','workspaceRoot','authority']);if(!object(v.record)||!object(v.authority)||!text(v.workspaceRoot))throw Error('Owned cleanup record required');exact(v.record,['owner','id','repository','destination','base']);exact(v.authority,['approved','destination','ownerId','inactive','pinned','ignoredArtifacts']);for(const k of ['owner','id','repository','destination','base'])if(!text(v.record[k]))throw Error('Owned cleanup identity required');if(resolve(v.record.repository as string)!==resolve(project)||v.record.owner!=='omp-system/worktree-v1'||v.authority.approved!==true||v.authority.inactive!==true||v.authority.pinned!==false||v.authority.ignoredArtifacts!=='none'||v.authority.destination!==v.record.destination||v.authority.ownerId!==v.record.id)throw Error('Explicit owned deletion authority required');
 }else throw Error('Catalog operator action invalid');
 // Every union member validated above; no worker-provided object reaches this boundary.
 return v as CatalogOperatorRequest;
}
export async function runCatalogOperator(request:CatalogOperatorRequest,context:{store:Store;coordinator:Coordinator}){
 const {store,coordinator}=context;
 if(request.action==='trace')return runTraceForensics(request,store,request.project);
 if(request.action==='runtime-forensics')return runRuntimeForensics(request,store,request.project);
 if(request.action==='visual-baseline'||request.action==='visual-compare')return runVisualParity(request,store,request.project);
 if(request.action==='session-history')return runSessionPickup(request,store,request.project);
 if(request.action==='formal-check')return runFormalVerification(request,store,request.project);
 if(request.action==='evidence-video')return runEvidenceVideo(request,store,request.project);
 if(request.action==='media-catchup')return runMediaCatchup(request,store,request.project);
 if(request.action==='cleanup'){
  const {authority,record}=request;if(authority.approved!==true||authority.inactive!==true||authority.pinned!==false||authority.ignoredArtifacts!=='none'||resolve(authority.destination)!==resolve(record.destination)||authority.ownerId!==record.id)throw Error('Explicit owned inactive/unpinned cleanup authority required');
  const audit=spawnSync('git',['-C',record.destination,'status','--porcelain=v1','--untracked-files=all','--ignored'],{encoding:'utf8',timeout:10000});if(audit.status!==0||audit.stdout.trim())throw Error('Worktree WIP/untracked/ignored artifacts retained');
  removeWorktree(record,request.workspaceRoot);const proof={action:'cleanup',record,authority,removed:!existsSync(record.destination),at:Date.now()};if(!proof.removed)throw Error('Owned worktree removal not observed');store.put('catalog-operator',record.id,proof);return proof;
 }
 const saved=store.get<RunSpec>('run-spec',request.run);if(!saved||resolve(saved.project)!==resolve(request.project))throw Error('Same-workspace run provenance required');
 if(request.action==='pickup'){
  const events=store.db.query<{seq:number;kind:string;id:string;at:number;body:string},[string,string,string]>('SELECT seq,kind,id,at,body FROM events WHERE id=? OR substr(id,1,length(?))=? ORDER BY seq').all(request.run,request.run+':',request.run+':');
  const status=coordinator.status(request.run),checkpoint=store.get<{artifact:string}>('catalog-checkpoint',request.run);const note=checkpoint?store.readArtifact(checkpoint.artifact).toString('utf8'):undefined;
  return {action:'pickup',run:request.run,status,events,note,reexecuted:false,route:store.get<{cancelled?:boolean}>('run',request.run)?.cancelled?'fork':status.tasks.find(t=>t.state==='BLOCKED')?'repair':'continue'};
 }
 if(!Number.isSafeInteger(request.deadline)||request.deadline<=Date.now())throw Error('Bounded pause deadline required');
 coordinator.cancel(request.run);
 while(coordinator.status(request.run).dispatches.some(d=>d.state!=='settled')){if(Date.now()>=request.deadline)throw Error('Owned dispatch settlement incomplete; checkpoint cannot certify pause');await delay(25)}
 const current=snapshot(store,request.project,request.paths);let commit:string|undefined;
 if(request.commit){if(request.commit.approved!==true||!request.commit.message.startsWith('wip:')||!request.paths.length)throw Error('Explicit WIP commit authority required');const run=(args:string[])=>{const result=spawnSync('git',['-c','core.hooksPath='+join(store.directory,'disabled-hooks'),'-C',request.project,...args],{encoding:'utf8',timeout:10000});if(result.status!==0)throw Error('WIP commit failed: '+result.stderr);return result.stdout.trim()};if(run(['diff','--cached','--name-only']))throw Error('Foreign staged edits retained');run(['add','--',...request.paths]);run(['commit','-m',request.commit.message]);commit=run(['rev-parse','HEAD'])}
 const note={action:'pause',run:request.run,snapshot:current.id,status:coordinator.status(request.run),commit,at:Date.now()},artifact=store.artifact(JSON.stringify(note));store.put('catalog-checkpoint',request.run,{artifact,snapshot:current.id,commit});return {...note,artifact};
}
