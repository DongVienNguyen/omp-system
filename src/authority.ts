import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { digest } from './contracts';
import { Store } from './state';
import { sealEvidence,verifiedEvidence } from './evidence';
export interface ExecutionAuthority {id:string;action:'execute';project:string;run:string;specDigest:string;expires:number;mode:'operator-trusted-code';}
export function authorizeExecution(store:Store,spec:{id:string;project:string;budget:{deadline:number}},operatorConfirmed:boolean):ExecutionAuthority{
 if(!operatorConfirmed)throw Error('Operator confirmation required');if(!Number.isSafeInteger(spec.budget.deadline)||spec.budget.deadline<=Date.now())throw Error('Expired execution budget');
 const authority:ExecutionAuthority={id:randomUUID(),action:'execute',project:realpathSync(spec.project),run:spec.id,specDigest:digest(spec),expires:spec.budget.deadline,mode:'operator-trusted-code'};
 sealEvidence(store,'authority',authority.id,authority);return authority;
}
export function requireExecution(store:Store,id:string,spec:{id:string;project:string;budget:{deadline:number}}):ExecutionAuthority{
 const authority=verifiedEvidence<ExecutionAuthority>(store,'authority',id);
 if(authority.action!=='execute'||authority.mode!=='operator-trusted-code'||authority.project!==realpathSync(spec.project)||authority.run!==spec.id||authority.specDigest!==digest(spec)||authority.expires<=Date.now()||authority.expires!==spec.budget.deadline)throw Error('Execution authority mismatch/expired');return authority;
}
