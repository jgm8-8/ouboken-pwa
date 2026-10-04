import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../dist');
async function walk(folder,prefix=''){let result=[];for(const name of await readdir(folder)){if(name==='sw.js'||name==='.nojekyll')continue;const p=join(folder,name);result.push(...(await stat(p)).isDirectory()?await walk(p,prefix+name+'/'):[prefix+name])}return result}
const files=(await walk(root)).sort(),hash=createHash('sha256');hash.update(await readFile(import.meta.filename));for(const name of files){hash.update(name);hash.update(await readFile(join(root,name)))}
const version=hash.digest('hex').slice(0,16);
await writeFile(join(root,'sw.js'),`
const PREFIX='ouboken-pwa-'+self.registration.scope;
const CACHE=PREFIX+'-${version}';
const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);try{for(const path of FILES){const url=new URL(path,self.registration.scope);const response=await fetch(new Request(url,{cache:'reload'}));const mime=response.headers.get('content-type')||'';if(!response.ok||(!path.endsWith('.html')&&mime.includes('text/html')))throw Error('Asset download failed');await cache.put(url,response)}}catch(error){await caches.delete(CACHE);throw error}})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);await self.clients.claim()})()));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE')self.skipWaiting()});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;event.respondWith((async()=>{const cache=await caches.open(CACHE);const match=await cache.match(event.request.mode==='navigate'?new URL('index.html',self.registration.scope):event.request,{ignoreVary:true});return match||fetch(event.request)})())});
`);
console.log('Offline cache:',files.length,'files, version',version);
