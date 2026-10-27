import { lstatSync,realpathSync,readdirSync,readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,unlinkSync,statSync,openSync,closeSync } from 'node:fs';
import { resolve,relative,dirname,join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { contained,digest,safeRelative } from './contracts';
import { Store } from './state';
export function scoped(root:string,path:string):string{
 safeRelative(path);const base=realpathSync(root),dest=resolve(base,path);if(!contained(base,dest))throw Error('Path escape');
 let part=dest;for(;;){if(existsSync(part)&&lstatSync(part).isSymbolicLink())throw Error('Linked path forbidden');const parent=dirname(part);if(parent===part)break;part=parent}return dest;
}
export interface Snapshot {id:string;root:string;base:string;scope:string[];files:{path:string;hash:string;mode:number;size:number;artifact:string}[];index:{path:string;mode:string;object:string;artifact:string}[];gitStatus:string;}
const gitEnv=()=>{const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};for(const k of Object.keys(env))if(k.startsWith('GIT_')&&!['GIT_OPTIONAL_LOCKS','GIT_TERMINAL_PROMPT','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL'].includes(k))delete (env as any)[k];return env};
export function snapshot(store:Store,root:string,paths:string[]):Snapshot{
 const base=realpathSync(root),files:Snapshot['files']=[],index:Snapshot['index']=[],seen=new Set<string>();
 const scope=[...new Set(paths.map(safeRelative))].sort();
 const visit=(relativePath:string)=>{const p=scoped(base,relativePath);if(!existsSync(p))return;const stat=lstatSync(p);if(stat.isDirectory()){for(const e of readdirSync(p))visit(relativePath+'/'+e)}else if(stat.isFile()){const name=relative(base,p).replaceAll('\\','/');if(!seen.has(name)){const bytes=readFileSync(p);files.push({path:name,hash:digest(bytes.toString('base64')),mode:stat.mode,size:bytes.length,artifact:store.artifact(bytes)});seen.add(name)}}else throw Error('Unsupported file kind')};scope.forEach(visit);files.sort((a,b)=>a.path.localeCompare(b.path));
 const git=(args:string[])=>spawnSync('git',['-C',base,...args],{encoding:'utf8',timeout:10000,env:gitEnv()});
 const headResult=git(['rev-parse','HEAD']),head=headResult.status===0?headResult.stdout.trim():'';
 const statusResult=git(['status','--porcelain=v1','--untracked-files=all','--',...scope]);const gitStatus=statusResult.status===0?statusResult.stdout.trim():'';
 const entries=git(['ls-files','--stage','-z','--',...scope]);if(entries.status===0)for(const entry of entries.stdout.split('\0').filter(Boolean)){const match=entry.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);if(!match||match[3]!=='0')throw Error('Unmerged index cannot snapshot');const bytes=spawnSync('git',['-C',base,'cat-file','blob',match[2]!],{timeout:10000,env:gitEnv()});if(bytes.status!==0)throw Error('Index blob unavailable');index.push({path:match[4]!,mode:match[1]!,object:match[2]!,artifact:store.artifact(bytes.stdout)})}
 const data={root:base,base:head||digest('non-git'),scope,files,index,gitStatus};const snap={...data,id:digest(data)};store.put('snapshot',snap.id,snap);return snap;
}
export function materialize(store:Store,snap:Snapshot,destination:string){if(existsSync(destination)&&readdirSync(destination).length)throw Error('Materialization destination not empty');mkdirSync(destination,{recursive:true});for(const f of snap.files){const p=scoped(destination,f.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,store.readArtifact(f.artifact),{flag:'wx',mode:f.mode})}}
export function applyFiles(store:Store,base:Snapshot,candidate:Snapshot,liveRoot:string){
 const lock=join(realpathSync(liveRoot),'.omp-system-integration.lock');let lockFd:number;try{lockFd=openSync(lock,'wx',0o600)}catch{throw Error('Integration locked by another writer')}
 try{
 const current=snapshot(store,liveRoot,base.scope);if(current.id!==base.id)throw Error('Integration conflict; live snapshot changed');
 if(candidate.files.some(f=>!base.scope.some(s=>f.path===s||f.path.startsWith(s+'/'))))throw Error('New paths require explicit integration scope');
 const changes=candidate.files.filter(f=>base.files.find(b=>b.path===f.path)?.hash!==f.hash),deleted=base.files.filter(f=>!candidate.files.some(c=>c.path===f.path));
 const staged:{dest:string;temp:string;previous?:Buffer;mode?:number}[]=[];
 try{for(const f of changes){const dest=scoped(liveRoot,f.path);mkdirSync(dirname(dest),{recursive:true});const temp=dest+'.omp-system-'+randomUUID();const previous=existsSync(dest)?readFileSync(dest):undefined;writeFileSync(temp,store.readArtifact(f.artifact),{flag:'wx',mode:f.mode});staged.push({dest,temp,previous,mode:f.mode})}
 if(snapshot(store,liveRoot,base.scope).id!==base.id)throw Error('Integration conflict before apply');
 const applied:typeof staged=[];try{for(const item of staged){const expected=base.files.find(f=>f.path===relative(liveRoot,item.dest).replaceAll('\\','/'));if(expected?(!existsSync(item.dest)||digest(readFileSync(item.dest).toString('base64'))!==expected.hash):existsSync(item.dest))throw Error('Integration conflict during commit');renameSync(item.temp,item.dest);applied.push(item)}for(const f of deleted){const dest=scoped(liveRoot,f.path);if(!existsSync(dest)||digest(readFileSync(dest).toString('base64'))!==f.hash)throw Error('Integration delete conflict');unlinkSync(dest)}}catch(error){for(const item of applied.reverse()){const candidateFile=candidate.files.find(f=>f.path===relative(liveRoot,item.dest).replaceAll('\\','/'));if(existsSync(item.dest)&&candidateFile&&digest(readFileSync(item.dest).toString('base64'))!==candidateFile.hash)continue;if(item.previous)writeFileSync(item.dest,item.previous);else if(existsSync(item.dest))unlinkSync(item.dest)}for(const f of deleted)if(!existsSync(scoped(liveRoot,f.path)))writeFileSync(scoped(liveRoot,f.path),store.readArtifact(f.artifact));throw error}
 store.invalidate(base.id,'Integrated candidate replaces baseline');return [...changes,...deleted].map(f=>f.path);
 }finally{for(const item of staged)if(existsSync(item.temp))unlinkSync(item.temp)}
 }finally{closeSync(lockFd);if(existsSync(lock))unlinkSync(lock)}
}
export function fsTools(root:string,readScope:string[],writeScope:string[],onRead?:(path:string)=>void){const allowed=(p:string,scope:string[])=>scope.some(s=>p===s||p.startsWith(s+'/'));return [
 {name:'workspace_read',label:'Read scoped file',description:'Read UTF-8 file in declared read scope',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false},execute:async(_id:string,args:any)=>{if(!allowed(args.path,[...readScope,...writeScope]))throw Error('Read scope denied');const text=readFileSync(scoped(root,args.path),'utf8');onRead?.(args.path);return {content:[{type:'text',text}],details:{path:args.path}}}},
 {name:'workspace_write',label:'Write scoped file',description:'Write UTF-8 file only in declared writer scope',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false},execute:async(_id:string,args:any)=>{if(!allowed(args.path,writeScope)||typeof args.content!=='string')throw Error('Write scope denied');const dest=scoped(root,args.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,args.content);return {content:[{type:'text',text:'Saved '+args.path}],details:{path:args.path}}}}
 ] as any[];
}
