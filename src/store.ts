export type Answers=Record<string,string|string[]>;
export type Payload={profile:Record<string,string>,answers:Answers,character:string,code:string,code2:string};
export type History={state:string,note:string,created:string,snapshot:Payload|null};
export type RawTicket={id:string,hash:string,filename:string,image:string,crop:string,code:string,code2:string,qr:string,ocr:{candidates:{text:string,confidence:number,box:number[][]}[],lines:string[]},state:string,answers:Answers,approved:number,character:string,note:string,created:string,payload:Payload|null,history:History[],ocr_pending?:boolean};
export type State={version:1,profile:Record<string,string>,survey:{answers?:Answers,character?:string,notes?:Record<string,string>},tickets:RawTicket[]};
export const emptyState=():State=>({version:1,profile:{},survey:{},tickets:[]});
const DB_NAME='ouboken-pwa-v1';
let opening:Promise<IDBDatabase>|undefined;
function database(){
 if(!opening)opening=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('state');request.result.createObjectStore('images')};
  request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=undefined};resolve(request.result)};
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
export async function mutate<T>(fn:(state:State,images:IDBObjectStore)=>T):Promise<T>{
 const db=await database();return new Promise<T>((resolve,reject)=>{
  const tx=db.transaction(['state','images'],'readwrite');let result:T,problem:unknown;
  const store=tx.objectStore('state'),request=store.get('main');
  request.onsuccess=()=>{try{const state:State=request.result??emptyState();result=fn(state,tx.objectStore('images'));store.put(state,'main')}catch(e){problem=e;tx.abort()}};
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(problem??storageError(tx.error));tx.onerror=()=>{};
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
 const db=await database();return new Promise<{state:State,images:Map<string,Blob>}>((resolve,reject)=>{
  const tx=db.transaction(['state','images']);let state:State=emptyState();const images=new Map<string,Blob>();
  const stateRequest=tx.objectStore('state').get('main');stateRequest.onsuccess=()=>{state=stateRequest.result??emptyState()};
  const request=tx.objectStore('images').openCursor();request.onsuccess=()=>{const c=request.result;if(c){images.set(String(c.key),c.value);c.continue()}};
  tx.oncomplete=()=>resolve({state,images});tx.onabort=()=>reject(storageError(tx.error));
 });
}
const urls=new Map<string,string>();
export function imageUrl(name:string){return urls.get(name)||''}
export async function primeImages(){for(const [name,blob] of await readImages())if(!urls.has(name))urls.set(name,URL.createObjectURL(blob))}
export function clearImageUrls(){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear()}
export function now(){return new Date().toISOString().slice(0,19).replace('T',' ')}
export function uniqueId(){return crypto.randomUUID()}
export async function digest(value:BufferSource){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',value));return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')}
