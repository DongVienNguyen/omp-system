import {readFileSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Store} from './state';
import {requireCertificate} from './gate';
import {approveDelivery,exportVerified,prepareDeliveryBranch,bindDeliveryHead,pushVerified,createGitHubPullRequest,reconcileGitHubDelivery,deliveryProject,recordForgeRound,setForgeFrontier,assessForgeFrontier,type DeliveryInput,type DeliveryAuthority,type ForgeFrontier} from './delivery';
import {verifiedEvidence} from './evidence';
/** Invoked only by operator slash command, never registered model tool. */
export async function deliveryCommand(store:Store,project:string,file:string){
 const value:unknown=JSON.parse(readFileSync(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Delivery specification required');const spec=value as Record<string,unknown>;
 if(['round','frontier','frontier-check'].includes(String(spec.operation))){
  project=realpathSync(project);const allowed=spec.operation==='round'?['operation','id','base','head','producer','reviewer','verdict']:spec.operation==='frontier'?['operation','id','writer','generation','expectedGeneration','items']:['operation','frontier','generation','writer','trunk','observations'];if(Object.keys(spec).some(k=>!allowed.includes(k)))throw Error('Unknown local forge policy field');
  if(spec.operation==='round')return recordForgeRound(store,{id:spec.id as string,project,base:spec.base as string,head:spec.head as string,producer:spec.producer as string,reviewer:spec.reviewer as string,verdict:spec.verdict as 'PASS'|'FAIL'},true);
  if(spec.operation==='frontier')return setForgeFrontier(store,{id:spec.id as string,project,writer:spec.writer as string,generation:spec.generation as number,items:spec.items as ForgeFrontier['items']},spec.expectedGeneration as number,true);
  const frontier=store.get<ForgeFrontier>('forge-frontier',spec.frontier as string);if(!frontier||frontier.project!==project)throw Error('Forge frontier project mismatch');return assessForgeFrontier(store,{frontier:spec.frontier as string,generation:spec.generation as number,writer:spec.writer as string,trunk:spec.trunk as string,observations:spec.observations as Parameters<typeof assessForgeFrontier>[1]['observations']});
 }
 const allowed=['operation','certificate','candidate','base','policy','plan','destination','expires','head','branch','repository','baseBranch','title','body','requiredChecks','binding','pushReceipt','pullRequest','repositoryRoot','baseHead','authorName','authorEmail','message'];if(Object.keys(spec).some(k=>!allowed.includes(k)))throw Error('Unknown delivery field');
 const text=(key:string)=>{const v=spec[key];if(typeof v!=='string'||!v)throw Error('Delivery '+key+' required');return v};
 const requiredChecks=()=>{const v=spec.requiredChecks;if(!Array.isArray(v)||!v.length||v.some(n=>typeof n!=='string'||!n.trim()))throw Error('Delivery requiredChecks required');return v as string[]};
 const operation=text('operation');if(!['export','prepare-branch','push','pull-request','reconcile'].includes(operation)||typeof spec.expires!=='number'||!Number.isSafeInteger(spec.expires)||spec.expires<=Date.now())throw Error('Delivery operation/expiry required');
 const input:DeliveryInput={certificate:text('certificate'),candidate:text('candidate'),base:text('base'),policy:text('policy'),plan:text('plan'),authority:randomUUID()};const cert=requireCertificate(store,input.certificate,input);project=realpathSync(project);if(deliveryProject(store,cert.id)!==project)throw Error('Delivery project scope mismatch');
 if(operation==='reconcile'){
  const pr=verifiedEvidence<{action:string;authority:string}>(store,'authority','delivery-pr:'+text('pullRequest'));if(pr.action!=='pr-receipt')throw Error('PR receipt required');
  const approval=verifiedEvidence<DeliveryAuthority>(store,'authority',pr.authority);if(approval.action!=='pull-request')throw Error('PR approval absent');input.authority=approval.id;
  const token=process.env.GITHUB_TOKEN;if(!token)throw Error('GITHUB_TOKEN required');return reconcileGitHubDelivery(store,{...input,binding:text('binding'),pullRequest:text('pullRequest'),token,required:requiredChecks()});
 }
 const common={id:input.authority,project,candidate:input.candidate,destination:text('destination'),expires:spec.expires};
 let authority:DeliveryAuthority;
 if(operation==='export')authority={...common,action:'local-export'};
 else if(operation==='prepare-branch')authority={...common,action:'prepare-branch',repositoryRoot:text('repositoryRoot'),baseHead:text('baseHead'),branch:text('branch'),authorName:text('authorName'),authorEmail:text('authorEmail'),message:text('message')};
 else if(operation==='push')authority={...common,action:'push',head:text('head'),branch:text('branch')};
 else authority={...common,action:'pull-request',head:text('head'),branch:text('branch'),repository:text('repository'),baseBranch:text('baseBranch'),title:text('title'),body:typeof spec.body==='string'?spec.body:'',requiredChecks:requiredChecks()};
 approveDelivery(store,authority,true);
 if(authority.action==='local-export')return exportVerified(store,input);
 if(authority.action==='prepare-branch')return prepareDeliveryBranch(store,input);
 if(authority.action==='push'){const binding=typeof spec.binding==='string'?spec.binding:bindDeliveryHead(store,input).id;return pushVerified(store,{...input,binding})}
 const token=process.env.GITHUB_TOKEN;if(!token)throw Error('GITHUB_TOKEN required');return createGitHubPullRequest(store,{...input,binding:text('binding'),pushReceipt:text('pushReceipt'),token});
}
