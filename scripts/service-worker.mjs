import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {cacheHealth,prepareCache,workerCacheName,pruneWorkerCaches} from './cache-runtime.mjs';
const root=resolve(import.meta.dirname,'../dist');
async function walk(folder,prefix=''){let result=[];for(const name of await readdir(folder)){if(name==='sw.js'||name==='.nojekyll')continue;const p=join(folder,name);result.push(...(await stat(p)).isDirectory()?await walk(p,prefix+name+'/'):[prefix+name])}return result}
const files=(await walk(root)).sort(),sizes={},hash=createHash('sha256');hash.update(await readFile(import.meta.filename));hash.update(await readFile(new URL('./cache-runtime.mjs',import.meta.url)));for(const name of files){const bytes=await readFile(join(root,name));sizes[name]=bytes.length;hash.update(name);hash.update(bytes)}
const version=hash.digest('hex').slice(0,16);
await writeFile(join(root,'sw.js'),`
const PREFIX='ouboken-pwa-'+self.registration.scope+'-';
const CACHE=PREFIX+'${version}';
const FILES=${JSON.stringify(files)};
const SIZES=${JSON.stringify(sizes)};
${cacheHealth.toString()}
${prepareCache.toString()}
${workerCacheName.toString()}
${pruneWorkerCaches.toString()}
const prune=()=>pruneWorkerCaches(caches,PREFIX,CACHE,self.registration,workerCacheName);
self.addEventListener('install',event=>event.waitUntil((async()=>{try{await prepareCache(caches,CACHE,self.registration.scope,FILES,fetch)}catch(error){await caches.delete(CACHE);throw error}})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{await prune();await self.clients.claim()})()));
self.addEventListener('message',event=>{if(event.data==='CACHE_INFO'){event.ports[0]?.postMessage({cache:CACHE});return}if(event.data==='PRUNE'){event.waitUntil(prune());return}if(event.data==='ACTIVATE'){self.skipWaiting();return}if(!['HEALTH','REPAIR'].includes(event.data))return;event.waitUntil((async()=>{try{await prune();if(event.data==='REPAIR')await prepareCache(caches,CACHE,self.registration.scope,FILES,fetch);event.ports[0]?.postMessage(await cacheHealth(caches,CACHE,self.registration.scope,FILES,SIZES))}catch(error){event.ports[0]?.postMessage({error:error.message})}})())});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;event.respondWith((async()=>{const cache=await caches.open(CACHE);const match=await cache.match(event.request.mode==='navigate'?new URL('index.html',self.registration.scope):event.request,{ignoreVary:true});return match||fetch(event.request)})())});
`);
console.log('Offline cache:',files.length,'files, version',version);
