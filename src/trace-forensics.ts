import {readFileSync,statSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {digest,safeRelative} from './contracts';
import {scoped} from './workspaces';
import type {Store} from './state';

export interface TraceRequest {action:'trace';id:string;project:string;paths:string[];before:string;after?:string;heapTarget?:number;deadline:number;}
type Row=Record<string,any>;
function object(v:unknown):asserts v is Row {if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Trace object required');}
function integer(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<0)throw Error('Invalid trace integer');return Number(v);}
function number(v:unknown){if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('Invalid trace number');return v;}
export function validateTraceRequest(value:unknown,project:string):TraceRequest {
 object(value);const v=value;
 if(Object.keys(v).some(k=>!['action','id','project','paths','before','after','heapTarget','deadline'].includes(k))||v.action!=='trace'||typeof v.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.id)||typeof v.project!=='string'||resolve(v.project)!==resolve(project))throw Error('Trace project/identity mismatch');
 if(!Array.isArray(v.paths)||!v.paths.length||v.paths.some((p:unknown)=>typeof p!=='string'))throw Error('Explicit trace read paths required');
 v.paths.forEach(safeRelative);
 for(const p of [v.before,...(v.after===undefined?[]:[v.after])])if(typeof p!=='string'||!v.paths.includes(p))throw Error('Capture must equal an explicit read path');
 if(v.after===v.before)throw Error('Paired captures must differ');
 if(v.heapTarget!==undefined)integer(v.heapTarget);
 if(!Number.isSafeInteger(v.deadline)||v.deadline<=Date.now())throw Error('Trace deadline required');
 return v as TraceRequest;
}
function tables(store:Store){store.db.exec(`
 CREATE TABLE IF NOT EXISTS trace_frames(capture TEXT NOT NULL,node INTEGER NOT NULL,parent INTEGER,name TEXT NOT NULL,url TEXT NOT NULL,line INTEGER NOT NULL,column_no INTEGER NOT NULL,PRIMARY KEY(capture,node));
 CREATE TABLE IF NOT EXISTS trace_samples(capture TEXT NOT NULL,ordinal INTEGER NOT NULL,node INTEGER NOT NULL,elapsed_us REAL NOT NULL,PRIMARY KEY(capture,ordinal));
 CREATE INDEX IF NOT EXISTS trace_samples_node ON trace_samples(capture,node);
 CREATE TABLE IF NOT EXISTS trace_heap_nodes(capture TEXT NOT NULL,node INTEGER NOT NULL,object_id INTEGER NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,self_bytes INTEGER NOT NULL,PRIMARY KEY(capture,node));
 CREATE TABLE IF NOT EXISTS trace_heap_edges(capture TEXT NOT NULL,source INTEGER NOT NULL,target INTEGER NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS trace_heap_target ON trace_heap_edges(capture,target);
 CREATE TABLE IF NOT EXISTS trace_events(capture TEXT NOT NULL,ordinal INTEGER NOT NULL,pid INTEGER NOT NULL,tid INTEGER NOT NULL,name TEXT NOT NULL,start_us REAL NOT NULL,duration_us REAL NOT NULL,url TEXT NOT NULL,line INTEGER NOT NULL,PRIMARY KEY(capture,ordinal));
 `);}
