import {readFileSync,realpathSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {contained,digest} from './contracts';
import {verifiedEvidence,sealEvidence} from './evidence';
import {runSessionPickup,type SessionPickupRequest} from './session-pickup';
import {runEvidenceVideo,validateVideoRequest,type VideoRequest} from './media-video';
import {scoped} from './workspaces';
import type {Store} from './state';

type Outcome='done'|'still running'|'failed'|'not checked';
type Ref={path:string;sha256:string};
type Call={id:string;requestId:string;raisedAt:string;question:string;pick:string;items:{name:string;link?:string;change:string;evidence:Ref;evidenceSummary:string;risk:string;pick?:string}[];options:{name:string;gain:string;cost:string}[]};
export interface MediaCatchupRequest {action:'media-catchup';id:string;project:string;deadline:number;historyId:string;invocation:string;sourceReviewId:string;contentReviewId?:string;visualReviewId?:string;takeaway:string;remainingWork:string;outcomes:{requestId:string;status:Outcome;waitingOnUser:boolean;claim:string;slide:number}[];calls:Call[];video?:VideoRequest;}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function object(v:unknown,keys:string[]):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('Unknown catchup key or object type');return v as Record<string,any>}
function text(v:unknown):asserts v is string{if(typeof v!=='string'||!v.trim()||v.length>4096)throw Error('Bounded nonempty catchup text required')}
function id(v:unknown):asserts v is string{if(typeof v!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))throw Error('Invalid catchup ID')}
function hash(v:unknown):asserts v is string{if(typeof v!=='string'||! /^[a-f0-9]{64}$/.test(v))throw Error('Invalid catchup hash')}
function date(v:unknown):asserts v is string{if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)>Date.now())throw Error('Invalid catchup date')}
function ref(v:unknown){const r=object(v,['path','sha256']);text(r.path);hash(r.sha256);return r as Ref}
function array(v:unknown,max=100):any[]{if(!Array.isArray(v)||v.length>max)throw Error('Bounded catchup array required');return v}
function unique(values:string[]){if(new Set(values).size!==values.length)throw Error('Duplicate catchup identity')}
function callLink(value:string){if(/[\u0000-\u0020\u007f]/.test(value))throw Error('Unsafe call link');const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Unsafe call link');return url.href.replace(/[()'"<>`\\]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());}
export function parseMediaCatchup(value:unknown,project:string):MediaCatchupRequest{
 const v=object(value,['action','id','project','deadline','historyId','invocation','sourceReviewId','contentReviewId','visualReviewId','takeaway','remainingWork','outcomes','calls','video']);
 if(v.action!=='media-catchup'||typeof v.project!=='string'||realpathSync(v.project)!==realpathSync(project))throw Error('Same-project catchup required');
 if(!Number.isSafeInteger(v.deadline)||v.deadline<=Date.now())throw Error('Catchup deadline required');
 for(const k of ['id','historyId','invocation','sourceReviewId'])id(v[k]);for(const k of ['contentReviewId','visualReviewId'])if(v[k]!==undefined)id(v[k]);text(v.takeaway);text(v.remainingWork);
 const video=v.video===undefined?undefined:validateVideoRequest(v.video,project);if(video&&(video.id!==v.id+'-video'||video.deadline>v.deadline))throw Error('Catchup renderer identity/deadline mismatch');
 for(const o of array(v.outcomes)){object(o,['requestId','status','waitingOnUser','claim','slide']);id(o.requestId);text(o.claim);if(!video||!['done','still running','failed','not checked'].includes(o.status)||typeof o.waitingOnUser!=='boolean'||(o.waitingOnUser&&o.status==='done')||!Number.isSafeInteger(o.slide)||o.slide<0||o.slide>=video.slides.length||video.slides[o.slide]!.claim!==o.claim)throw Error('Evidence-bound outcome required')}
 unique(v.outcomes.map((o:any)=>o.requestId));
 for(const c of array(v.calls)){object(c,['id','requestId','raisedAt','question','pick','items','options']);id(c.id);id(c.requestId);date(c.raisedAt);text(c.question);text(c.pick);if(!array(c.items).length)throw Error('Each call needs named items');for(const i of c.items){object(i,['name','link','change','evidence','evidenceSummary','risk','pick']);text(i.name);text(i.change);text(i.evidenceSummary);text(i.risk);if(i.pick!==undefined)text(i.pick);ref(i.evidence);if(i.link!==undefined){text(i.link);callLink(i.link)}}for(const o of array(c.options)){object(o,['name','gain','cost']);text(o.name);text(o.gain);text(o.cost)}}
 unique(v.calls.map((c:any)=>c.id));return JSON.parse(JSON.stringify(v));
}
/** Host-only capture: no caller-supplied transcript/role claims. Uses existing native history result. */
export async function captureMediaCatchupHistory(request:SessionPickupRequest,store:Store,project:string,sessionsRoot?:string){
 outside(store,project);if(request.mode!=='read')throw Error('Read history required');const r=await runSessionPickup(request,store,project,sessionsRoot);if(!('session'in r)||!r.session||!('artifact'in r.session))throw Error('Frozen native history missing');
 const record={kind:'media-catchup-history',project:realpathSync(project),artifact:r.session.artifact,session:r.session.id,capturedAt:new Date().toISOString()};store.readArtifact(record.artifact);sealEvidence(store,'authority','media-catchup-history-'+request.id,record);return record;
}
function outside(store:Store,project:string){if(contained(realpathSync(project),realpathSync(store.directory)))throw Error('Catchup store must be outside project')}
function evidence(store:Store,project:string,r:Ref){const p=scoped(project,r.path);if(!statSync(p).isFile()||statSync(p).size>16*1024**2)throw Error('Bounded factual evidence required');const bytes=readFileSync(p);if(bytes.length>16*1024**2||sha(bytes)!==r.sha256)throw Error('Catchup evidence changed');return store.artifact(bytes)}
const escape=(s:string)=>s.replace(/[\\`*_{}\[\]<>!#|]/g,'\\$&').replace(/[\r\n]+/g,' ');
export function catchupCalls(calls:Call[]):string{return calls.map(c=>{const item=(i:Call['items'][number])=>escape(i.name)+(i.link?' ('+callLink(i.link)+')':'')+': '+escape(i.change)+' Evidence: '+escape(i.evidenceSummary)+(c.options.length?'':'. Risk: '+escape(i.risk))+(i.pick&&i.pick!==c.pick?' Pick: '+escape(i.pick):'');const opening='- '+escape(c.question)+' Pick: '+escape(c.pick);return opening+(c.items.length===1?' '+item(c.items[0]!):c.items.map(i=>'\n  - '+item(i)).join(''))+c.options.map(o=>'\n  - '+escape(o.name)+': '+escape(o.gain)+'; cost: '+escape(o.cost)).join('');}).join('\n')}
/** Reviews are host-sealed, never caller booleans. Missing exact native attribution stays pending.
 * Source review: kind, project, artifact, invocation, exactNativeSource, classifiedAt,
 * events[{id,kind}], requests[string], outstandingCalls[string]. kind is actual-user,
 * notification, assistant or other. Classification must cover every frozen message.
 * Content review binds packetDigest and confirms evidence, completeness, picture/slide rules.
 * Visual review binds packetDigest, videoArtifact and every frame digest/word count/hold.
 */
export async function runMediaCatchup(value:unknown,store:Store,project:string){
 outside(store,project);const r=parseMediaCatchup(value,project),history=verifiedEvidence<any>(store,'authority','media-catchup-history-'+r.historyId);
 object(history,['kind','project','artifact','session','capturedAt']);hash(history.artifact);date(history.capturedAt);if(history.kind!=='media-catchup-history'||history.project!==realpathSync(project))throw Error('Wrong native history scope');
 const raw=store.readArtifact(history.artifact);if(raw.length>16*1024**2)throw Error('History exceeds bounded pickup');const rows=raw.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)),messages=rows.filter(e=>e.type==='message');if(rows.length>10000)throw Error('History exceeds bounded catchup record count');
 const source=verifiedEvidence<any>(store,'review',r.sourceReviewId);object(source,['kind','project','artifact','invocation','exactNativeSource','classifiedAt','events','requests','outstandingCalls']);date(source.classifiedAt);if(source.kind!=='media-catchup-source'||source.project!==history.project||source.artifact!==history.artifact||source.invocation!==r.invocation||typeof source.exactNativeSource!=='boolean')throw Error('Wrong source review binding');
 const events=array(source.events,10000);for(const e of events){object(e,['id','kind']);id(e.id);if(!['actual-user','notification','assistant','other'].includes(e.kind))throw Error('Invalid source classification')};unique(events.map(e=>e.id));if(events.length!==messages.length||events.some((e,i)=>e.id!==messages[i]?.id))throw Error('Source review must cover frozen native messages in order');
 const current=events.findIndex(e=>e.id===r.invocation);if(current<0||events[current].kind!=='actual-user')throw Error('Invocation must be actual user');const invocation=messages[current].message?.content;const invocationText=typeof invocation==='string'?invocation:Array.isArray(invocation)?invocation.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n'):'';if(!/^\s*\/ketchup-video(?:\s|$)/.test(invocationText))throw Error('Current invocation is not ketchup-video');
 if(current!==messages.length-1)throw Error('Catchup invocation must end frozen history');
 let start=current-1;while(start>=0&&events[start].kind!=='actual-user')start--;if(start<0)throw Error('Previous actual user message missing');
 for(const key of ['requests','outstandingCalls']){array(source[key]).forEach(id);unique(source[key])}if(digest([...source.requests].sort())!==digest(r.outcomes.map(o=>o.requestId).sort())||digest([...source.outstandingCalls].sort())!==digest(r.calls.map(c=>c.id).sort()))throw Error('Missing request outcome or outstanding user-only call');
 for(const c of r.calls){if(Date.parse(c.raisedAt)>Date.parse(history.capturedAt))throw Error('Call raised after frozen history');if(r.outcomes.some(o=>o.requestId===c.requestId&&o.status==='done'))throw Error('Waiting user request cannot be done')}
 for(const o of r.outcomes)if(o.waitingOnUser!==r.calls.some(c=>c.requestId===o.requestId))throw Error('Outcome waiting status differs from outstanding calls');
 const evidenceArtifacts=[...(r.video?.slides??[]).map(s=>evidence(store,project,{path:s.evidence,sha256:s.evidenceSha256})),...r.calls.flatMap(c=>c.items.map(i=>evidence(store,project,i.evidence)))];
 const {contentReviewId:_c,visualReviewId:_v,...packet}=r,packetDigest=digest({packet,history:history.artifact,source,evidenceArtifacts}),window={after:events[start].id,before:r.invocation,entries:events.slice(start+1,current).map(e=>e.id)};
 const saved=store.get<any>('media-catchup',r.id);if(saved&&saved.packetDigest!==packetDigest)throw Error('Catchup ID already bound to different packet');
 const pending=(blocker:string)=>({status:'PENDING_REVIEW',verified:false,packetDigest,window,blocker,reply:null});if(!source.exactNativeSource)return pending('Exact native actual-user attribution not established; role fields are not native attestation');
 if(!r.contentReviewId)return pending('Independent evidence and narrative review required');const content=verifiedEvidence<any>(store,'review',r.contentReviewId);object(content,['kind','project','packetDigest','reviewedAt','evidenceAndNarrativeValid']);date(content.reviewedAt);if(content.kind!=='media-catchup-content'||content.project!==history.project||content.packetDigest!==packetDigest||content.evidenceAndNarrativeValid!==true)throw Error('Invalid content evidence review');
 if(!r.outcomes.length&&!r.calls.length){if(r.video)throw Error('Empty catchup must not render unnecessary video');if(Date.now()>=r.deadline)throw Error('Catchup deadline exhausted');const result={status:'REVIEWED',verified:true,packetDigest,window,reply:'Nothing changed and nothing waits on you.'};store.put('media-catchup',r.id,result);return result;}
 if(!r.video)throw Error('Changed catchup requires evidence video');const video=r.video;
 let rendered=saved?.rendered;
 if(saved?.status==='RENDER_FAILED')return saved;
 const calls=catchupCalls(r.calls);if(!rendered){try{rendered=await runEvidenceVideo(video,store,project)}catch(error){const result={status:'RENDER_FAILED',verified:false,packetDigest,window,error:String(error),reply:'Video render failed.'+(calls?'\n'+calls:'')};store.put('media-catchup',r.id,result);return result}store.put('media-catchup',r.id,{packetDigest,rendered})}
 if(!r.visualReviewId)return {...pending('Independent native/manual rendered-frame and word-count review required'),rendered};const review=verifiedEvidence<any>(store,'review',r.visualReviewId);object(review,['kind','project','packetDigest','videoArtifact','reviewedAt','method','frames']);date(review.reviewedAt);if(review.kind!=='media-catchup-visual'||review.project!==history.project||review.packetDigest!==packetDigest||review.videoArtifact!==rendered.video.artifact||!['native','manual'].includes(review.method))throw Error('Visual review video binding mismatch');store.readArtifact(review.videoArtifact);
 const frames=array(review.frames,10);if(frames.length!==rendered.frames.length)throw Error('Every rendered slide needs review');for(let i=0;i<frames.length;i++){const f=object(frames[i],['slide','artifact','addedWords','holdSeconds','readable','compositionValid']),actual=rendered.frames[i];hash(f.artifact);if(f.slide!==i||f.artifact!==actual.artifact||!Number.isSafeInteger(f.addedWords)||f.addedWords<0||f.addedWords!==video.slides[i]!.addedWords||f.holdSeconds!==actual.actualHoldSeconds||f.holdSeconds<Math.ceil(f.addedWords/3)||f.readable!==true||f.compositionValid!==true)throw Error('Invalid frame/word-count review');store.readArtifact(f.artifact)}
 if(sha(readFileSync(rendered.video.path))!==sha(store.readArtifact(rendered.video.artifact)))throw Error('Rendered embed bytes changed');
 if(Date.now()>=r.deadline)throw Error('Catchup deadline exhausted');
 const reply=(r.calls.length?'Waiting on you: '+r.calls.map(c=>escape(c.question)).join('; '):'Nothing waits on you.')+'\n\n<video controls src="'+rendered.video.path.replaceAll('\\','/').replaceAll('&','&amp;').replaceAll('"','&quot;')+'"></video>\n\n'+escape(r.remainingWork)+(calls?'\n\n'+calls:'');const result={status:'REVIEWED',verified:true,packetDigest,window,rendered,reply};store.put('media-catchup',r.id,{...result,rendered});return result;
}
