import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {Store} from '../src/state';
import {runTraceForensics,validateTraceRequest} from '../src/trace-forensics';
const dir=mkdtempSync(join(tmpdir(),'trace-check-')),store=new Store(join(dir,'state'));
const callFrame=(functionName:string,url='',lineNumber=-1)=>({functionName,url,lineNumber,columnNumber:0});
const profile=(time:number)=>({startTime:0,endTime:time,nodes:[{id:1,callFrame:callFrame('(root)'),children:[2]},{id:2,callFrame:callFrame('work','file:///app.ts',8)}],samples:[2],timeDeltas:[time]});
const request=(id:string,before:string,after?:string)=>({action:'trace',id,project:dir,paths:[before,...after?[after]:[]],before,after,deadline:Date.now()+10000});
try{
 writeFileSync(join(dir,'before.cpuprofile'),JSON.stringify(profile(100)));writeFileSync(join(dir,'after.json.gz'),gzipSync(JSON.stringify(profile(40))));
 const result=runTraceForensics(request('paired','before.cpuprofile','after.json.gz'),store,dir);
 assert.equal(result.before.format,'cpuprofile');assert.equal(result.before.hot[0]!.self_us,100);assert.equal(result.before.hot[0]!.line,9);assert.equal(result.comparison![0]!.delta,-60);assert.equal(result.confirmedCause,false);
 assert.equal(store.db.query<{n:number},[]>('SELECT COUNT(*) AS n FROM trace_samples').get()!.n,2);
 const signed={...profile(100),samples:[2,2,2],timeDeltas:[60,-10,50]};writeFileSync(join(dir,'signed.json'),JSON.stringify(signed));const timing=runTraceForensics(request('signed','signed.json'),store,dir);if(timing.before.format==='cpuprofile'){assert.equal(timing.before.total_us,100);assert.equal(timing.before.nonMonotonicSamples,1);assert.equal(store.db.query<{elapsed_us:number},[]>('SELECT elapsed_us FROM trace_samples WHERE capture=\'signed:signed.json\' AND ordinal=1').get()!.elapsed_us,-10)}
 const bad=profile(100);bad.nodes[1]!.children=[1];writeFileSync(join(dir,'bad.json'),JSON.stringify(bad));assert.throws(()=>runTraceForensics(request('cycle','bad.json'),store,dir),/root|cycle/);
 assert.equal(store.db.query<{n:number},[]>('SELECT COUNT(*) AS n FROM trace_frames WHERE capture LIKE \'cycle:%\'').get()!.n,0);
 writeFileSync(join(dir,'invalid.json'),'{}');assert.throws(()=>runTraceForensics(request('atomic','before.cpuprofile','invalid.json'),store,dir),/Unsupported/);assert.equal(store.db.query<{n:number},[]>('SELECT COUNT(*) AS n FROM trace_samples WHERE capture LIKE \'atomic:%\'').get()!.n,0);
 assert.throws(()=>validateTraceRequest({...request('escape','before.cpuprofile'),before:'../outside'},dir),/read path/);
 const heap={snapshot:{node_count:3,edge_count:2,meta:{node_fields:['type','name','id','self_size','edge_count'],node_types:[['synthetic','object']],edge_fields:['type','name_or_index','to_node'],edge_types:[['property','weak']]}},nodes:[0,0,1,0,1,1,1,3,10,1,1,2,5,100,0],edges:[0,3,5,0,4,10],strings:['root','holder','leak','held','value']};
 writeFileSync(join(dir,'heap.json'),JSON.stringify(heap));const retained=runTraceForensics({...request('heap','heap.json'),heapTarget:5},store,dir);assert.equal(retained.before.format,'heapsnapshot');if(retained.before.format==='heapsnapshot'){assert.deepEqual(retained.before.retainerChain.map(r=>r.object_id),[1,3,5]);assert.equal(retained.before.sourceMapped,false)}
 heap.edges[3]=1;writeFileSync(join(dir,'weak.json'),JSON.stringify(heap));const weak=runTraceForensics({...request('weak','weak.json'),heapTarget:5},store,dir);if(weak.before.format==='heapsnapshot')assert.deepEqual(weak.before.retainerChain,[]);
 writeFileSync(join(dir,'trace.json'),JSON.stringify({traceEvents:[{ph:'B',pid:1,tid:1,ts:10,name:'layout',args:{data:{url:'file:///ui.ts',lineNumber:4}}},{ph:'X',pid:1,tid:2,ts:12,dur:5,name:'paint'},{ph:'E',pid:1,tid:1,ts:30}]}));const trace=runTraceForensics(request('events','trace.json'),store,dir);assert.equal(trace.before.hot[0]!.inclusive_us,20);assert.equal(trace.before.hot[0]!.line,5);
 const wide=(after:boolean)=>({traceEvents:Array.from({length:25},(_,i)=>({ph:'X',pid:1,tid:1,ts:i*100,dur:after?i+1:0,name:'event-'+i,args:{data:{url:'app.ts',lineNumber:i}}}))});writeFileSync(join(dir,'wide-before.json'),JSON.stringify(wide(false)));writeFileSync(join(dir,'wide-after.json'),JSON.stringify(wide(true)));const all=runTraceForensics(request('wide','wide-before.json','wide-after.json'),store,dir);assert.equal(all.comparison!.find(r=>r.frame.name==='event-0')!.delta,1);assert.equal(all.comparison!.find(r=>r.frame.name==='event-24')!.delta,25);assert.equal(all.comparison!.reduce((n,r)=>n+r.delta,0),325);
 console.log('trace-forensics: sampled time, paired delta, source line, SQLite rows, invalid graph rollback, scope denial, strong/weak retainer paths, nested duration events PASS');
}finally{store.close();rmSync(dir,{recursive:true,force:true})}