function frame(v:unknown){object(v);if(typeof v.functionName!=='string'||typeof v.url!=='string'||!Number.isInteger(v.lineNumber)||v.lineNumber< -1||!Number.isInteger(v.columnNumber)||v.columnNumber< -1)throw Error('Invalid source frame');return {name:v.functionName,url:v.url,line:v.lineNumber+1,column:v.columnNumber+1};}
function cpu(store:Store,capture:string,p:Row,tick:()=>void){
 if(!Array.isArray(p.nodes)||!p.nodes.length||!Array.isArray(p.samples)||!p.samples.length||!Array.isArray(p.timeDeltas)||p.samples.length!==p.timeDeltas.length)throw Error('Sampled CPU profile with timeDeltas required');
 const start=number(p.startTime),end=number(p.endTime);if(end<start)throw Error('CPU time range reversed');
 const nodes=new Map<number,Row>(),parents=new Map<number,number>();
 for(const n of p.nodes){tick();object(n);const id=integer(n.id);if(nodes.has(id))throw Error('Duplicate CPU node');frame(n.callFrame);nodes.set(id,n);if(n.children!==undefined&&!Array.isArray(n.children))throw Error('CPU children array required');for(const child of n.children??[]){integer(child);if(parents.has(child))throw Error('CPU node has multiple parents');parents.set(child,id)}}
 if([...parents.keys()].some(id=>!nodes.has(id)))throw Error('CPU child missing');
 const roots=[...nodes.keys()].filter(id=>!parents.has(id));if(roots.length!==1)throw Error('CPU profile requires one root');
 const reached=new Set<number>(),queue=[roots[0]!];for(let i=0;i<queue.length;i++){tick();const id=queue[i]!;if(reached.has(id))throw Error('CPU cycle');reached.add(id);queue.push(...(nodes.get(id)!.children??[]))}if(reached.size!==nodes.size)throw Error('CPU disconnected cycle');
 const insert=store.db.query('INSERT INTO trace_frames VALUES(?,?,?,?,?,?,?)');for(const [id,n]of nodes){const f=frame(n.callFrame);insert.run(capture,id,parents.get(id)??null,f.name,f.url,f.line,f.column)}
 const sample=store.db.query('INSERT INTO trace_samples VALUES(?,?,?,?)');let total=0,nonMonotonicSamples=0;for(let i=0;i<p.samples.length;i++){tick();const id=integer(p.samples[i]),elapsed=p.timeDeltas[i];if(typeof elapsed!=='number'||!Number.isSafeInteger(elapsed))throw Error('CPU signed integer timeDelta required');if(!nodes.has(id))throw Error('CPU sample references missing node');if(elapsed<0)nonMonotonicSamples++;total+=elapsed;sample.run(capture,i,id,elapsed)}if(total<0||total>end-start+1)throw Error('CPU sampled time outside capture range');
 const hot=store.db.query<Row,[string]>(`SELECT f.node,f.parent,f.name,f.url,f.line,f.column_no AS column,SUM(s.elapsed_us) AS self_us,COUNT(*) AS samples FROM trace_samples s JOIN trace_frames f ON f.capture=s.capture AND f.node=s.node WHERE s.capture=? GROUP BY f.node ORDER BY self_us DESC,f.node LIMIT 20`).all(capture);
 const top=hot[0]!,path:Row[]=[];let id:number|undefined=top.node;while(id!==undefined){const n=nodes.get(id)!,f=frame(n.callFrame);path.push({node:id,...f});id=parents.get(id)}
 return {format:'cpuprofile' as const,total_us:total,sampleCount:p.samples.length,nonMonotonicSamples,timingLimitation:nonMonotonicSamples?'Signed source deltas preserved; non-monotonic samples make per-frame timing inconclusive.':null,hot,hotPath:path.reverse(),sourceMapped:!!top.url&&top.line>0};
}
function heap(store:Store,capture:string,p:Row,target:number|undefined,tick:()=>void){
 object(p.snapshot);object(p.snapshot.meta);const m=p.snapshot.meta;
 if(!Array.isArray(m.node_fields)||!Array.isArray(m.edge_fields)||!Array.isArray(m.node_types)||!Array.isArray(m.edge_types)||!Array.isArray(p.nodes)||!Array.isArray(p.edges)||!Array.isArray(p.strings)||p.strings.some((s:unknown)=>typeof s!=='string'))throw Error('V8 heap metadata required');
 const nf=m.node_fields as string[],ef=m.edge_fields as string[],nw=nf.length,ew=ef.length;
 for(const k of ['type','name','id','self_size','edge_count'])if(!nf.includes(k))throw Error('Heap node field missing: '+k);
 for(const k of ['type','name_or_index','to_node'])if(!ef.includes(k))throw Error('Heap edge field missing: '+k);
 if(p.nodes.length%nw||p.edges.length%ew||p.snapshot.node_count!==p.nodes.length/nw||p.snapshot.edge_count!==p.edges.length/ew)throw Error('Heap count mismatch');
 const types=m.node_types[nf.indexOf('type')],edgeTypes=m.edge_types[ef.indexOf('type')];if(!Array.isArray(types)||!Array.isArray(edgeTypes))throw Error('Heap types required');
 const string=(index:unknown)=>{const s=p.strings[integer(index)];if(typeof s!=='string')throw Error('Heap string index invalid');return s;};
 const insert=store.db.query('INSERT INTO trace_heap_nodes VALUES(?,?,?,?,?,?)'),edge=store.db.query('INSERT INTO trace_heap_edges VALUES(?,?,?,?,?)');let cursor=0,total=0,targetIndex:number|undefined;const ids=new Set<number>();
 for(let i=0;i<p.nodes.length;i+=nw){tick();const get=(k:string)=>p.nodes[i+nf.indexOf(k)],id=integer(get('id')),size=integer(get('self_size')),type=types[integer(get('type'))],count=integer(get('edge_count'));if(typeof type!=='string'||ids.has(id))throw Error('Invalid heap node');ids.add(id);if(id===target)targetIndex=i/nw;total+=size;insert.run(capture,i/nw,id,string(get('name')),type,size);
  for(let j=0;j<count;j++){tick();if(cursor>=p.edges.length)throw Error('Heap edge count overflow');const getEdge=(k:string)=>p.edges[cursor+ef.indexOf(k)],type=edgeTypes[integer(getEdge('type'))],to=integer(getEdge('to_node'));if(typeof type!=='string'||to%nw||to>=p.nodes.length)throw Error('Invalid heap edge');const raw=getEdge('name_or_index'),name=type==='element'||type==='hidden'?String(integer(raw)):string(raw);edge.run(capture,i/nw,to/nw,name,type);cursor+=ew}
 }if(cursor!==p.edges.length)throw Error('Unused heap edges');
 const hot=store.db.query<Row,[string]>('SELECT node,object_id,name,type,self_bytes FROM trace_heap_nodes WHERE capture=? ORDER BY self_bytes DESC,node LIMIT 20').all(capture);
 if(target!==undefined&&targetIndex===undefined)throw Error('Requested heap object missing');
 const chosen=targetIndex??hot[0]?.node;if(chosen===undefined)throw Error('Empty heap');
 // V8 node zero is synthetic root. Weak edges do not retain objects.
 const incoming=store.db.query<Row,[string,number]>("SELECT source,name,type FROM trace_heap_edges WHERE capture=? AND target=? AND type<>'weak' ORDER BY source,name"),seen=new Set<number>([chosen]),queue=[chosen],toward=new Map<number,{target:number;name:string;type:string}>();
 for(let i=0;i<queue.length&&!seen.has(0);i++){tick();const n=queue[i]!;for(const e of incoming.all(capture,n)){if(seen.has(e.source))continue;seen.add(e.source);toward.set(e.source,{target:n,name:e.name,type:e.type});queue.push(e.source)}}
 const retainerChain:Row[]=[];if(seen.has(0)){let n=0;const get=store.db.query<Row,[string,number]>('SELECT object_id,name,type,self_bytes FROM trace_heap_nodes WHERE capture=? AND node=?');for(;;){tick();const edge=toward.get(n);retainerChain.push({node:n,...get.get(capture,n),...(edge?{edge:edge.name,edgeType:edge.type}:{})});if(!edge)break;n=edge.target}}
 return {format:'heapsnapshot' as const,total_bytes:total,nodeCount:p.nodes.length/nw,hot,retainerChain,sourceMapped:false,sourceLimitation:'Heap node names and retainers alone do not identify allocation source; allocation symbols must be supplied before diagnosis is confirmed.'};
}
function events(store:Store,capture:string,items:unknown[],tick:()=>void){
 const insert=store.db.query('INSERT INTO trace_events VALUES(?,?,?,?,?,?,?,?,?)'),stacks=new Map<string,Row[]>();let ordinal=0;
 const add=(e:Row,duration:number)=>{const data=e.args?.data??{},f=data.callFrame??data;insert.run(capture,ordinal++,integer(e.pid),integer(e.tid),e.name,number(e.ts),duration,typeof f.url==='string'?f.url:typeof f.scriptName==='string'?f.scriptName:'',Number.isInteger(f.lineNumber)&&f.lineNumber>=0?f.lineNumber+1:0)};
 for(const value of items){tick();object(value);const e=value;if(!['X','B','E'].includes(e.ph))continue;if(typeof e.name!=='string'&&e.ph!=='E')throw Error('Trace event name required');number(e.ts);const key=integer(e.pid)+':'+integer(e.tid);if(e.ph==='X')add(e,number(e.dur));else if(e.ph==='B'){const stack=stacks.get(key)??[];stack.push(e);stacks.set(key,stack)}else{const begin=stacks.get(key)?.pop();if(!begin||e.ts<begin.ts)throw Error('Unmatched trace end');add(begin,e.ts-begin.ts)}}
 if([...stacks.values()].some(s=>s.length))throw Error('Unclosed trace event');if(!ordinal)throw Error('No supported duration events; sampled Chrome profiles require cpuprofile export');
 const hot=store.db.query<Row,[string]>('SELECT pid,tid,name,url,line,SUM(duration_us) AS inclusive_us,COUNT(*) AS occurrences FROM trace_events WHERE capture=? GROUP BY pid,tid,name,url,line ORDER BY inclusive_us DESC,pid,tid,name LIMIT 20').all(capture);
 return {format:'chrome-trace' as const,eventCount:ordinal,hot,sourceMapped:!!hot[0]?.url&&hot[0]?.line>0,measurement:'Inclusive event durations; nested events overlap and must not be summed as wall time.'};
}
export function runTraceForensics(value:unknown,store:Store,project:string){return store.db.transaction(()=>analyzeTrace(value,store,project))();}
function analyzeTrace(value:unknown,store:Store,project:string){
 const request=validateTraceRequest(value,project);if(store.get('catalog-operator',request.id))throw Error('Trace ID already exists');tables(store);
 const tick=()=>{if(Date.now()>=request.deadline)throw Error('Trace deadline exhausted');};
 const parse=(path:string)=>{tick();const source=scoped(project,path);if(!statSync(source).isFile()||statSync(source).size>256*1024**2)throw Error('Capture must be a file at most 256 MiB');const bytes=readFileSync(source);const artifact=store.artifact(bytes),capture=request.id+':'+path;
  // ponytail: bounded in-memory JSON, 256 MiB per decoded capture; use streaming parser for larger captures.
  if(bytes.length>256*1024**2)throw Error('Capture exceeds 256 MiB parser limit');const decoded=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes,{maxOutputLength:256*1024**2}):bytes;let data:unknown;try{data=JSON.parse(decoded.toString('utf8'))}catch{throw Error('Unsupported capture: expected cpuprofile, V8 heapsnapshot or Chrome JSON trace (optionally gzip); no capture rerun performed')}
  const report=store.db.transaction(()=>{if(Array.isArray(data))return events(store,capture,data,tick);object(data);if(data.snapshot)return heap(store,capture,data,request.heapTarget,tick);if(Array.isArray(data.nodes)&&Array.isArray(data.samples))return cpu(store,capture,data,tick);if(Array.isArray(data.traceEvents))return events(store,capture,data.traceEvents,tick);throw Error('Unsupported trace JSON format')})();
  tick();if(digest(readFileSync(scoped(project,path)).toString('base64'))!==digest(bytes.toString('base64')))throw Error('Capture changed during analysis');return {capture,path,artifact,...report};
 };
 const before=parse(request.before),after=request.after?parse(request.after):undefined;if(after&&before.format!==after.format)throw Error('Paired capture formats differ');
 const metric=before.format==='cpuprofile'?'self_us':before.format==='chrome-trace'?'inclusive_us':'self_bytes';
 const aggregate=(capture:string):Row[]=>before.format==='cpuprofile'?store.db.query<Row,[string]>('SELECT f.name,f.url,f.line,f.column_no AS column,SUM(s.elapsed_us) AS value FROM trace_samples s JOIN trace_frames f ON f.capture=s.capture AND f.node=s.node WHERE s.capture=? GROUP BY f.name,f.url,f.line,f.column_no').all(capture):before.format==='chrome-trace'?store.db.query<Row,[string]>('SELECT name,url,line,SUM(duration_us) AS value FROM trace_events WHERE capture=? GROUP BY name,url,line').all(capture):store.db.query<Row,[string]>('SELECT type,name,SUM(self_bytes) AS value FROM trace_heap_nodes WHERE capture=? GROUP BY type,name').all(capture);
 const comparison=after?(()=>{const key=(r:Row)=>JSON.stringify([r.type??'',r.name,r.url??'',r.line??0,r.column??0]);const a=new Map(aggregate(before.capture).map(r=>[key(r),r])),b=new Map(aggregate(after.capture).map(r=>[key(r),r]));return [...new Set([...a.keys(),...b.keys()])].map(k=>({frame:b.get(k)??a.get(k)!,metric,before:a.get(k)?.value??0,after:b.get(k)?.value??0,delta:(b.get(k)?.value??0)-(a.get(k)?.value??0)})).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));})():undefined;
 const result={action:'trace',id:request.id,project:resolve(project),before,after,comparison,assessment:after?'PAIRED_COMPARISON':'HYPOTHESIS',confirmedCause:false,reexecuted:false,throughputCheckpoint:'throughput checkpoint: n/a, read-only forensics',limitations:[...(!before.sourceMapped||after&&!after.sourceMapped?['Source mapping missing for selected hot object/event; not a source-level diagnosis.']:[]),'Paired delta alone does not prove causality or matching workload.'],database:store.directory};
 tick();for(const capture of [before,...after?[after]:[]])if(!readFileSync(scoped(project,capture.path)).equals(store.readArtifact(capture.artifact)))throw Error('Capture changed before publication');store.put('catalog-operator',request.id,result);return result;
}
