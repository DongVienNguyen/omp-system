import { randomUUID } from 'node:crypto';
import { digest,type Check,type Review,type Certificate,type RuntimeProof,validateRuntimeProof } from './contracts';
import { Store } from './state';
import { verifiedEvidence,evidenceId,sealEvidence } from './evidence';
import { snapshot,type Snapshot } from './workspaces';
export interface GateInput {run?:string;generation?:string;candidate:string;base:string;policy:string;plan:string;requiredChecks:{id:string;commandDigest?:string;noTestsReason?:string;requiresObservation:boolean;runner?:'bun-test'|'command';proof?:RuntimeProof}[];paths:string[];checks:Check[];review:Review;pendingJobs:number;currentCandidate:()=>string;}
export function certify(store:Store,input:GateInput):Certificate{
 const {candidate,base,policy,plan,review}=input;
 const storedReview=verifiedEvidence<Review>(store,'review',review.id);if(digest(storedReview)!==digest(review))throw Error('Review differs from host-attested result');
 const runBinding=input.run?store.get<{run:string;generation:string}>('candidate-run',input.run+':'+candidate):undefined;
 if(input.run&&(!runBinding||runBinding.generation!==input.generation))throw Error('Candidate run/generation provenance missing');
 if(runBinding){const run=store.get<any>('run',runBinding.run);if(!run||run.cancelled||run.generation!==runBinding.generation)throw Error('Cancelled or superseded generation');if(store.list<any>('dispatch').some(d=>d.run===runBinding.run&&d.state!=='settled'))throw Error('Pending owned work');}
 const persisted=store.get<Snapshot>('snapshot',candidate);
 if(persisted&&snapshot(store,persisted.root,persisted.scope).id!==candidate){store.invalidate(candidate,'Candidate files changed');throw Error('Candidate changed on disk');}
 for(const h of [candidate,base,policy,plan])if(!/^[a-f0-9]{64}$/.test(h))throw Error('Invalid digest');
 if(input.currentCandidate()!==candidate)throw Error('Candidate changed');
 if(input.pendingJobs!==0)throw Error('Pending or unknown jobs');
 if(!input.requiredChecks.length)throw Error('Required checks absent');
 if(!review||review.status!=='complete'||!review.session||review.session===review.implementerSession)throw Error('Fresh completed independent review required');
 if(review.candidate!==candidate||review.base!==base||review.policy!==policy||review.plan!==plan)throw Error('Stale review');
 if(!Array.isArray(review.reviewed_paths)||input.paths.some(p=>!review.reviewed_paths.includes(p)))throw Error('Incomplete review coverage');
 if(!Array.isArray(review.findings)||review.findings.some(f=>!f.id||!f.evidence||typeof f.blocking!=='boolean'||typeof f.resolved!=='boolean'||(f.blocking&&!f.resolved)))throw Error('Unresolved or malformed finding');
 const evidenceIds:string[]=[];
 for(const required of input.requiredChecks){
  const evidence=input.checks.filter(c=>c.id===required.id);if(evidence.length!==1)throw Error('Missing or duplicate check '+required.id);const c=evidence[0]!;
  const attested=verifiedEvidence<Check & {runner:string;commandDigest:string;expectedTests:number|null}>(store,'check',evidenceId(candidate,c.id));
  if(attested.candidate!==c.candidate||attested.policy!==c.policy||attested.plan!==c.plan||attested.log!==c.log||attested.status!==c.status||attested.exitCode!==c.exitCode||attested.selectedTests!==c.selectedTests||attested.observation!==c.observation)throw Error('Check differs from host-attested execution');
  if((input.run&&!required.commandDigest)||(required.commandDigest&&required.commandDigest!==attested.commandDigest))throw Error('Execution command differs from frozen check-plan');
  const runner=required.runner??'bun-test';if(attested.runner!==runner)throw Error('Unrecognized test runner or runner policy mismatch');
  if(required.noTestsReason)throw Error('No-test bypass not supported without separately validated runtime-proof adapter');
  if(c.candidate!==candidate||c.policy!==policy||c.plan!==plan)throw Error('Stale check');
  if(c.status!=='passed'||c.exitCode!==0)throw Error('Check did not pass');
  if(runner==='command'){
   validateRuntimeProof(required.proof);validateRuntimeProof(attested.proof);if(!required.commandDigest||digest(required.proof)!==digest(attested.proof)||digest(c.proof??null)!==digest(attested.proof)||c.runner!=='command'||c.selectedTests!==null||!c.observation.trim())throw Error('Runtime command proof policy mismatch');
  }else{
   if(required.proof||attested.proof)throw Error('Bun test cannot use command proof');
   if(attested.expectedTests!==null&&attested.expectedTests!==c.selectedTests)throw Error('Selected test count mismatch');
   if(!Number.isInteger(c.selectedTests)||c.selectedTests!<=0)throw Error('Zero or unknown selected tests');
  }
  if(required.requiresObservation&&!c.observation?.trim())throw Error('Runtime observation missing');
  store.readArtifact(c.log);evidenceIds.push(evidenceId(candidate,c.id));
 }
 if(input.currentCandidate()!==candidate)throw Error('Candidate changed before certification');
 return store.db.transaction(()=>{if(input.run){const run=store.get<any>('run',input.run);if(!run||run.cancelled||run.generation!==input.generation)throw Error('Cancelled generation before publication')}
 const cert:Certificate={id:randomUUID(),run:input.run,generation:input.generation,candidate,base,policy,plan,review:review.id,checks:evidenceIds,scope:'LOCAL_VERIFIED',valid:true};store.put('review',review.id,review);sealEvidence(store,'certificate',cert.id,cert);store.put('certificate',cert.id,cert);return cert;})();
}
export function requireCertificate(store:Store,id:string,current:{candidate:string;base:string;policy:string;plan:string}):Certificate{
 const cert=store.get<Certificate>('certificate',id);if(!cert?.valid||(['candidate','base','policy','plan'] as const).some(k=>cert[k]!==current[k]))throw Error('No current valid certificate');
 const signed=verifiedEvidence<Certificate>(store,'certificate',id);if(digest(signed)!==digest(cert))throw Error('Certificate differs from host-attested publication');verifiedEvidence<Review>(store,'review',cert.review);
 for(const checkId of cert.checks){const check=verifiedEvidence<Check>(store,'check',checkId);if(check.candidate!==cert.candidate||check.policy!==cert.policy||check.plan!==cert.plan||check.status!=='passed'||check.exitCode!==0)throw Error('Certificate check evidence no longer valid');store.readArtifact(check.log)}
 if(cert.run){const run=store.get<any>('run',cert.run);if(!run||run.cancelled||run.generation!==cert.generation){store.put('certificate',cert.id,{...cert,valid:false,reason:'Run cancelled/superseded'});throw Error('Run no longer valid')}}
 const persisted=store.get<Snapshot>('snapshot',cert.candidate);if(persisted&&snapshot(store,persisted.root,persisted.scope).id!==cert.candidate){store.invalidate(cert.candidate,'Candidate mutated');throw Error('Candidate mutated')}
 return cert;
}
