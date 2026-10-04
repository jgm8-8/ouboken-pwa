import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {emptyState,mutate,readState,readBackup,pruneImages,clearStoredData,primeImages,imageUrl} from '../src/store';
import type {RawTicket,State} from '../src/store';
import {schema,editTicket,confirm,needsOcr,clearInactiveOcr,replaceCrop,removeTicket,setStatuses} from '../src/domain';
import {encodeBackup,decodeBackup,createBackupFile,backupFilename,restoreBackup} from '../src/backup';
import {thumbnailSize} from '../src/thumbnails';
import {pruneWorkerCaches} from '../scripts/cache-runtime.mjs';
const persistent=new Map<string,string>();Object.assign(globalThis,{localStorage:{getItem:(k:string)=>persistent.get(k)??null,setItem:(k:string,v:string)=>persistent.set(k,v),removeItem:(k:string)=>persistent.delete(k)}});
function fixture(count=2):State{const s=emptyState();s.profile={c_q6_first:'架空の応募者'};s.survey={answers:{c_q29:'共通の文章'}};for(let i=0;i<count;i++){const id='ticket-'+i,code=String(i).padStart(10,'0');s.tickets.push({id,hash:'a'.repeat(64),filename:id+'.jpg',image:id+'.jpg',crop:id+'-crop.jpg',thumbnail:id+'-thumb.jpg',code,code2:schema.code2,qr:'',ocr:{candidates:[],lines:[]},state:'prepared',answers:{c_q29:'個別の文章'+i},approved:1,character:'',note:'',created:'2026-10-05',payload:{profile:{c_q6_first:'記録時の応募者'},answers:{c_q29:'記録時の文章'+i},character:schema.characters[0],code,code2:schema.code2},history:[]} as RawTicket)}return s}
async function seed(s=fixture()){await mutate((state,images)=>{Object.assign(state,s);images.clear();for(const t of s.tickets)for(const name of [t.image,t.crop,t.thumbnail!])images.put(new Blob(['fixture']),name)});return s}

