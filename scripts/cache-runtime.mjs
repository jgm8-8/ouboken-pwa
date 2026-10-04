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
