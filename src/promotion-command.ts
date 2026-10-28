import {isAbsolute} from 'node:path';
import {digest,type Certificate,type Command} from './contracts';
import {requireCertificate} from './gate';
import {Store} from './state';
import {approvePromotion,freezeRegression,executeFrozenRegression,promote,rollbackPromotion,type FrozenRegressionProof} from './promotion';
import {certifiedHarnessTree} from './harness/active-policy';
import {contained} from './contracts';
import type {ExecutableApproval} from './harness/executable-authority';

/** Operator-only file command. Never register as a model tool. */
export async function executePromotionCommand(store:Store,currentProject:string,value:unknown,operatorConfirmed:boolean):Promise<unknown>{
 if(!operatorConfirmed)throw Error('Promotion operator approval required');
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Promotion command object required');
 const v=value as Record<string,unknown>;
 if(v.project!==currentProject||!isAbsolute(currentProject))throw Error('Promotion command project mismatch');
 const fields=v.op==='freeze'?['op','project','experiment','certificate','suite','commands']:v.op==='promote'?['op','project','experiment','certificate','frozenRegression','expectedActive']:v.op==='rollback'?['op','project','expectedActive']:[];
 if(!fields.length||Object.keys(v).some(k=>k!=='approvals'&&!fields.includes(k))||fields.some(k=>v[k]===undefined))throw Error('Invalid promotion command fields');
 const approvals=v.approvals as ExecutableApproval[]|undefined;if(approvals!==undefined&&(!Array.isArray(approvals)||approvals.some(a=>!a||Object.keys(a).some(k=>!['path','sha256','expires','purpose'].includes(k))||typeof a.path!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.expires)||a.expires<=Date.now()||a.purpose!=='harness-surface')))throw Error('Invalid executable surface approvals');
 if(v.op==='rollback'){
  if(typeof v.expectedActive!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedActive))throw Error('Expected active candidate required');
  const authority=approvePromotion(store,{action:'rollback',project:currentProject,candidate:v.expectedActive,expires:Date.now()+60000},true);
  return rollbackPromotion(store,currentProject,v.expectedActive,authority.id);
 }
 if(typeof v.certificate!=='string'||typeof v.experiment!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.experiment))throw Error('Certificate and experiment required');
 const cert=store.get<Certificate>('certificate',v.certificate);if(!cert)throw Error('Promotion certificate missing');requireCertificate(store,cert.id,cert);
 certifiedHarnessTree(store,cert.candidate,cert.id,approvals);
 const experiment=store.get<{project:string;selectedHarness?:{candidate:string}}>('experiment',v.experiment);if(experiment&&(experiment.project!==currentProject||experiment.selectedHarness?.candidate!==cert.candidate))throw Error('Workflow selected harness provenance mismatch');
 if(v.op==='freeze'){
  if(!v.suite||typeof v.suite!=='object'||Array.isArray(v.suite)||Object.keys(v.suite).some(k=>!['root','paths'].includes(k)))throw Error('Frozen suite required');
  const suite=v.suite as Record<string,unknown>;
  if(typeof suite.root!=='string'||!isAbsolute(suite.root)||!Array.isArray(suite.paths)||suite.paths.some(p=>typeof p!=='string'))throw Error('Frozen suite scope invalid');
  if(!contained(currentProject,suite.root))throw Error('Frozen suite outside project');
  if(store.get('regression',v.experiment))throw Error('Regression ID already exists');
  if(!Array.isArray(v.commands)||!v.commands.length)throw Error('Frozen commands required');
  for(const raw of v.commands){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid frozen command');const c=raw as Record<string,unknown>;if(Object.keys(c).some(k=>!['id','executable','args','cwd','timeoutMs','testCount'].includes(k))||typeof c.id!=='string'||typeof c.executable!=='string'||!isAbsolute(c.executable)||typeof c.cwd!=='string'||!isAbsolute(c.cwd)||!Array.isArray(c.args)||c.args.some(a=>typeof a!=='string')||typeof c.timeoutMs!=='number'||typeof c.testCount!=='number')throw Error('Invalid frozen command fields')}
  // Each command field validated above; freezeRegression validates counts, IDs, scope and bindings.
  const commands=v.commands as Command[],paths=suite.paths as string[];
  const proof=freezeRegression(store,{project:currentProject,experiment:v.experiment,candidate:cert.candidate,base:cert.base,policy:cert.policy,plan:cert.plan,suite:{root:suite.root,paths},commands},true);
  const result=await executeFrozenRegression(store,proof.digest,{trustedCode:true,root:currentProject});
  store.put('regression',v.experiment,{candidate:cert.candidate,regressionDigest:proof.digest,certificate:cert.id,project:currentProject,proof:result});return result;
 }
 const proof=v.frozenRegression;if(!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).some(k=>!['digest','evidence'].includes(k)))throw Error('Frozen regression proof required');
 const p=proof as Record<string,unknown>;if(typeof p.digest!=='string'||!Array.isArray(p.evidence)||p.evidence.some(id=>typeof id!=='string')||typeof v.expectedActive!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedActive))throw Error('Invalid promotion proof');
 const authority=approvePromotion(store,{action:'promote',project:currentProject,candidate:cert.candidate,expires:Date.now()+60000},true);
 const frozenRegression:FrozenRegressionProof={digest:p.digest,evidence:p.evidence as string[]};
 const result=store.db.transaction(()=>{
  const active=store.get<{candidate:string;certificate?:string}>('policy',currentProject);
  if(active){if(!active.certificate)throw Error('Active baseline certificate missing');certifiedHarnessTree(store,active.candidate,active.certificate,approvals)}
  else{const baseline=store.list<Certificate>('certificate').find(c=>c.valid&&c.candidate===cert.base);if(!baseline)throw Error('Certified initial harness baseline required');certifiedHarnessTree(store,baseline.candidate,baseline.id,approvals);store.put('policy',currentProject,{candidate:baseline.candidate,certificate:baseline.id})}
  return promote(store,{project:currentProject,experiment:v.experiment as string,candidate:cert.candidate,base:cert.base,policy:cert.policy,plan:cert.plan,certificate:cert.id,authority:authority.id,frozenRegression,expectedActive:v.expectedActive as string});
 })();
 store.put('promotion-result',digest({project:currentProject,experiment:v.experiment,candidate:cert.candidate,at:result.at}),result);return result;
}
