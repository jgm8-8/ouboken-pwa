export type Answers=Record<string,string|string[]>;
export type Payload={profile:Record<string,string>,answers:Answers,character:string,code:string,code2:string,codes_only?:boolean};
export type History={state:string,note:string,created:string,snapshot:Payload|null};
export type RawTicket={id:string,hash:string,filename:string,image:string,crop:string,thumbnail?:string,code:string,code2:string,qr:string,ocr:{candidates:{text:string,confidence:number,box:number[][]}[],lines:string[]},state:string,answers:Answers,approved:number,character:string,note:string,created:string,payload:Payload|null,history:History[],ocr_pending?:boolean,writing_notes?:import('./writing').WritingNotes};
export type State={version:1,profile:Record<string,string>,survey:{answers?:Answers,character?:string,notes?:Record<string,string>},tickets:RawTicket[]};
export const emptyState=():State=>({version:1,profile:{},survey:{},tickets:[]});
import {checkpoint,CHECKPOINT} from './checkpoint';
import {configureLlm} from './llm';
import {watchTransaction,storageWaitMs,storageWaitError} from './idb-transaction';
const DB_NAME='ouboken-pwa-v1';
let opening:Promise<IDBDatabase>|undefined;
let connected:IDBDatabase|undefined;
let sessionEpoch:string|null=null;
let epochInitialized=false;
function disconnect(db:IDBDatabase){if(connected===db){connected=undefined;opening=undefined}try{db.close()}catch{}}
function database(){
 if(!opening){
  const task=new Promise<IDBDatabase>((resolve,reject)=>{
   let active=true,db:IDBDatabase|undefined;
   const fail=(error:unknown)=>{if(!active)return;active=false;clearTimeout(timer);if(db)disconnect(db);reject(error)};
   const timer=setTimeout(()=>fail(storageWaitError()),storageWaitMs);
   const request=indexedDB.open(DB_NAME,1);
   request.onupgradeneeded=()=>{if(!active){request.transaction?.abort();return}request.result.createObjectStore('state');request.result.createObjectStore('images')};
   request.onsuccess=()=>{
    db=request.result;if(!active){db.close();return}connected=db;
    db.onversionchange=()=>disconnect(db!);db.onclose=()=>disconnect(db!);
    try{const tx=db.transaction('state'),epoch=tx.objectStore('state').get('reset_epoch');let value:string|null=null;
     epoch.onsuccess=()=>{value=epoch.result??null};
     tx.oncomplete=()=>{if(!active)return;active=false;clearTimeout(timer);if(!epochInitialized){sessionEpoch=value;epochInitialized=true}resolve(db!)};
     tx.onabort=()=>fail(storageError(tx.error));
    }catch(error){fail(error)}
   };
   request.onerror=()=>fail(Error('この端末に保存できません。通常のSafariから開いてください。'));
   request.onblocked=()=>fail(Error('別のOuboken画面を閉じてから再読み込みしてください。'));
  });opening=task;void task.catch(()=>{if(opening===task)opening=undefined});
 }
 return opening;
}
function transaction(db:IDBDatabase,stores:string|string[],mode:IDBTransactionMode='readonly'){
 try{return db.transaction(stores,mode)}catch(error){disconnect(db);throw storageError(error instanceof DOMException?error:null)}
}
function storageError(error:DOMException|null){return Error(error?.name==='QuotaExceededError'?'端末の保存容量が不足しています。写真の追加を止めてバックアップしてください。':'保存できませんでした。入力を残したまま再試行してください。')}
export async function readState():Promise<State>{
 const db=await database();return new Promise((resolve,reject)=>{const tx=transaction(db,'state');let value=emptyState();const watch=watchTransaction(tx,()=>value,resolve,reject,()=>disconnect(db),()=>storageError(tx.error));const request=tx.objectStore('state').get('main');request.onsuccess=()=>{if(watch.active()){watch.touch();value=request.result??emptyState()}}});
}
// Read, validate, and write in one IndexedDB transaction, including across tabs.
export async function mutate<T>(fn:(state:State,images:IDBObjectStore)=>T,reset=false,maintenance=false):Promise<T>{
 const db=await database();return new Promise<T>((resolve,reject)=>{
  const tx=transaction(db,['state','images'],'readwrite');let result:T,problem:unknown,written:State;let resetEpoch:string|undefined;
  const watch=watchTransaction(tx,()=>{if(resetEpoch)sessionEpoch=resetEpoch;if(!maintenance)checkpoint(written);if(typeof window!=='undefined')window.dispatchEvent(new Event('ouboken-data-changed'));return result},resolve,reject,()=>disconnect(db),()=>problem??storageError(tx.error));
  const store=tx.objectStore('state');let currentEpoch:string|null=null;const epoch=store.get('reset_epoch');epoch.onsuccess=()=>{watch.touch();currentEpoch=epoch.result??null};const request=store.get('main');
  request.onsuccess=()=>{if(!watch.active())return;watch.touch();try{if(currentEpoch!==sessionEpoch)throw Error('別の画面でデータが削除されました。再読み込みしてください。');const state:State=request.result??emptyState();result=fn(state,tx.objectStore('images'));if(request.result||!maintenance)store.put(state,'main');written=state;if(reset){resetEpoch=crypto.randomUUID();store.put(resetEpoch,'reset_epoch')}}catch(e){problem=e;tx.abort()}};
 });
}
export async function readImages():Promise<Map<string,Blob>>{
 const db=await database();return new Promise((resolve,reject)=>{
  const result=new Map<string,Blob>();const tx=transaction(db,'images');const watch=watchTransaction(tx,()=>result,resolve,reject,()=>disconnect(db),()=>storageError(tx.error));const request=tx.objectStore('images').openCursor();
  request.onsuccess=()=>{if(!watch.active())return;watch.touch();const cursor=request.result;if(cursor){result.set(String(cursor.key),cursor.value);cursor.continue()}};
 });
}
export async function readBackup(){
 const db=await database();return new Promise<{state:State,images:Map<string,Blob>,hasState:boolean}>((resolve,reject)=>{
  const tx=transaction(db,['state','images']);let state:State=emptyState(),hasState=false;const images=new Map<string,Blob>();
  const watch=watchTransaction(tx,()=>({state,images,hasState}),resolve,reject,()=>disconnect(db),()=>storageError(tx.error));
  const stateRequest=tx.objectStore('state').get('main');stateRequest.onsuccess=()=>{if(!watch.active())return;watch.touch();hasState=!!stateRequest.result;state=stateRequest.result??emptyState()};
  const request=tx.objectStore('images').openCursor();request.onsuccess=()=>{if(!watch.active())return;watch.touch();const c=request.result;if(c){images.set(String(c.key),c.value);c.continue()}};
 });
}
const urls=new Map<string,string>();
export function imageUrl(name:string){return urls.get(name)||''}
export async function primeImages(names?:string[]){
 if(names){for(const name of new Set(names.filter(Boolean)))if(!urls.has(name)){const blob=await readImage(name);if(blob)urls.set(name,URL.createObjectURL(blob))}return}
 const images=await readImages();releaseImageUrls([...urls.keys()].filter(name=>!images.has(name)));for(const [name,blob] of images)if(!urls.has(name))urls.set(name,URL.createObjectURL(blob));
}
export function clearImageUrls(){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear()}
export function releaseImageUrls(names:string[]){for(const name of names){const url=urls.get(name);if(url)URL.revokeObjectURL(url);urls.delete(name)}}
export function now(){return new Date().toISOString().slice(0,19).replace('T',' ')}
export function uniqueId(){return crypto.randomUUID()}
export async function digest(value:BufferSource){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',value));return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')}

