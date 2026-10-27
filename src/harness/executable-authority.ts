import { digest } from '../contracts';
export interface ExecutableApproval {path:string;sha256:string;expires:number;purpose:'harness-surface';}
export function requireExecutableApproval(path:string,body:string,approvals:readonly ExecutableApproval[]){const approval=approvals.find(a=>a.path===path&&a.sha256===digest(body)&&a.purpose==='harness-surface'&&a.expires>Date.now());if(!approval)throw Error('Executable surface requires operator approval for exact path/content digest: '+path);return approval}
