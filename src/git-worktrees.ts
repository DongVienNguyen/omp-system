import { spawnSync } from 'node:child_process';
import { existsSync,readdirSync,realpathSync,readFileSync,writeFileSync,mkdirSync,lstatSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contained } from './contracts';
function git(repo:string,args:string[]){const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};for(const k of Object.keys(env))if(k.startsWith('GIT_')&&!['GIT_TERMINAL_PROMPT','GIT_OPTIONAL_LOCKS'].includes(k))delete (env as any)[k];const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8',timeout:20000,env});if(result.status!==0)throw Error('Git operation failed: '+result.stderr);return result.stdout.trim()}
export function createWorktree(repository:string,workspaceRoot:string,baseCommit:string){
 const repo=realpathSync(repository);if(!/^[a-f0-9]{40}$/.test(baseCommit))throw Error('Exact base commit required');const resolved=git(repo,['rev-parse',baseCommit+'^{commit}']);if(resolved!==baseCommit)throw Error('Commit identity mismatch');
 mkdirSync(workspaceRoot,{recursive:true});const root=realpathSync(workspaceRoot);if(contained(repo,root)||contained(root,repo))throw Error('Worktree root must not overlap source repository');
 const id=randomUUID(),destination=join(root,id);git(repo,['worktree','add','--detach',destination,baseCommit]);const record={owner:'omp-system/worktree-v1',id,repository:repo,destination:realpathSync(destination),base:baseCommit};writeFileSync(join(root,id+'.owner.json'),JSON.stringify(record));return record;
}
export function removeWorktree(record:{owner:string;id:string;repository:string;destination:string;base:string},workspaceRoot:string){
 if(record.owner!=='omp-system/worktree-v1'||!contained(realpathSync(workspaceRoot),record.destination)||lstatSync(record.destination).isSymbolicLink())throw Error('Foreign worktree');const owner=JSON.parse(readFileSync(join(workspaceRoot,record.id+'.owner.json'),'utf8'));if(JSON.stringify(owner)!==JSON.stringify(record))throw Error('Worktree ownership mismatch');
 if(git(record.repository,['-C',record.destination,'status','--porcelain=v1','--untracked-files=all']))throw Error('Dirty or untracked worktree retained');if(git(record.destination,['rev-parse','HEAD'])!==record.base)throw Error('Unlanded worktree commit retained');git(record.repository,['worktree','remove',record.destination]);
}
