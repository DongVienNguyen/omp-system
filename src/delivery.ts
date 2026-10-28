import { realpathSync,mkdirSync,writeFileSync,existsSync,readdirSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store } from './state';
import { requireCertificate } from './gate';
import { scoped,type Snapshot } from './workspaces';
import { verifiedEvidence,sealEvidence } from './evidence';
import { type Check,type Review,digest,contained } from './contracts';
import type { Certificate } from './contracts';

export interface DeliveryInput {certificate:string;candidate:string;base:string;policy:string;plan:string;authority:string;}
type Approval = {id:string;project:string;candidate:string;destination:string;expires:number};
export type DeliveryAuthority = Approval & ({action:'local-export'}|{action:'prepare-branch';repositoryRoot:string;baseHead:string;branch:string;authorName:string;authorEmail:string;message:string}|{action:'push';head:string;branch:string}|{action:'pull-request';head:string;branch:string;repository:string;baseBranch:string;title:string;body:string;requiredChecks:string[]});
export type GitHubTransport = (url:string,init:RequestInit)=>Promise<Response>;
export interface DeliveryBinding {id:string;certificate:string;candidate:string;project:string;head:string;worktree?:string;branch?:string;preparation?:string;}
const sha=(value:string)=>/^[a-f0-9]{40}$/.test(value);
const repository=(value:string)=>/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)&&!value.split('/').some(p=>p==='.'||p==='..');
const branch=(value:string)=>typeof value==='string'&&value.length<=240&&/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)&&!value.includes('..')&&!value.includes('//')&&!value.endsWith('/')&&!value.endsWith('.')&&!value.split('/').some(p=>p.endsWith('.lock'));
type PushReceipt={id:string;action:string;binding:string;head:string;branch:string;destination:string};
type PrReceipt={id:string;action:string;authority:string;binding:string;head:string;branch:string;repository:string;number:number;requiredChecks:string[]};
type RuntimeDispatch={run:string;receipt?:{usage?:{sessionId?:string}}};
type ApiObject=Record<string,unknown>;
function object(value:unknown):ApiObject {if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Malformed GitHub object');return value as ApiObject}
function nested(value:unknown,key:string){return object(object(value)[key])}
function git(root:string,args:string[],timeout=10000,input?:Buffer|string){
 const env:NodeJS.ProcessEnv={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};
 for(const key of Object.keys(env))if(key.startsWith('GIT_')&&!['GIT_TERMINAL_PROMPT','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL'].includes(key))delete env[key];
 const result=spawnSync('git',['-C',root,'-c','core.hooksPath='+ (process.platform==='win32'?'NUL':'/dev/null'),'-c','credential.helper=','-c','protocol.allow=never','-c','protocol.https.allow=always','-c','protocol.ssh.allow=always','-c','core.sshCommand=ssh -oBatchMode=yes',...args],{encoding:'utf8',timeout,maxBuffer:2*1024*1024,env,windowsHide:true,input});
 if(result.error||result.status!==0)throw Error('Git delivery failed/unknown: '+(result.error?.message??result.stderr.slice(-4000)));
 return result.stdout;
}
export function approveDelivery(store:Store,authority:DeliveryAuthority,operatorConfirmed:boolean){
 if(!operatorConfirmed||!authority.id||!authority.project||!authority.candidate||!authority.destination||!Number.isFinite(authority.expires)||authority.expires<=Date.now())throw Error('Delivery operator approval required');
 if(store.get('sealed-authority',authority.id))throw Error('Authority ID already sealed');
 if(authority.action==='local-export'){if(!/^[a-f0-9]{64}$/.test(authority.candidate))throw Error('Candidate digest required')}
 else if(authority.action==='prepare-branch'){if(!sha(authority.baseHead)||!branch(authority.branch)||!authority.repositoryRoot||!authority.authorName.trim()||!authority.authorEmail.includes('@')||/[\r\n<>]/.test(authority.authorName+authority.authorEmail)||!authority.message.trim()||authority.message.length>4096)throw Error('Exact local branch preparation approval required')}
 else if(authority.action==='push'){if(!sha(authority.head)||!branch(authority.branch)||!(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(authority.destination)||/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(authority.destination)))throw Error('Exact GitHub push destination/head/branch required')}
 else if(authority.action==='pull-request'){if(!sha(authority.head)||!branch(authority.branch)||!branch(authority.baseBranch)||authority.branch===authority.baseBranch||!repository(authority.repository)||authority.destination!=='https://api.github.com/repos/'+authority.repository+'/pulls'||typeof authority.title!=='string'||!authority.title.trim()||authority.title.length>256||typeof authority.body!=='string'||authority.body.length>65536||!Array.isArray(authority.requiredChecks)||!authority.requiredChecks.length||authority.requiredChecks.some(n=>typeof n!=='string'||!n.trim())||new Set(authority.requiredChecks).size!==authority.requiredChecks.length)throw Error('Exact pull request approval required')}
 else throw Error('Unknown delivery action');
 sealEvidence(store,'authority',authority.id,authority);return authority;
}
export function deliveryProject(store:Store,certificate:string){const cert=store.get<Certificate>('certificate',certificate);if(!cert)throw Error('Delivery certificate missing');const source=store.get<Snapshot>('snapshot',cert.candidate);if(!source)throw Error('Snapshot missing');if(!cert.run)return source.root;const binding=store.get<any>('candidate-run',cert.run+':'+cert.candidate),runSpec=store.get<any>('run-spec',cert.run),runSource=store.get<any>('run-source',cert.run);if(!binding||binding.generation!==cert.generation||!runSpec||!runSource||runSource.original!==runSpec.project||runSource.generation!==cert.generation)throw Error('Delivery project lineage missing');return realpathSync(runSpec.project)}
function approved(store:Store,input:DeliveryInput,action:DeliveryAuthority['action']){
 const authority=verifiedEvidence<DeliveryAuthority>(store,'authority',input.authority);
 if(authority.action!==action||authority.candidate!==input.candidate||authority.expires<=Date.now())throw Error('Delivery action/candidate authority mismatch');
 const cert=requireCertificate(store,input.certificate,input),source=store.get<Snapshot>('snapshot',cert.candidate);
 if(!source||deliveryProject(store,cert.id)!==realpathSync(authority.project))throw Error('Project authority mismatch');
 const {id,...body}=source;if(id!==digest(body)||id!==input.candidate)throw Error('Snapshot identity mismatch');
 return {authority,cert,source};
}
export function exportVerified(store:Store,input:DeliveryInput){
 const {authority,cert,source}=approved(store,input,'local-export');
 const destination=resolve(authority.destination);
 if(source.files.some(f=>f.path==='omp-system-delivery.json'||f.path==='omp-system-evidence'||f.path.startsWith('omp-system-evidence/')))throw Error('Delivery evidence path collides with candidate');
 if(existsSync(destination)&&readdirSync(destination).length)throw Error('Destination not empty; no overwrite');
 const checks=cert.checks.map(id=>verifiedEvidence<Check>(store,'check',id));
 const review=verifiedEvidence<Review>(store,'review',cert.review);
 const runtime=store.list<RuntimeDispatch>('dispatch').filter(d=>cert.run&&d.run===cert.run&&(d.receipt?.usage?.sessionId===review.session||d.receipt?.usage?.sessionId===review.implementerSession));
 const risks=review.findings.filter(f=>!f.resolved);
 const actions=store.list<{body:DeliveryAuthority}>('sealed-authority').map(r=>r.body).filter(a=>a&&['local-export','prepare-branch','push','pull-request'].includes(a.action)&&a.candidate===cert.candidate&&a.project===authority.project&&a.expires>Date.now());
 mkdirSync(destination,{recursive:true});
 for(const file of source.files){const bytes=store.readArtifact(file.artifact);if(digest(bytes.toString('base64'))!==file.hash)throw Error('Candidate artifact mismatch');const dest=scoped(destination,file.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,bytes,{flag:'wx',mode:file.mode})}
 const evidenceRoot=scoped(destination,'omp-system-evidence');mkdirSync(evidenceRoot);
 for(let i=0;i<checks.length;i++)writeFileSync(join(evidenceRoot,'check-'+i+'.log'),store.readArtifact(checks[i]!.log),{flag:'wx'});
 writeFileSync(join(evidenceRoot,'review-runtime.json'),JSON.stringify({review,runtime,availability:runtime.length?'RECORDED':'NOT_RECORDED'},null,2),{flag:'wx'});
 const handoff={certificate:cert,candidate:source,checks,review,runtime,unresolvedRisks:risks,authorizedActions:actions,scope:'LOCAL_VERIFIED',remote:'NOT RUN',gaps:[...(!runtime.length?['Review/implementer runtime transcript not recorded; sealed review result only']:[]),'Hosted push/PR/CI not executed by local export']};
 writeFileSync(join(destination,'omp-system-delivery.json'),JSON.stringify(handoff,null,2),{flag:'wx'});
 store.put('delivery',input.certificate,{scope:'LOCAL_VERIFIED',destination:realpathSync(destination),candidate:input.candidate,authority:authority.id});
 return {scope:'LOCAL_VERIFIED' as const,destination,candidate:input.candidate};
}
/** Explicit local-only commit in a new approved worktree. Original branch, index and files remain untouched. */
export function prepareDeliveryBranch(store:Store,input:DeliveryInput):DeliveryBinding{
 const {authority,cert,source}=approved(store,input,'prepare-branch');if(authority.action!=='prepare-branch')throw Error('Branch preparation authority required');
 const repositoryRoot=realpathSync(authority.repositoryRoot),destination=resolve(authority.destination);
 if(existsSync(destination))throw Error('Preparation destination must not exist');
 if(contained(repositoryRoot,destination)||contained(source.root,destination)||contained(realpathSync(authority.project),destination))throw Error('Preparation destination must be outside original/candidate workspaces');
 if(git(repositoryRoot,['for-each-ref','--format=%(refname)','refs/heads/'+authority.branch]).split('\n').includes('refs/heads/'+authority.branch))throw Error('Preparation requires a new branch; no history replacement');
 if(source.files.some(f=>f.path.toLowerCase().split('/').includes('.git')))throw Error('Candidate Git metadata forbidden');
 const config=git(repositoryRoot,['config','--local','--list']);if(/^(url\..*\.(insteadof|pushinsteadof)|push\.pushoption|core\.(gitproxy|sshcommand)|remote\..*\.(push|mirror)|http\..*|include.*|filter\..*)=/im.test(config))throw Error('Unsafe repository delivery configuration');
 if(git(repositoryRoot,['rev-parse','--verify',authority.baseHead+'^{commit}']).trim()!==authority.baseHead)throw Error('Preparation base commit mismatch');
 const tracked=git(repositoryRoot,['ls-tree','-r','--name-only','-z',authority.baseHead]).split('\0').filter(Boolean);
 const covers=(path:string)=>source.scope.some(s=>path===s||path.startsWith(s+'/'));
 if(tracked.some(p=>!covers(p))||source.files.some(f=>!covers(f.path)))throw Error('Preparation requires certificate scope covering complete base tree');
 if(git(repositoryRoot,['ls-tree','-r',authority.baseHead]).split('\n').some(line=>/^(120000|160000) /.test(line)))throw Error('Linked/submodule base tree unsupported');
 const original={head:git(repositoryRoot,['rev-parse','HEAD']).trim(),index:git(repositoryRoot,['ls-files','--stage','-z']),status:git(repositoryRoot,['status','--porcelain=v1','--untracked-files=all'])};
 beginAction(store,authority);
 try{
  git(repositoryRoot,['worktree','add','--detach','--no-checkout','--',destination,authority.baseHead],30000);
  git(destination,['read-tree','--empty']);
  for(const file of source.files){const bytes=store.readArtifact(file.artifact);if(digest(bytes.toString('base64'))!==file.hash)throw Error('Candidate artifact mismatch');const target=scoped(destination,file.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx',mode:file.mode});const blob=git(destination,['hash-object','-w','--stdin'],10000,bytes).trim();git(destination,['update-index','--add','--cacheinfo',(file.mode&0o111?'100755':'100644')+','+blob+','+file.path])}
  const tree=git(destination,['write-tree']).trim();const head=git(destination,['-c','user.name='+authority.authorName,'-c','user.email='+authority.authorEmail,'commit-tree',tree,'-p',authority.baseHead],10000,authority.message+'\n').trim();
  approved(store,input,'prepare-branch');
  git(repositoryRoot,['update-ref','refs/heads/'+authority.branch,head,'0'.repeat(40)]);
  git(destination,['symbolic-ref','HEAD','refs/heads/'+authority.branch]);
  if(git(destination,['status','--porcelain=v1','--untracked-files=all']).trim())throw Error('Prepared worktree is not byte-clean');
  if(original.head!==git(repositoryRoot,['rev-parse','HEAD']).trim()||original.index!==git(repositoryRoot,['ls-files','--stage','-z'])||original.status!==git(repositoryRoot,['status','--porcelain=v1','--untracked-files=all']))throw Error('Original repository changed during preparation');
  const project=deliveryProject(store,cert.id),body={certificate:cert.id,candidate:cert.candidate,project,head,worktree:realpathSync(destination),branch:authority.branch,preparation:authority.id};const binding:DeliveryBinding={id:digest(body),...body};
  sealEvidence(store,'authority','delivery-binding:'+binding.id,binding);store.put('delivery-action',authority.id,{state:'PREPARED',binding:binding.id,head,destination});return binding;
 }catch(error){store.put('delivery-action',authority.id,{state:'UNKNOWN',reason:String(error),destination});throw error}
}
/** Bind only an exact, clean committed candidate. No implicit commit or history rewriting. */
export function bindDeliveryHead(store:Store,input:DeliveryInput):DeliveryBinding{
 const {cert,source}=approved(store,input,'push');
 const authority=verifiedEvidence<DeliveryAuthority>(store,'authority',input.authority);if(authority.action!=='push')throw Error('Push approval required');
 const head=git(source.root,['rev-parse','--verify','HEAD^{commit}']).trim();
 if(head!==authority.head||source.base!==head||git(source.root,['status','--porcelain=v1','--untracked-files=all']).trim())throw Error('Candidate must match exact clean committed HEAD');
 const tracked=git(source.root,['ls-tree','-r','--name-only','-z',head]).split('\0').filter(Boolean).sort();if(digest(tracked)!==digest(source.files.map(f=>f.path).sort()))throw Error('Push requires certificate covering complete committed tree');
 const config=git(source.root,['config','--local','--list']);if(/^(url\..*\.(insteadof|pushinsteadof)|push\.pushoption|core\.(gitproxy|sshcommand)|remote\..*\.(push|mirror)|http\..*|include.*)=/im.test(config))throw Error('Unsafe repository delivery configuration');
 for(const file of source.files){const blob=spawnSync('git',['-C',source.root,'cat-file','blob',head+':'+file.path],{timeout:10000,maxBuffer:16*1024*1024,windowsHide:true});if(blob.error||blob.status!==0||digest(blob.stdout.toString('base64'))!==file.hash)throw Error('Committed candidate bytes differ');}
 const binding:DeliveryBinding={id:digest({certificate:cert.id,candidate:cert.candidate,project:source.root,head}),certificate:cert.id,candidate:cert.candidate,project:source.root,head};
 const key='delivery-binding:'+binding.id;
 if(store.get('sealed-authority',key)){if(digest(verifiedEvidence(store,'authority',key))!==digest(binding))throw Error('Immutable head binding conflict')}
 else sealEvidence(store,'authority',key,binding);
 return binding;
}
function bindingFor(store:Store,input:DeliveryInput,id:string){const binding=verifiedEvidence<DeliveryBinding>(store,'authority','delivery-binding:'+id);if(binding.certificate!==input.certificate||binding.candidate!==input.candidate)throw Error('Candidate/head binding mismatch');return binding}
function beginAction(store:Store,authority:DeliveryAuthority){if(store.get('delivery-action',authority.id))throw Error('Delivery action already attempted; reconcile, never replay');store.put('delivery-action',authority.id,{authority:authority.id,state:'UNKNOWN',head:'head' in authority?authority.head:undefined,at:Date.now()})}
export function pushVerified(store:Store,input:DeliveryInput&{binding:string}){
 const {authority,source}=approved(store,input,'push');if(authority.action!=='push')throw Error('Push approval required');
 const binding=bindingFor(store,input,input.binding);if(binding.head!==authority.head)throw Error('Push HEAD binding stale');
 const pushRoot=binding.worktree??source.root;
 if(binding.worktree){if(binding.branch!==authority.branch||git(pushRoot,['rev-parse','HEAD']).trim()!==binding.head||git(pushRoot,['symbolic-ref','HEAD']).trim()!=='refs/heads/'+authority.branch||git(pushRoot,['status','--porcelain=v1','--untracked-files=all']).trim())throw Error('Prepared branch binding stale');const paths=git(pushRoot,['ls-tree','-r','--name-only','-z',binding.head]).split('\0').filter(Boolean).sort();if(digest(paths)!==digest(source.files.map(f=>f.path).sort()))throw Error('Prepared tree differs from certified files');for(const f of source.files){const actual=git(pushRoot,['rev-parse',binding.head+':'+f.path]).trim(),expected=git(pushRoot,['hash-object','--stdin'],10000,store.readArtifact(f.artifact)).trim();if(actual!==expected)throw Error('Prepared commit bytes differ')}}else if(bindDeliveryHead(store,input).id!==binding.id)throw Error('Push HEAD binding stale');
 const config=git(pushRoot,['config','--show-scope','--no-includes','--list']).split('\n').filter(line=>!line.startsWith('command\t')).map(line=>line.slice(line.indexOf('\t')+1)).join('\n');if(/^(url\..*|include.*|http\..*|push\.pushoption|core\.(gitproxy|sshcommand)|ssh\.variant|remote\..*\.(push|mirror|proxy|receivepack|uploadpack|vcs))=/im.test(config))throw Error('Unsafe effective Git delivery configuration');
 beginAction(store,authority);
 try{const output=git(pushRoot,['push','--no-verify','--porcelain','--',authority.destination,binding.head+':refs/heads/'+authority.branch],30000);const receipt={id:randomUUID(),action:'push-receipt',authority:authority.id,binding:binding.id,candidate:binding.candidate,head:binding.head,branch:authority.branch,destination:authority.destination,log:store.artifact(output),scope:'PUSHED',at:Date.now()};sealEvidence(store,'authority','delivery-push:'+receipt.id,receipt);store.put('delivery-action',authority.id,{...receipt,state:'PUSHED'});return receipt}
 catch(error){store.put('delivery-action',authority.id,{state:'UNKNOWN',authority:authority.id,head:binding.head,reason:String(error)});throw error}
}
const api='https://api.github.com';
async function json(transport:GitHubTransport,url:string,token:string,init:RequestInit={}){
 const response=await transport(url,{...init,redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('GitHub evidence unavailable: HTTP '+response.status);
 return {data:object(await response.json()),response};
}
export async function createGitHubPullRequest(store:Store,input:DeliveryInput&{binding:string;pushReceipt:string;token:string},transport:GitHubTransport=fetch){
 const {authority}=approved(store,input,'pull-request');if(authority.action!=='pull-request'||!input.token)throw Error('PR authority/token required');
 const binding=bindingFor(store,input,input.binding),push=verifiedEvidence<PushReceipt>(store,'authority','delivery-push:'+input.pushReceipt);
 const expectedRemote='https://github.com/'+authority.repository;
 if(binding.head!==authority.head||push.action!=='push-receipt'||push.binding!==binding.id||push.head!==binding.head||push.branch!==authority.branch||![expectedRemote,expectedRemote+'.git','git@github.com:'+authority.repository,'git@github.com:'+authority.repository+'.git'].includes(push.destination))throw Error('PR push/binding mismatch');
 const current=async()=>{const {data}=await json(transport,api+'/repos/'+authority.repository+'/git/ref/heads/'+authority.branch,input.token);if(nested(data,'object').sha!==binding.head)throw Error('Remote branch head stale')};
 await current();approved(store,input,'pull-request');beginAction(store,authority);
 try{const {data}=await json(transport,authority.destination,input.token,{method:'POST',body:JSON.stringify({title:authority.title,body:authority.body,head:authority.branch,base:authority.baseBranch})});
 if(typeof data.number!=='number'||!Number.isSafeInteger(data.number)||data.number<=0||nested(data,'head').sha!==binding.head||nested(data,'head').ref!==authority.branch||nested(data,'base').ref!==authority.baseBranch||nested(nested(data,'head'),'repo').full_name!==authority.repository||nested(nested(data,'base'),'repo').full_name!==authority.repository||data.html_url!=='https://github.com/'+authority.repository+'/pull/'+data.number)throw Error('PR response head/repository mismatch');
 await current();const receipt={id:randomUUID(),action:'pr-receipt',authority:authority.id,binding:binding.id,head:binding.head,repository:authority.repository,branch:authority.branch,requiredChecks:authority.requiredChecks,number:data.number,url:data.html_url,at:Date.now()};sealEvidence(store,'authority','delivery-pr:'+receipt.id,receipt);store.put('delivery-action',authority.id,{...receipt,state:'PR_CREATED'});return receipt;
 }catch(error){store.put('delivery-action',authority.id,{state:'UNKNOWN',authority:authority.id,head:binding.head,reason:String(error)});throw error}
}
export interface CheckRequest {repository:string;head:string;token:string;required:string[];}
export async function observeGitHubChecks(request:CheckRequest,transport:GitHubTransport=fetch){
 const unknown=(reason:string)=>({scope:'UNKNOWN' as const,status:'BLOCKED' as const,head:request.head,required:request.required,reason});
 if(!repository(request.repository)||!sha(request.head)||!request.token||!Array.isArray(request.required)||!request.required.length||request.required.some(n=>typeof n!=='string'||!n.trim())||new Set(request.required).size!==request.required.length)return unknown('Approved repository/head/token/unique required check policy required');
 try{
 const prefix=api+'/repos/'+request.repository+'/commits/'+request.head+'/check-runs';const runs:{id:number;name:string;head_sha:string;started_at:string|null;html_url:string;status:string;conclusion:string|null}[]=[];let total:number|undefined;
 for(let page=1;page<=100;page++){
  const {data,response}=await json(transport,prefix+'?per_page=100&filter=latest&page='+page,request.token);
  if(typeof data.total_count!=='number'||!Number.isSafeInteger(data.total_count)||data.total_count<0||data.total_count>10000||!Array.isArray(data.check_runs)||data.check_runs.length>100)throw Error('Malformed check pagination');
  if(total!==undefined&&total!==data.total_count)throw Error('Check pagination changed during observation');total=data.total_count;
  for(const value of data.check_runs){const r=object(value);if(r.head_sha!==request.head||typeof r.id!=='number'||!Number.isSafeInteger(r.id)||typeof r.name!=='string'||(r.started_at!==null&&(typeof r.started_at!=='string'||!Number.isFinite(Date.parse(r.started_at))))||typeof r.html_url!=='string'||typeof r.status!=='string'||(r.conclusion!==null&&typeof r.conclusion!=='string'))throw Error('Malformed or stale check head');runs.push({id:r.id,name:r.name,head_sha:request.head,started_at:r.started_at,html_url:r.html_url,status:r.status,conclusion:r.conclusion})}
  if(new Set(runs.map(r=>r.id)).size!==runs.length||runs.length>total)throw Error('Duplicate/inconsistent check pagination');
  const next=response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/);
  if(next){const url=new URL(next[1]!);if(url.origin!==api||url.pathname!==new URL(prefix).pathname||url.searchParams.get('page')!==String(page+1)||url.searchParams.get('per_page')!=='100'||url.searchParams.get('filter')!=='latest'||[...url.searchParams.keys()].some(k=>!['page','per_page','filter'].includes(k)))throw Error('Unexpected check pagination link')}
  if(runs.length===total){if(next)throw Error('Extra check page');break}
  if(!data.check_runs.length||page===100)throw Error('Incomplete check pagination');
 }
 const checks=request.required.map(name=>{const matches=runs.filter(r=>r.name===name).sort((a,b)=>b.id-a.id);const latest=matches[0];return {name,id:latest?.id,head:request.head,url:latest?.html_url,status:latest?.status??'missing',conclusion:latest?.conclusion??null}});
 if(checks.some(c=>c.status!=='completed'||c.conclusion!=='success'))return {scope:'REMOTE_BLOCKED' as const,status:'BLOCKED' as const,head:request.head,required:request.required,checks,reason:'Required checks missing, pending, or unsuccessful'};
 return {scope:'REMOTE_VERIFIED' as const,status:'PASSED' as const,head:request.head,required:request.required,checks,observedAt:Date.now()};
 }catch(error){return unknown(String(error))}
}
/** Re-read provider head both sides of CI observation. Never reuse old green evidence. */
export async function reconcileGitHubDelivery(store:Store,input:DeliveryInput&{binding:string;pullRequest:string;token:string;required:string[]},transport:GitHubTransport=fetch){
 const {authority}=approved(store,input,'pull-request');const binding=bindingFor(store,input,input.binding),pr=verifiedEvidence<PrReceipt>(store,'authority','delivery-pr:'+input.pullRequest);
 const blocked=(reason:string)=>({scope:'UNKNOWN' as const,status:'BLOCKED' as const,head:binding.head,reason});
 if(pr.action!=='pr-receipt'||pr.authority!==authority.id||pr.binding!==binding.id||pr.head!==binding.head||authority.action!=='pull-request'||digest([...input.required].sort())!==digest([...authority.requiredChecks].sort())||digest(pr.requiredChecks)!==digest(authority.requiredChecks))return blocked('PR binding/required check policy mismatch');
 try{const current=async()=>{const {data}=await json(transport,api+'/repos/'+pr.repository+'/pulls/'+pr.number,input.token);if(nested(data,'head').sha!==binding.head||nested(data,'head').ref!==pr.branch||nested(nested(data,'head'),'repo').full_name!==pr.repository)throw Error('PR current head stale');const ref=await json(transport,api+'/repos/'+pr.repository+'/git/ref/heads/'+pr.branch,input.token);if(nested(ref.data,'object').sha!==binding.head)throw Error('Remote branch head stale')};
 await current();const result=await observeGitHubChecks({repository:pr.repository,head:binding.head,token:input.token,required:authority.requiredChecks},transport);await current();approved(store,input,'pull-request');
 const record={...result,binding:binding.id,pullRequest:pr.id};store.put('delivery-reconciliation',binding.id,record);return record;
 }catch(error){const result=blocked(String(error));store.put('delivery-reconciliation',binding.id,result);return result}
}
/** Local readiness evidence only. Never grants push, retarget or merge authority. */
export interface ForgeRound {id:string;project:string;base:string;head:string;patchId:string;producer:string;reviewer:string;verdict:'PASS'|'FAIL';}
function patchIdentity(project:string,base:string,head:string){if(!sha(base)||!sha(head))throw Error('Exact base/head required');const patch=git(project,['diff','--no-ext-diff','--binary',base,head]);if(!patch.trim())throw Error('Empty patch has no independent verdict');const id=git(project,['patch-id','--stable'],10000,patch).trim().split(/\s+/)[0];if(!id||!sha(id))throw Error('Stable patch identity unavailable');return id;}
export function recordForgeRound(store:Store,request:{id:string;project:string;base:string;head:string;producer:string;reviewer:string;verdict:'PASS'|'FAIL'},operatorConfirmed:boolean){
 if(!operatorConfirmed||[request.id,request.producer,request.reviewer].some(v=>typeof v!=='string'||!v.trim()||v!==v.trim())||request.producer===request.reviewer||!['PASS','FAIL'].includes(request.verdict))throw Error('Independent operator-attested round required');if(store.get('forge-round',request.id))throw Error('Round already recorded');const project=realpathSync(request.project),round:ForgeRound={...request,project,patchId:patchIdentity(project,request.base,request.head)};sealEvidence(store,'authority','forge-round:'+round.id,round);store.put('forge-round',round.id,round);return round;
}
export interface ForgeFrontier {id:string;project:string;writer:string;generation:number;items:{id:string;branch:string;base:string;head:string;round:string;operatorOwned:boolean}[];}
export function setForgeFrontier(store:Store,request:ForgeFrontier,expectedGeneration:number,operatorConfirmed:boolean){
 if(!operatorConfirmed||typeof request.id!=='string'||!request.id.trim()||typeof request.writer!=='string'||!request.writer.trim()||!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0||request.generation!==expectedGeneration+1||!Array.isArray(request.items)||!request.items.length||request.items.length>100)throw Error('Explicit frontier generation/writer required');const project=realpathSync(request.project),prior=store.get<ForgeFrontier>('forge-frontier',request.id);if(prior&&(prior.project!==project||prior.writer!==request.writer||prior.generation!==expectedGeneration)||!prior&&expectedGeneration!==0)throw Error('Stale frontier or wrong topology writer');const ids=new Set<string>(),branches=new Set<string>();for(const [index,item]of request.items.entries()){if(!item||typeof item.id!=='string'||!item.id.trim()||ids.has(item.id)||!branch(item.branch)||branches.has(item.branch)||!sha(item.base)||!sha(item.head)||typeof item.round!=='string'||!item.round||typeof item.operatorOwned!=='boolean')throw Error('Invalid frontier item');if(index&&item.base!==request.items[index-1]!.head)throw Error('Frontier must be a contiguous base/head chain');ids.add(item.id);branches.add(item.branch);if(git(project,['rev-parse','--verify','refs/heads/'+item.branch]).trim()!==item.head)throw Error('Frontier branch head mismatch');git(project,['cat-file','-e',item.base+'^{commit}'])}const frontier={...request,project};store.db.transaction(()=>{const current=store.get<ForgeFrontier>('forge-frontier',request.id);if((current?.generation??0)!==expectedGeneration)throw Error('Frontier generation changed');sealEvidence(store,'authority','forge-frontier:'+request.id+':'+request.generation,frontier);store.put('forge-frontier',request.id,frontier)})();return frontier;
}
export function assessForgeFrontier(store:Store,request:{frontier:string;generation:number;writer:string;trunk:string;observations:{id:string;head:string;checks:'PASS'|'FAIL'|'UNKNOWN';threads:'RESOLVED'|'UNRESOLVED'|'UNKNOWN';mergeable:boolean|null}[]}){
 const frontier=store.get<ForgeFrontier>('forge-frontier',request.frontier);if(!frontier||frontier.generation!==request.generation||frontier.writer!==request.writer||!sha(request.trunk))throw Error('Stale frontier or wrong topology writer');if(digest(verifiedEvidence(store,'authority','forge-frontier:'+frontier.id+':'+frontier.generation))!==digest(frontier))throw Error('Forged frontier record');if(!Array.isArray(request.observations)||new Set(request.observations.map(o=>o.id)).size!==request.observations.length||request.observations.some(o=>!o||!frontier.items.some(i=>i.id===o.id)||!['PASS','FAIL','UNKNOWN'].includes(o.checks)||!['RESOLVED','UNRESOLVED','UNKNOWN'].includes(o.threads)||o.mergeable!==null&&typeof o.mergeable!=='boolean'))throw Error('Invalid supplied forge observation');
 const ready:string[]=[],blocked:{id:string;reason:string}[]=[];for(const item of frontier.items){let reason='';try{const round=verifiedEvidence<ForgeRound>(store,'authority','forge-round:'+item.round),observation=request.observations.find(o=>o.id===item.id);if(item.operatorOwned)reason='Operator-owned item';else if(git(frontier.project,['rev-parse','--verify','refs/heads/'+item.branch]).trim()!==item.head)reason='Local branch head changed';else if(round.project!==frontier.project||round.verdict!=='PASS'||round.producer===round.reviewer||round.patchId!==patchIdentity(frontier.project,item.base,item.head))reason='Independent patch verdict missing or stale';else if(!observation||observation.head!==item.head||observation.checks!=='PASS'||observation.threads!=='RESOLVED'||observation.mergeable!==true)reason='Exact-head checks, resolved threads and known mergeability required';else{git(frontier.project,['merge-tree','--write-tree',item.head,request.trunk]);const drift=git(frontier.project,['diff','--name-only','-z',item.base,request.trunk]).split('\0').filter(Boolean),changed=new Set(git(frontier.project,['diff','--name-only','-z',item.base,item.head]).split('\0').filter(Boolean));if(drift.some(p=>changed.has(p)||p.startsWith('.github/')))reason='Trunk overlaps changed paths or CI configuration';}}catch{reason='Git or sealed verdict evidence unavailable';}if(reason){blocked.push({id:item.id,reason});break}ready.push(item.id)}const result={frontier:frontier.id,generation:frontier.generation,ready,blocked,status:blocked.length?'BLOCKED':'LOCAL_READY',scope:'Local Git and operator-supplied observations only; remote evidence UNKNOWN; no merge authority'};store.put('forge-assessment',frontier.id+':'+frontier.generation,result);return result;
}
