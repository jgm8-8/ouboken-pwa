export async function cacheHealth(storage,name,scope,files,sizes){
 const present=new Set();
 if(await storage.has(name)){const cache=await storage.open(name);for(const request of await cache.keys())present.add(request.url)}
 const missing=files.filter(path=>!present.has(new URL(path,scope).href));
 return {missing,bytes:files.reduce((sum,path)=>sum+(present.has(new URL(path,scope).href)?sizes[path]:0),0)};
}
export async function prepareCache(storage,name,scope,files,fetcher){
 const cache=await storage.open(name);
 for(const path of files){const url=new URL(path,scope);if(await cache.match(url,{ignoreVary:true}))continue;
  const response=await fetcher(new Request(url,{cache:'reload'}));const mime=response.headers.get('content-type')||'';
  if(!response.ok||(!path.endsWith('.html')&&mime.includes('text/html')))throw Error('ファイルを取得できませんでした。オンラインで再試行してください。');
  await cache.put(url,response);
 }
}

export async function workerCacheName(worker){
 return new Promise(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null)},1500);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(typeof e.data?.cache==='string'?e.data.cache:null)};try{worker.postMessage('CACHE_INFO',[channel.port2])}catch{clearTimeout(timer);channel.port1.close();resolve(null)}});
}
export async function pruneWorkerCaches(storage,prefix,own,registration,query){
 const live=()=>[registration.active,registration.waiting,registration.installing].filter(worker=>worker&&worker.state!=='redundant');
 const workers=live(),names=await Promise.all(workers.map(query));
 // Older workers do not identify their cache: preserve it until they activate or retire.
 if(names.some(name=>!name))return false;
 const same=()=>{const current=live();return current.length===workers.length&&current.every((worker,i)=>worker===workers[i])};
 if(!same())return false;const keep=new Set([own,...names]);
 for(const name of await storage.keys()){if(!same())return false;if(name.startsWith(prefix)&&!keep.has(name))await storage.delete(name)}return true;
}
