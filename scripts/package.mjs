import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {zipSync} from 'fflate';
const root=resolve(import.meta.dirname,'..');
async function gather(folder,files={},skip=()=>false){
 for(const entry of await readdir(folder,{withFileTypes:true})){const absolute=resolve(folder,entry.name),name=relative(root,absolute).replaceAll('\\','/');if(skip(name))continue;if(entry.isDirectory())await gather(absolute,files,skip);else files[name]=new Uint8Array(await readFile(absolute))}return files;
}
await mkdir(resolve(root,'release'),{recursive:true});
const built=await gather(resolve(root,'dist'));
await writeFile(resolve(root,'release/ouboken-pwa-pages.zip'),zipSync(Object.fromEntries(Object.entries(built).map(([name,bytes])=>[name.slice(5),bytes])),{level:6}));
const source={};
for(const name of ['src','scripts','tests','models','public','.github','llm-worker'])await gather(resolve(root,name),source,n=>n==='public/ocr'||n==='public/THIRD_PARTY_NOTICES.txt'||n.split('/').some(part=>part.startsWith('.env')||part.startsWith('.dev.vars')||part==='.wrangler'));
for(const name of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','vite.config.ts','index.html','.gitignore','README.md','VERIFICATION.md'])source[name]=new Uint8Array(await readFile(resolve(root,name)));
await writeFile(resolve(root,'release/ouboken-pwa-source.zip'),zipSync(source,{level:6}));
console.log('release/ouboken-pwa-pages.zip (公開用)');console.log('release/ouboken-pwa-source.zip (独立した開発用プロジェクト)');
