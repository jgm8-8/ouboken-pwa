export type Answers=Record<string,string|string[]>;
export type Payload={profile:Record<string,string>,answers:Answers,character:string,code:string,code2:string};
export type History={state:string,note:string,created:string,snapshot:Payload|null};
export type RawTicket={id:string,hash:string,filename:string,image:string,crop:string,thumbnail?:string,code:string,code2:string,qr:string,ocr:{candidates:{text:string,confidence:number,box:number[][]}[],lines:string[]},state:string,answers:Answers,approved:number,character:string,note:string,created:string,payload:Payload|null,history:History[],ocr_pending?:boolean};
export type State={version:1,profile:Record<string,string>,survey:{answers?:Answers,character?:string,notes?:Record<string,string>},tickets:RawTicket[]};
export const emptyState=():State=>({version:1,profile:{},survey:{},tickets:[]});
import {checkpoint,CHECKPOINT} from './checkpoint';
import {configureLlm} from './llm';
const DB_NAME='ouboken-pwa-v1';
let opening:Promise<IDBDatabase>|undefined;
let sessionEpoch:string|null=null;
function database(){
 if(!opening)opening=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('state');request.result.createObjectStore('images')};
  request.onsuccess=()=>{const db=request.result;const epoch=db.transaction('state').objectStore('state').get('reset_epoch');epoch.onsuccess=()=>{sessionEpoch=epoch.result??null;resolve(db)};epoch.onerror=()=>reject(storageError(epoch.error));request.result.onversionchange=()=>{request.result.close();opening=undefined}};
  request.onerror=()=>{opening=undefined;reject(Error('この端末に保存できません。通常のSafariから開いてください。'))};
  request.onblocked=()=>reject(Error('別のOuboken画面を閉じてから再読み込みしてください。'));
 });
 return opening;
}
function storageError(error:DOMException|null){return Error(error?.name==='QuotaExceededError'?'端末の保存容量が不足しています。写真の追加を止めてバックアップしてください。':'保存できませんでした。入力を残したまま再試行してください。')}
export async function readState():Promise<State>{
 const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('state').objectStore('state').get('main');request.onsuccess=()=>resolve(request.result??emptyState());request.onerror=()=>reject(storageError(request.error))});
}
// Read, validate, and write in one IndexedDB transaction, including across tabs.
export async function mutate<T>(fn:(state:State,images:IDBObjectStore)=>T,reset=false,maintenance=false):Promise<T>{
 const db=await database();return new Promise<T>((resolve,reject)=>{
  const tx=db.transaction(['state','images'],'readwrite');let result:T,problem:unknown,written:State;let resetEpoch:string|undefined;
  const store=tx.objectStore('state');let currentEpoch:string|null=null;const epoch=store.get('reset_epoch');epoch.onsuccess=()=>{currentEpoch=epoch.result??null};const request=store.get('main');
  request.onsuccess=()=>{try{if(currentEpoch!==sessionEpoch)throw Error('別の画面でデータが削除されました。再読み込みしてください。');const state:State=request.result??emptyState();result=fn(state,tx.objectStore('images'));if(request.result||!maintenance)store.put(state,'main');written=state;if(reset){resetEpoch=crypto.randomUUID();store.put(resetEpoch,'reset_epoch')}}catch(e){problem=e;tx.abort()}};
  tx.oncomplete=()=>{if(resetEpoch)sessionEpoch=resetEpoch;if(!maintenance)checkpoint(written);if(typeof window!=='undefined')window.dispatchEvent(new Event('ouboken-data-changed'));resolve(result)};tx.onabort=()=>reject(problem??storageError(tx.error));tx.onerror=()=>{};
 });
}
export async function readImages():Promise<Map<string,Blob>>{
 const db=await database();return new Promise((resolve,reject)=>{
  const result=new Map<string,Blob>();const tx=db.transaction('images');const request=tx.objectStore('images').openCursor();
  request.onsuccess=()=>{const cursor=request.result;if(cursor){result.set(String(cursor.key),cursor.value);cursor.continue()}};
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(storageError(tx.error));
 });
}
export async function readBackup(){
 const db=await database();return new Promise<{state:State,images:Map<string,Blob>,hasState:boolean}>((resolve,reject)=>{
  const tx=db.transaction(['state','images']);let state:State=emptyState(),hasState=false;const images=new Map<string,Blob>();
  const stateRequest=tx.objectStore('state').get('main');stateRequest.onsuccess=()=>{hasState=!!stateRequest.result;state=stateRequest.result??emptyState()};
  const request=tx.objectStore('images').openCursor();request.onsuccess=()=>{const c=request.result;if(c){images.set(String(c.key),c.value);c.continue()}};
  tx.oncomplete=()=>resolve({state,images,hasState});tx.onabort=()=>reject(storageError(tx.error));
 });
}
const urls=new Map<string,string>();
export function imageUrl(name:string){return urls.get(name)||''}
export async function primeImages(){const images=await readImages();releaseImageUrls([...urls.keys()].filter(name=>!images.has(name)));for(const [name,blob] of images)if(!urls.has(name))urls.set(name,URL.createObjectURL(blob))}
export function clearImageUrls(){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear()}
export function releaseImageUrls(names:string[]){for(const name of names){const url=urls.get(name);if(url)URL.revokeObjectURL(url);urls.delete(name)}}
export function now(){return new Date().toISOString().slice(0,19).replace('T',' ')}
export function uniqueId(){return crypto.randomUUID()}
export async function digest(value:BufferSource){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',value));return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')}

export async function readImage(name:string):Promise<Blob|undefined>{const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('images').objectStore('images').get(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(storageError(request.error))})}
export function cacheImageUrl(name:string,blob:Blob){releaseImageUrls([name]);const url=URL.createObjectURL(blob);urls.set(name,url);return url}
export async function pruneImages(){
 const removed:string[]=[];await mutate((state,images)=>{const used=new Set(state.tickets.flatMap(t=>[t.image,t.crop,t.thumbnail]).filter(Boolean));const cursor=images.openKeyCursor();cursor.onsuccess=()=>{const entry=cursor.result;if(entry){if(!used.has(String(entry.key))){images.delete(entry.key);removed.push(String(entry.key))}entry.continue()}}},false,true);releaseImageUrls(removed);return removed;
}
export async function clearStoredData(){
 configureLlm('');
 await mutate((state,images)=>{for(const key of Object.keys(state))delete (state as any)[key];Object.assign(state,emptyState());images.clear()},true);clearImageUrls();try{localStorage.removeItem(CHECKPOINT)}catch{}
}
