import {readBackup} from './store';
import {CHECKPOINT,checkpoint} from './checkpoint';
import type {State} from './store';
export function dataProblems(state:State,images:Map<string,Blob>,hasState:boolean,previous:{saved?:boolean,ids?:string[]}={}){
 const messages:string[]=[];
 if(previous.saved&&!hasState)messages.push('保存した応募データが見つかりません。バックアップから復元してください。');
 else if(previous.ids?.some(id=>!state.tickets.some(t=>t.id===id)))messages.push('以前保存した応募券の一部が見つかりません。バックアップを確認してください。');
 const missing=new Set(state.tickets.flatMap(t=>[t.image,t.crop]).filter(name=>!images.get(name)?.size));
 if(missing.size)messages.push(`保存画像が${missing.size}ファイル不足しています。バックアップの復元、または該当する券の削除・再追加が必要です。`);
 return messages;
}
export const cachePrefix=(scope:string)=>'ouboken-pwa-'+scope+'-';
export async function deleteAppCaches(storage:CacheStorage,scope:string){for(const name of await storage.keys())if(name.startsWith(cachePrefix(scope)))await storage.delete(name)}
export const appScope=()=>new URL(import.meta.env.BASE_URL,location.href).href;
export type CacheHealth={missing:string[],bytes:number};
export async function workerRequest(action:string):Promise<CacheHealth|null>{
 if(!('serviceWorker'in navigator))return null;
 const registration=await navigator.serviceWorker.getRegistration(appScope()),worker=registration?.active;
 if(!worker)return null;
 return new Promise((resolve,reject)=>{const channel=new MessageChannel();const timeout=setTimeout(()=>{channel.port1.close();if(action==='REPAIR')reject(Error('再準備に時間がかかっています。オンラインで再試行してください'));else resolve(null)},action==='REPAIR'?180000:4000);
  channel.port1.onmessage=e=>{clearTimeout(timeout);channel.port1.close();if(e.data.error)reject(Error(e.data.error));else resolve(e.data)};
  worker.postMessage(action,[channel.port2]);
 });
}
export async function inspectStorage(measure=false){
 const {state,images,hasState}=await readBackup();let previous={};try{previous=JSON.parse(localStorage.getItem(CHECKPOINT)||'{}')}catch{}
 const messages=dataProblems(state,images,hasState,previous);
 if(hasState&&!(previous as {saved?:boolean}).saved)checkpoint(state);
 const health=await workerRequest('HEALTH');
 if(health?.missing.length)messages.push(`オフライン用ファイルが${health.missing.length}個不足しています。設定の「キャッシュを再準備」を押してください。`);
 let cacheBytes=health?.bytes??0;
 if(measure&&'caches'in window){cacheBytes=0;for(const name of await caches.keys())if(name.startsWith(cachePrefix(appScope()))){const cache=await caches.open(name);for(const request of await cache.keys()){const response=await cache.match(request);if(!response?.body)continue;const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;cacheBytes+=value.byteLength}}finally{reader.releaseLock()}}}}
 const dataBytes=new Blob([JSON.stringify(state)]).size+[...images.values()].reduce((sum,blob)=>sum+blob.size,0);
 return {messages,cacheBytes,dataBytes,total:cacheBytes+dataBytes,cacheAvailable:!!health};
}
