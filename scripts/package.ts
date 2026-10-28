import { readdirSync,lstatSync,readFileSync,mkdirSync,writeFileSync,copyFileSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './dev-preflight';
const destination=join(root,'.lab','packages',Date.now().toString());mkdirSync(destination,{recursive:true});const files:string[]=[];
function copy(relative:string){const from=join(root,relative),s=lstatSync(from);if(s.isSymbolicLink())throw Error('Refusing package symlink');if(s.isDirectory()){for(const name of readdirSync(from))copy(relative+'/'+name)}else if(s.isFile()){if(/(^|\/)(node_modules|\.lab|\.git|\.env)(\/|$)|\.test\.ts$/.test(relative))return;const bytes=readFileSync(from);if(/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(bytes.toString('utf8')))throw Error('Secret in '+relative);mkdirSync(dirname(join(destination,relative)),{recursive:true});copyFileSync(from,join(destination,relative));files.push(relative)}}
for(const file of ['src','vendor','schemas','package.json','bun.lock','LICENSE','NOTICE','README.md','compatibility.lock.json','upstream.lock.json','pstack-fidelity.json'])copy(file);
const manifest=files.map(p=>({path:p,sha256:createHash('sha256').update(readFileSync(join(destination,p))).digest('hex')}));writeFileSync(join(destination,'package-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({destination,files:manifest.length,version:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version}));
