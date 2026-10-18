import 'fake-indexeddb/auto';
import {forceCloseDatabase} from 'fake-indexeddb';
import test from 'node:test';
import assert from 'node:assert/strict';
import {watchTransaction,storageWaitMs} from '../src/idb-transaction';
import {mutate,readState} from '../src/store';
const next=()=>new Promise(resolve=>setImmediate(resolve));

test('無応答の保存処理を解除し、遅れた完了を成功扱いせず再実行もしない',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let aborted=0,stalled=0,committed=0;
 const tx={abort:()=>{aborted++}}as unknown as IDBTransaction;
 const result=new Promise((resolve,reject)=>watchTransaction(tx,()=>{committed++;return 'done'},resolve,reject,()=>{stalled++},()=>Error('abort')));
 const rejected=assert.rejects(result,/保存領域から応答/);t.mock.timers.tick(storageWaitMs);await rejected;
 tx.oncomplete?.call(tx,{}as Event);assert.equal(aborted,1);assert.equal(stalled,1);assert.equal(committed,0);
});

test('進捗のある読み込みは待機時間を延長し、コミットしてから成功にする',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let stalled=0,read=0;
 const tx={}as IDBTransaction;let watch:ReturnType<typeof watchTransaction>;
 const result=new Promise((resolve,reject)=>{watch=watchTransaction(tx,()=>{read++;return 'saved'},resolve,reject,()=>{stalled++},()=>Error('abort'))});
 t.mock.timers.tick(storageWaitMs-1);watch!.touch();t.mock.timers.tick(storageWaitMs-1);assert.equal(read,0);tx.oncomplete?.call(tx,{}as Event);assert.equal(await result,'saved');t.mock.timers.tick(storageWaitMs);assert.equal(read,1);assert.equal(stalled,0);
});

test('中断した読み込みを保存済み扱いせず、接続断から再接続する',async()=>{
 await mutate(s=>{s.profile.recovery='before'});
 const native=IDBObjectStore.prototype.get;
 IDBObjectStore.prototype.get=function(key){const r=native.call(this,key);if(this.name==='state'&&key==='main')r.addEventListener('success',()=>r.transaction!.abort());return r};
 try{await assert.rejects(readState(),/保存できません/)}finally{IDBObjectStore.prototype.get=native}
 const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('ouboken-pwa-v1',1);r.onsuccess=()=>resolve(r.result)});forceCloseDatabase(db);
 // Force-close the store's own connection as well, as Safari may do after backgrounding.
 const transaction=IDBDatabase.prototype.transaction;let captured:IDBDatabase|undefined;
 IDBDatabase.prototype.transaction=function(...args:any[]){captured=this;return (transaction as any).apply(this,args)};
 try{await readState()}finally{IDBDatabase.prototype.transaction=transaction}
 forceCloseDatabase(captured!);await next();await mutate(s=>{s.profile.recovery='after'});assert.equal((await readState()).profile.recovery,'after');
});

test('無応答から接続を作り直しても別画面での全削除を無効化しない',async t=>{
 await mutate(s=>{s.profile.recovery='keep'});t.mock.timers.enable({apis:['setTimeout']});
 const native=IDBDatabase.prototype.transaction;let aborts=0;const requests:any[]=[];
 IDBDatabase.prototype.transaction=function(){return {objectStore:()=>({get:()=>{const r={};requests.push(r);return r}}),abort:()=>{aborts++}}as unknown as IDBTransaction};
 const result=mutate(s=>{s.profile.recovery='must not write'}),rejected=assert.rejects(result,/保存領域から応答/);
 await next();IDBDatabase.prototype.transaction=native;t.mock.timers.tick(storageWaitMs);await rejected;t.mock.timers.reset();
 for(const request of requests){request.result={profile:{}};request.onsuccess?.()}
 assert.equal(aborts,1);assert.equal((await readState()).profile.recovery,'keep');
 const other=await import(new URL('../src/store.ts?reset-on-other-tab',import.meta.url).href);await other.mutate((s:any)=>{s.tickets=[];s.profile={}},true);
 await assert.rejects(mutate(s=>{s.profile.recovery='resurrect'}),/別の画面でデータが削除/);assert.deepEqual((await readState()).tickets,[]);assert.equal((await readState()).profile.recovery,undefined);
});

test('個別写真の表示で他の応募券の原画像を読み込まず、再表示はURLを再利用する',async()=>{
 const {clearImageUrls,mutate,primeImages,imageUrl}=await import(new URL('../src/store.ts?fresh-image-session',import.meta.url).href);clearImageUrls();await mutate((s,images)=>{images.put(new Blob(['one']),'one.jpg');images.put(new Blob(['two']),'two.jpg')});
 const native=IDBObjectStore.prototype.get,reads:string[]=[];
 IDBObjectStore.prototype.get=function(key){if(this.name==='images')reads.push(String(key));return native.call(this,key)};
 try{await primeImages(['one.jpg','one.jpg']);const first=imageUrl('one.jpg');assert(first);assert.equal(imageUrl('two.jpg'),'');await primeImages(['one.jpg']);assert.equal(imageUrl('one.jpg'),first);assert.deepEqual(reads,['one.jpg'])}finally{IDBObjectStore.prototype.get=native;clearImageUrls()}
});

test('接続開始が無応答でも再試行でき、遅れて開いた古い接続は閉じる',async t=>{
 const fresh=await import(new URL('../src/store.ts?stalled-open',import.meta.url).href);let closed=0;
 const request:any={result:{close:()=>{closed++}}},native=indexedDB.open;
 t.mock.timers.enable({apis:['setTimeout']});indexedDB.open=()=>request;
 try{const result=fresh.readState(),rejected=assert.rejects(result,/保存領域から応答/);t.mock.timers.tick(storageWaitMs);await rejected;request.onsuccess();assert.equal(closed,1)}finally{indexedDB.open=native;t.mock.timers.reset()}
 assert.equal((await fresh.readState()).version,1);
});