export async function readImage(name:string):Promise<Blob|undefined>{const db=await database();return new Promise((resolve,reject)=>{const tx=transaction(db,'images');let value:Blob|undefined;const watch=watchTransaction(tx,()=>value,resolve,reject,()=>disconnect(db),()=>storageError(tx.error));const request=tx.objectStore('images').get(name);request.onsuccess=()=>{if(watch.active()){watch.touch();value=request.result}}})}
export function cacheImageUrl(name:string,blob:Blob){releaseImageUrls([name]);const url=URL.createObjectURL(blob);urls.set(name,url);return url}
export async function pruneImages(){
 const removed:string[]=[];await mutate((state,images)=>{const used=new Set(state.tickets.flatMap(t=>[t.image,t.crop,t.thumbnail]).filter(Boolean));const cursor=images.openKeyCursor();cursor.onsuccess=()=>{const entry=cursor.result;if(entry){if(!used.has(String(entry.key))){images.delete(entry.key);removed.push(String(entry.key))}entry.continue()}}},false,true);releaseImageUrls(removed);return removed;
}
export async function clearStoredData(){
 configureLlm('');
 await mutate((state,images)=>{for(const key of Object.keys(state))delete (state as any)[key];Object.assign(state,emptyState());images.clear()},true);clearImageUrls();try{localStorage.removeItem(CHECKPOINT)}catch{}
}
