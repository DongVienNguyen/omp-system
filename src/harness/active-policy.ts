import {digest,type Certificate} from '../contracts';
import {requireCertificate} from '../gate';
import {Store} from '../state';
import type {Snapshot} from '../workspaces';
import type {Tree} from './recursion';
import {validateSurfaceTree} from './surfaces';
import type {ExecutableApproval} from './executable-authority';

/** Resolve once at workflow start; active policy changes only harness surfaces. */
export function resolveActiveHarness(store:Store,project:string,explicitTree:Tree|undefined,approvals:readonly ExecutableApproval[]=[]){
 const active=store.get<{candidate:string;certificate?:string}>('policy',project);
 if(!active){if(!explicitTree)throw Error('Explicit harness tree required without active policy');validateSurfaceTree(explicitTree,{executableCodeTrusted:true,approvals});return {tree:explicitTree,digest:digest(explicitTree),policy:null}}
 if(!active.certificate)throw Error('Active harness policy certificate missing');
 const resolved=certifiedHarnessTree(store,active.candidate,active.certificate,approvals);
 if(explicitTree&&digest(explicitTree)!==resolved.digest)throw Error('Explicit harness tree conflicts with active policy');
 return {...resolved,policy:{candidate:active.candidate,certificate:active.certificate}};
}
export function certifiedHarnessTree(store:Store,candidate:string,certificate:string,approvals:readonly ExecutableApproval[]=[]){
 const cert=store.get<Certificate>('certificate',certificate);if(!cert||cert.candidate!==candidate)throw Error('Active harness policy certificate mismatch');requireCertificate(store,cert.id,cert);
 const snap=store.get<Snapshot>('snapshot',candidate);if(!snap?.files.length)throw Error('Active harness snapshot missing');
 const tree:Record<string,string>={};for(const file of snap.files){const bytes=store.readArtifact(file.artifact);if(digest(bytes.toString('base64'))!==file.hash)throw Error('Active harness snapshot bytes changed');tree[file.path]=bytes.toString('utf8')}
 validateSurfaceTree(tree,{executableCodeTrusted:true,approvals});return {tree,digest:digest(tree)};
}