test('未確認の途中入力とサムネイルをバックアップ・復元でき、確認済みの不正コードは拒否する',async()=>{
 const s=fixture(1),t=s.tickets[0];t.state='review';t.approved=0;t.payload=null;editTicket(s,t.id,{code:t.code,code2:'途中入力',approved:false,answers:t.answers,character:''});await seed(s);
 const {state,images}=await readBackup(),decoded=await decodeBackup(await encodeBackup(state,images));assert.equal(decoded.state.tickets[0].code2,'途中入力');assert.equal(decoded.state.tickets[0].thumbnail,t.thumbnail);await restoreBackup(decoded);assert.equal((await readState()).tickets[0].code2,'途中入力');
 const invalid=structuredClone(state);invalid.tickets[0].approved=1;await assert.rejects(encodeBackup(invalid,images),/形式/);
});
test('手動編集・確認でOCR待ちを解除し、旧データの確認済み待ちも再開対象にしない',()=>{
 const s=fixture(1),t=s.tickets[0];t.payload=null;t.state='review';t.approved=0;t.ocr_pending=true;assert(needsOcr(t));
 editTicket(s,t.id,{code:t.code,code2:schema.code2,approved:false,answers:{}});assert.equal(t.ocr_pending,false);
 t.ocr_pending=true;confirm(s,t.id,{code:t.code,code2:schema.code2});assert.equal(t.ocr_pending,false);
 t.ocr_pending=true;assert.equal(needsOcr(t),false);clearInactiveOcr(s);assert.equal(t.ocr_pending,false);
});
test('切り抜きの参照が変わると旧画像を消し、他の券が参照する画像は残す',async()=>{
 await seed();const s=await readState(),first=s.tickets[0];await mutate((state,images)=>replaceCrop(state,images,first.id));assert.equal((await readBackup()).images.has(first.crop),false);
 await seed();await mutate(state=>{state.tickets[1].image=state.tickets[0].crop});await mutate((state,images)=>replaceCrop(state,images,first.id));assert.equal((await readBackup()).images.has(first.crop),true);
});
test('残留画像を片付け、券削除ではサムネイルも削除し、別の券の画像を保護する',async()=>{
 const s=await seed();await mutate((_,images)=>images.put(new Blob(['orphan']),'orphan-crop.jpg'));assert.deepEqual(await pruneImages(),['orphan-crop.jpg']);
 await mutate((state,images)=>removeTicket(state,images,s.tickets[0].id));const data=await readBackup();assert.equal(data.images.size,3);assert(data.images.has(s.tickets[1].thumbnail!));assert.equal(data.images.has(s.tickets[0].thumbnail!),false);
});
test('共有中の切り抜きを再生成しても他の券の画像を上書きしない',async()=>{
 const s=await seed(),original=s.tickets[0].crop;await mutate(state=>{state.tickets[1].crop=original});await mutate((state,images)=>replaceCrop(state,images,s.tickets[0].id,new Blob(['new crop'])));const saved=await readBackup();assert.equal(await saved.images.get(original)!.text(),'fixture');assert.notEqual(saved.state.tickets[0].crop,original);assert.equal(await saved.images.get(saved.state.tickets[0].crop)!.text(),'new crop');assert.equal(saved.state.tickets[1].crop,original);
});
test('一括ステータス変更は100枚の記録内容を保ち、繰り返しで履歴を増やさない',async()=>{
 const s=fixture(100),ids=s.tickets.map(t=>t.id);await seed(s);await mutate(state=>setStatuses(state,ids,'done'));let saved=await readState();assert(saved.tickets.every(t=>t.state==='done'&&t.history.length===1));assert.equal(saved.tickets[50].payload!.answers.c_q29,'記録時の文章50');
 await mutate(state=>setStatuses(state,ids,'done'));assert((await readState()).tickets.every(t=>t.history.length===1));
 await mutate(state=>setStatuses(state,ids,'ready'));saved=await readState();assert(saved.tickets.every(t=>t.state==='ready'&&t.payload===null&&t.history.length===2));assert.equal(saved.tickets[50].answers.c_q29,'記録時の文章50');
});
test('一括変更に不適格な券が混じる場合、1枚も変更せず履歴も残さない',async()=>{
 const s=fixture();s.tickets[1].payload=null;s.tickets[1].state='review';s.tickets[1].approved=0;await seed(s);await assert.rejects(mutate(state=>setStatuses(state,state.tickets.map(t=>t.id),'done')),/ticket-1|0000000001/);assert.deepEqual(await readState(),s);
 assert.throws(()=>setStatuses(s,[s.tickets[0].id,s.tickets[0].id],'done'),/選択/);assert.throws(()=>setStatuses(s,[],'done'),/選択/);
});
test('バックアップに日時と枚数を記録し、旧パスワードなし形式も読み込める',async()=>{
 await seed();const {blob,metadata}=await createBackupFile();const decoded=await decodeBackup(blob);assert.deepEqual(decoded.metadata,metadata);assert.match(backupFilename(metadata),/^ouboken-backup-\d{8}-\d{6}-2枚\.ouboken$/);
 const header=strToU8('OUBOKEN-PWA-BACKUP-2\n'),files=unzipSync(new Uint8Array(await blob.arrayBuffer()).slice(header.length)),manifest=JSON.parse(strFromU8(files['manifest.json']));delete manifest.created_at;delete manifest.ticket_count;files['manifest.json']=strToU8(JSON.stringify(manifest));const legacy=await decodeBackup(new Blob([header,zipSync(files)]));assert.deepEqual(legacy.metadata,{created_at:null,ticket_count:2});
});
test('全データ削除は写真・住所・履歴・検知記録を消し、別画面からの古い保存を拒否する',async()=>{
 await seed();await primeImages();const previous=imageUrl('ticket-0.jpg');assert(previous);const other=await import(new URL('../src/store.ts?other-tab',import.meta.url).href);await other.readState();
 await clearStoredData();assert.deepEqual(await readState(),emptyState());assert.equal((await readBackup()).images.size,0);assert.equal(persistent.has('ouboken-pwa-checkpoint'),false);assert.equal(imageUrl('ticket-0.jpg'),'');
 await assert.rejects(other.mutate((state:State)=>{state.profile={c_q6_first:'古い画面の値'}}),/削除/);assert.deepEqual(await readState(),emptyState());
 await seed();assert.equal((await readState()).tickets.length,2);
});
test('バックアップの枚数を0に書き換えても不一致として拒否する',async()=>{
 await seed();const {blob}=await createBackupFile(),header=strToU8('OUBOKEN-PWA-BACKUP-2\n'),files=unzipSync(new Uint8Array(await blob.arrayBuffer()).slice(header.length)),manifest=JSON.parse(strFromU8(files['manifest.json']));manifest.ticket_count=0;files['manifest.json']=strToU8(JSON.stringify(manifest));await assert.rejects(decodeBackup(new Blob([header,zipSync(files)])),/枚数/);
});
test('削除トランザクションが失敗すれば写真・台帳・削除世代を変えない',async()=>{
 await seed();const original=await readBackup();await assert.rejects(mutate((state,images)=>{images.clear();state.tickets=[];throw Error('中断')},true),/中断/);assert.deepEqual((await readBackup()).state,original.state);assert.equal((await readBackup()).images.size,6);await mutate(state=>{state.profile.c_q6_first='変更可能'});
});
test('起動時の画像整理は台帳欠損の検知記録を上書きしない',async()=>{
 await seed();const previous=persistent.get('ouboken-pwa-checkpoint');const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('ouboken-pwa-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').delete('main');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});db.close();await pruneImages();assert.equal((await readBackup()).hasState,false);assert.equal(persistent.get('ouboken-pwa-checkpoint'),previous);await seed();
});
test('一覧用サムネイルは縦横比を保って最大160px、拡大をしない',()=>{
 assert.deepEqual(thumbnailSize(2000,1500),{width:160,height:120});assert.deepEqual(thumbnailSize(1200,2000),{width:96,height:160});assert.deepEqual(thumbnailSize(80,60),{width:80,height:60});
});
function cacheStorage(){const names=new Set<string>();return {names,storage:{keys:async()=>[...names],delete:async(name:string)=>names.delete(name)}}}
test('更新を20世代保留しても現行版と最新待機版だけを残し、別アプリには触れない',async()=>{
 const {names,storage}=cacheStorage(),prefix='ouboken-pwa-https://example.test/app/-',active={state:'activated',cache:prefix+'v0'},registration:any={active,waiting:null,installing:null};names.add(active.cache);names.add('other-app');
 for(let i=1;i<=20;i++){const waiting={state:'installed',cache:prefix+'v'+i};names.add(waiting.cache);registration.waiting=waiting;assert.equal(await pruneWorkerCaches(storage,prefix,waiting.cache,registration,async(worker:any)=>worker.cache),true);assert.equal(names.size,3);assert(names.has(active.cache));assert(names.has(waiting.cache))}
 registration.active=registration.waiting;registration.waiting=null;await pruneWorkerCaches(storage,prefix,registration.active.cache,registration,async(worker:any)=>worker.cache);assert.equal(names.size,2);
});
test('インストール中のキャッシュを保護し、旧ワーカーの名前が不明な場合や世代交代中は削除しない',async()=>{
 const {names,storage}=cacheStorage(),prefix='scope-',active={state:'activated',cache:'scope-active'},waiting={state:'installed',cache:'scope-waiting'},installing={state:'installing',cache:'scope-installing'},registration={active,waiting,installing};for(const name of ['scope-active','scope-waiting','scope-installing','scope-old'])names.add(name);
 await pruneWorkerCaches(storage,prefix,active.cache,registration,async(worker:any)=>worker.cache);assert(names.has(installing.cache));assert.equal(names.has('scope-old'),false);
 names.add('scope-old');assert.equal(await pruneWorkerCaches(storage,prefix,active.cache,registration,async()=>null),false);assert(names.has('scope-old'));
 assert.equal(await pruneWorkerCaches(storage,prefix,active.cache,registration,async(worker:any)=>{registration.waiting={state:'installed',cache:'scope-new'};return worker.cache}),false);assert(names.has('scope-old'));
});
