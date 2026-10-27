import { Database } from 'bun:sqlite';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical,digest,transitions,validateTasks,type Task,type State,type Certificate } from './contracts';
export class Store {
 readonly db:Database;readonly artifacts:string;
 constructor(readonly directory:string){
  mkdirSync(directory,{recursive:true});this.artifacts=join(directory,'artifacts');mkdirSync(this.artifacts,{recursive:true});this.db=new Database(join(directory,'state.sqlite'),{create:true,strict:true});
  this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  const version=(this.db.query('PRAGMA user_version').get() as any).user_version;if(version>1){this.db.close();throw Error('Unsupported newer state schema')}
  this.db.exec(`CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS leases(run TEXT NOT NULL,path TEXT NOT NULL,owner TEXT NOT NULL,PRIMARY KEY(run,path));PRAGMA user_version=1;`);
 }
 close(){this.db.close()}
 get<T>(kind:string,id:string):T|undefined{const r=this.db.query('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id) as any;return r?JSON.parse(r.body):undefined}
 list<T>(kind:string):T[]{return (this.db.query('SELECT body FROM records WHERE kind=? ORDER BY id').all(kind) as any[]).map(r=>JSON.parse(r.body))}
 put(kind:string,id:string,value:unknown){this.db.transaction(()=>{this.db.query('INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,revision=records.revision+1').run(kind,id,canonical(value));this.db.query('INSERT INTO events(kind,id,at,body) VALUES(?,?,?,?)').run(kind,id,Date.now(),canonical(value))})()}
 createRun(id:string,tasks:Task[],policy:unknown){validateTasks(tasks);this.db.transaction(()=>{if(this.get('run',id))throw Error('Run already exists');this.put('run',id,{id,generation:randomUUID(),policy:digest(policy),created:Date.now(),cancelled:false});for(const t of tasks)this.put('task',id+':'+t.id,{...t,run:id})})()}
 transition(run:string,id:string,next:State){return this.db.transaction(()=>{const key=run+':'+id;const task=this.get<Task & {error?:string;reason?:string}>('task',key);if(!task)throw Error('Unknown task');if(!transitions[task.state]?.includes(next))throw Error('Illegal transition '+task.state+' to '+next);if(next==='READY'&&task.depends_on.some(d=>!['LOCAL_VERIFIED','REMOTE_VERIFIED','DELIVERED'].includes(this.get<Task>('task',run+':'+d)?.state||'')))throw Error('Dependencies not verified');if(next==='RUNNING'&&(this.get<any>('run',run)?.cancelled))throw Error('Run cancelled');task.state=next;if(['READY','RUNNING','LOCAL_VERIFIED','CANCELLED'].includes(next)){delete task.error;delete task.reason}this.put('task',key,task);return task})()}
 artifact(bytes:string|Uint8Array):string {const buffer=typeof bytes==='string'?Buffer.from(bytes):Buffer.from(bytes);const hash=digest(buffer.toString('base64'));const dest=join(this.artifacts,hash);if(existsSync(dest)){if(!readFileSync(dest).equals(buffer))throw Error('Artifact collision');return hash}const temp=dest+'.'+randomUUID()+'.tmp';let fd:number|undefined;try{fd=openSync(temp,'wx',0o600);writeFileSync(fd,buffer);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,dest)}finally{if(fd!==undefined)closeSync(fd);if(existsSync(temp))unlinkSync(temp)}return hash}
 readArtifact(hash:string):Buffer{if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid artifact id');const b=readFileSync(join(this.artifacts,hash));if(digest(b.toString('base64'))!==hash)throw Error('Artifact corrupted');return b}
 invalidate(candidate:string,reason:string){for(const cert of this.list<Certificate>('certificate'))if(cert.candidate===candidate&&cert.valid)this.put('certificate',cert.id,{...cert,valid:false,reason})}
 lease(run:string,path:string,owner:string){this.db.transaction(()=>{const all=this.db.query('SELECT path,owner FROM leases WHERE run=?').all(run) as any[];const p=path.toLowerCase().replaceAll('\\','/');if(all.some(l=>l.owner!==owner&&(p===l.path||p.startsWith(l.path+'/')||l.path.startsWith(p+'/'))))throw Error('Writer scope overlap');this.db.query('INSERT OR IGNORE INTO leases(run,path,owner) VALUES(?,?,?)').run(run,p,owner)})()}
 release(run:string,owner:string){this.db.query('DELETE FROM leases WHERE run=? AND owner=?').run(run,owner)}
}
