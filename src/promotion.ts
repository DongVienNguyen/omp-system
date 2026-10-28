import { Store } from './state';
import { randomUUID } from 'node:crypto';
import { requireCertificate } from './gate';
import { verifiedEvidence,evidenceId,sealEvidence } from './evidence';
import { digest,nonempty,type Command,type Check } from './contracts';
import { commandIdentity } from './command-identity';
import { executeCheck } from './checks';
import { snapshot,type Snapshot } from './workspaces';
export interface FrozenRegressionInput {project:string;experiment:string;candidate:string;base:string;policy:string;plan:string;suite:{root:string;paths:string[]};commands:Command[];}
export interface FrozenRegressionProof {digest:string;evidence:string[];}
interface FrozenRegression extends FrozenRegressionInput {kind:'frozen-regression';suiteSnapshot:Snapshot;requiredChecks:{id:string;commandDigest:string;expectedTests:number}[];}
function currentCandidate(store:Store,candidate:string){const saved=store.get<Snapshot>('snapshot',candidate);if(!saved||snapshot(store,saved.root,saved.scope).id!==candidate)throw Error('Frozen regression candidate mutated or missing')}
/** Host-only freeze after operator approval; never expose Store/signing to candidates. */
export function freezeRegression(store:Store,input:FrozenRegressionInput,operatorConfirmed:boolean):FrozenRegressionProof{
 if(!operatorConfirmed)throw Error('Frozen regression operator approval required');
 nonempty(input.project,'project');nonempty(input.experiment,'experiment');
 for(const value of [input.candidate,input.base,input.policy,input.plan])if(!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid frozen regression binding');
 if(!Array.isArray(input.commands)||!input.commands.length||new Set(input.commands.map(c=>c.id)).size!==input.commands.length)throw Error('Required regression commands missing/duplicate');
 for(const command of input.commands){nonempty(command.id,'check id');nonempty(command.executable,'executable');nonempty(command.cwd,'cwd');if(!Array.isArray(command.args)||command.args.some(a=>typeof a!=='string')||!Number.isSafeInteger(command.timeoutMs)||command.timeoutMs<=0||!Number.isSafeInteger(command.testCount)||command.testCount!<=0||command.noTestsReason)throw Error('Frozen regression requires commands with exact test counts')}
 currentCandidate(store,input.candidate);
 if(!input.suite?.paths?.length)throw Error('Frozen regression suite scope required');
 const suiteSnapshot=snapshot(store,input.suite.root,input.suite.paths);if(!suiteSnapshot.files.length)throw Error('Frozen regression suite files required');
 const manifest:FrozenRegression={...input,kind:'frozen-regression',suiteSnapshot,requiredChecks:input.commands.map(c=>({id:c.id,commandDigest:commandIdentity(c),expectedTests:c.testCount!}))};
 const id=digest(manifest);sealEvidence(store,'authority','frozen-regression:'+id,manifest);return {digest:id,evidence:[]};
}
function frozenManifest(store:Store,id:string):FrozenRegression{
 if(!/^[a-f0-9]{64}$/.test(id))throw Error('Regression identity missing');
 const manifest=verifiedEvidence<FrozenRegression>(store,'authority','frozen-regression:'+id);
 if(manifest.kind!=='frozen-regression'||digest(manifest)!==id||!manifest.requiredChecks.length||manifest.commands.length!==manifest.requiredChecks.length)throw Error('Frozen regression manifest mismatch');
 if(snapshot(store,manifest.suiteSnapshot.root,manifest.suiteSnapshot.scope).id!==manifest.suiteSnapshot.id)throw Error('Frozen regression suite mutated');
 return manifest;
}
export async function executeFrozenRegression(store:Store,id:string,authority:{trustedCode:boolean;root:string},signal?:AbortSignal):Promise<FrozenRegressionProof>{
 const manifest=frozenManifest(store,id);currentCandidate(store,manifest.candidate);
 for(const command of manifest.commands)await executeCheck(store,{...command,id:'regression:'+id+':'+command.id},{candidate:manifest.candidate,policy:manifest.policy,plan:id},authority,signal);
 currentCandidate(store,manifest.candidate);return {digest:id,evidence:manifest.requiredChecks.map(c=>c.id)};
}
export interface PromotionAuthority {id:string;action:'promote'|'rollback';project:string;candidate:string;expires:number;}
export interface PromotionRequest {project:string;experiment:string;candidate:string;base:string;policy:string;plan:string;certificate:string;authority:string;frozenRegression:FrozenRegressionProof;expectedActive:string;}
export function approvePromotion(store:Store,request:Omit<PromotionAuthority,'id'>,operatorConfirmed:boolean){if(!operatorConfirmed||!request.project||!request.candidate||request.expires<=Date.now())throw Error('Promotion operator approval required');const authority={...request,id:randomUUID()};sealEvidence(store,'authority',authority.id,authority);return authority}
export function promote(store:Store,r:PromotionRequest){
 const authority=verifiedEvidence<PromotionAuthority>(store,'authority',r.authority);if(authority.action!=='promote'||authority.project!==r.project||authority.candidate!==r.candidate||authority.expires<=Date.now())throw Error('Promotion authority missing/expired');
 const manifest=frozenManifest(store,r.frozenRegression.digest);
 for(const field of ['project','experiment','candidate','base','policy','plan'] as const)if(manifest[field]!==r[field])throw Error('Frozen regression binding mismatch');
 const ids=r.frozenRegression.evidence;if(!Array.isArray(ids)||ids.length!==manifest.requiredChecks.length||new Set(ids).size!==ids.length||manifest.requiredChecks.some(c=>!ids.includes(c.id)))throw Error('Frozen regression required suite coverage mismatch');
 for(const required of manifest.requiredChecks){const executionId='regression:'+r.frozenRegression.digest+':'+required.id,command=manifest.commands.find(c=>c.id===required.id)!;const check=verifiedEvidence<Check & {commandDigest:string;runner:string;expectedTests:number}>(store,'check',evidenceId(r.candidate,executionId));if(check.id!==executionId||check.candidate!==r.candidate||check.policy!==r.policy||check.plan!==r.frozenRegression.digest||check.commandDigest!==commandIdentity({...command,id:executionId})||commandIdentity(command)!==required.commandDigest||check.status!=='passed'||check.exitCode!==0||check.runner!=='bun-test'||check.expectedTests!==required.expectedTests||check.selectedTests!==required.expectedTests)throw Error('Regression execution not bound/passed');store.readArtifact(check.log)}
 currentCandidate(store,r.candidate);
 const cert=requireCertificate(store,r.certificate,r);const regression=store.get<{candidate:string;regressionDigest:string}>('regression',r.experiment);if(!regression||regression.candidate!==r.candidate||regression.regressionDigest!==r.frozenRegression.digest)throw Error('Experiment candidate/regression provenance mismatch');
 return store.db.transaction(()=>{const active=store.get<any>('policy',r.project);if((active?.candidate??r.base)!==r.expectedActive)throw Error('Active baseline changed');const version={candidate:r.candidate,previous:active??{candidate:r.base},certificate:cert.id,experiment:r.experiment,regression:r.frozenRegression.digest,at:Date.now()};store.put('policy',r.project,version);return version})();
}
export function rollbackPromotion(store:Store,project:string,expectedActive:string,authorityId:string){const authority=verifiedEvidence<PromotionAuthority>(store,'authority',authorityId);if(authority.action!=='rollback'||authority.project!==project||authority.candidate!==expectedActive||authority.expires<=Date.now())throw Error('Rollback authority required');return store.db.transaction(()=>{const current=store.get<any>('policy',project);if(!current||current.candidate!==expectedActive||!current.previous)throw Error('Rollback precondition mismatch');store.put('policy',project,current.previous);return current.previous})()}
