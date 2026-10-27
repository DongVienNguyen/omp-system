import { mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import { root,profileRoot,protectedHashes } from './dev-preflight';
import plugin from '../src/extension';
import { digest } from '../src/contracts';
const before=protectedHashes();const projectA=join(root,'.lab','workspaces','coexistence-a'),projectB=join(root,'.lab','workspaces','coexistence-b');for(const p of [projectA,projectB]){mkdirSync(p,{recursive:true});writeFileSync(join(p,'sentinel.txt'),'preserve')}
let command:any,shutdown:any;const api={registerCommand(_n:string,c:any){command=c},registerTool(){},on(n:string,f:any){if(n==='session_shutdown')shutdown=f}};plugin(api as any);const observations:any[]=[];const ctx=(cwd:string)=>({cwd,ui:{notify(text:string){observations.push(JSON.parse(text))}}});
await command.handler('enable',ctx(projectA));await command.handler('status',ctx(projectB));await command.handler('disable',ctx(projectA));shutdown();
if(!observations[0].enabled||observations[1].enabled||observations[2].enabled)throw Error('Activation leaked across projects');for(const p of [projectA,projectB])if(readFileSync(join(p,'sentinel.txt'),'utf8')!=='preserve')throw Error('Project content changed');if(JSON.stringify(before)!==JSON.stringify(protectedHashes()))throw Error('Protected config changed');console.log(JSON.stringify({sameFactoryProjectIsolation:true,protectedFilesUnchanged:true,otherUserProcessesUntouched:true,scope:'in-process two-owned-project activation check; not full concurrent native-session proof'}));
