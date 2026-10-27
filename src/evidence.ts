import { createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical,digest } from './contracts';
import type { Store } from './state';
const keys=new WeakMap<Store,Buffer>();
function key(store:Store){let k=keys.get(store);if(!k){const path=join(store.directory,'evidence.key');if(existsSync(path))k=readFileSync(path);else{k=randomBytes(32);writeFileSync(path,k,{flag:'wx',mode:0o600})}if(k.length!==32)throw Error('Invalid evidence signing key');keys.set(store,k)}return k}
/** Host-only boundary. Never expose signing or Store methods as worker tools. Not an OS sandbox. */
export function sealEvidence(store:Store,kind:'check'|'review'|'authority'|'certificate',id:string,body:unknown){const encoded=canonical(body);const signature=createHmac('sha256',key(store)).update(kind+'\0'+id+'\0'+encoded).digest('hex');store.put('sealed-'+kind,id,{body,signature});return body}
export function verifiedEvidence<T>(store:Store,kind:'check'|'review'|'authority'|'certificate',id:string):T{const record=store.get<any>('sealed-'+kind,id);if(!record||!record.body||typeof record.signature!=='string'||!/^[a-f0-9]{64}$/.test(record.signature))throw Error('Unattested '+kind+' evidence');const expected=createHmac('sha256',key(store)).update(kind+'\0'+id+'\0'+canonical(record.body)).digest();if(!timingSafeEqual(expected,Buffer.from(record.signature,'hex')))throw Error('Forged '+kind+' evidence');return record.body as T}
export const evidenceId=(candidate:string,id:string)=>candidate+':'+id;
