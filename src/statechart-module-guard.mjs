import {registerHooks} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative,parse,join} from 'node:path';
const manifest=JSON.parse(process.env.OMP_STATECHART_MANIFEST_FILE?readFileSync(process.env.OMP_STATECHART_MANIFEST_FILE,'utf8'):process.env.OMP_STATECHART_MANIFEST??'[]'),temporary=resolve(process.env.TMPDIR??process.env.TEMP),key=p=>process.platform==='win32'?p.toLowerCase():p;
const identify=url=>{if(!url?.startsWith('file:'))return;const path=realpathSync(fileURLToPath(url)),direct=manifest.find(f=>key(f.path)===key(path));if(direct)return direct;const suffix=relative(temporary,path).split(/[\\/]/);if(!/^statechart-inputs-[A-Za-z0-9_-]+$/.test(suffix[0]??''))return;return manifest.find(f=>{const root=parse(f.path).root,copy=join(temporary,suffix[0],root.replace(/\W+/g,''),relative(root,f.path));return key(copy)===key(path)})};
const verify=(url,file)=>{if(createHash('sha256').update(readFileSync(fileURLToPath(url))).digest('hex')!==file.sha256)throw Error('Frozen executable bytes changed');if(!file.approved)throw Error('Mapping dependency outside approved frozen inputs')};
registerHooks({resolve(specifier,context,next){const result=next(specifier,context),parent=identify(context.parentURL);if(parent){verify(context.parentURL,parent);if(parent.renderer&&result.url.startsWith('node:'))return result;const target=identify(result.url);if(!target||Boolean(target.renderer)!==Boolean(parent.renderer))throw Error('Mapping dependency outside approved frozen inputs: '+specifier);verify(result.url,target)}return result},load(url,context,next){const file=identify(url);if(file)verify(url,file);return next(url,context)}});
