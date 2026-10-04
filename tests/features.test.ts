import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../src/store';
import type {RawTicket} from '../src/store';
import {schema,setStatus,effective,editTicket,applyRecognizedCode} from '../src/domain';
import {logicalPlan,recordExport} from '../src/export';
import {dataProblems,deleteAppCaches} from '../src/storage-health';
import {cacheHealth,prepareCache} from '../scripts/cache-runtime.mjs';
function ticket(id:string,code='00ABC12345'):RawTicket{return {id,hash:'a'.repeat(64),filename:id+'.jpg',image:id+'.jpg',crop:id+'.jpg',code,code2:schema.code2,qr:'',ocr:{candidates:[],lines:[]},state:'ready',answers:{},approved:1,character:'',note:'',created:'2026-10-05',payload:null,history:[]}}
test('記録済みから戻すと記録時の回答を編集でき、履歴は残る',()=>{
 const s=emptyState(),t=ticket('one');s.tickets=[t];s.survey={answers:{c_q29:'記録時の回答'},character:schema.characters[0]};
 t.payload={profile:{},answers:{c_q29:'記録時の回答'},character:schema.characters[0],code:t.code,code2:t.code2};t.state='done';s.survey.answers!.c_q29='変更後の共通文';
 setStatus(s,t.id,{state:'ready'});assert.equal(t.payload,null);assert.equal(effective(t,s).answers.c_q29,'記録時の回答');assert.equal(t.history[0].snapshot!.answers.c_q29,'記録時の回答');
 editTicket(s,t.id,{code:t.code,code2:t.code2,answers:{c_q29:'書き直した回答'},character:t.character,approved:true});assert.equal(effective(t,s).answers.c_q29,'書き直した回答');assert.equal(t.history[0].snapshot!.answers.c_q29,'記録時の回答');assert.throws(()=>setStatus(s,t.id,{state:'done'}),/もう一度/);
});
test('要確認への変更は確認を解除し、状態変更だけでは未確認コードを承認できない',()=>{
 const s=emptyState(),t=ticket('one');s.tickets=[t];setStatus(s,t.id,{state:'review'});assert.equal(t.approved,0);assert.throws(()=>setStatus(s,t.id,{state:'ready'}),/照合/);assert.throws(()=>setStatus(s,t.id,{state:'prepared'}),/もう一度/);
});
test('コードのみ出力した後の編集では古い出力を応募記録に使わない',()=>{
 const s=emptyState(),t=ticket('one');s.tickets=[t];const body={mode:'codes' as const};recordExport(s,body,JSON.stringify(logicalPlan(s,body)));
 editTicket(s,t.id,{code:t.code,code2:t.code2,answers:{c_q29:'追加の記述'},character:'',approved:true});assert.throws(()=>setStatus(s,t.id,{state:'done'}),/もう一度/);assert.equal(t.history[1].state,'exported_codes');
});
test('別写真の同じコードは候補を残して通知し、台帳に二重登録しない',()=>{
 const s=emptyState(),first=ticket('first'),second=ticket('second','');second.approved=0;second.state='review';second.ocr_pending=true;s.tickets=[first,second];
 const duplicate=applyRecognizedCode(s,second.id,first.code,.99);assert.equal(duplicate?.code,first.code);assert.equal(duplicate?.existing,first.filename);assert.equal(second.code,'');assert.equal(second.ocr.candidates[0].text,first.code);assert.match(second.note,/登録済み/);
 assert.equal(applyRecognizedCode(s,first.id,'ZZ12345678',.99),null);assert.equal(first.code,'00ABC12345');
});
test('写真欠損・台帳消失を通知し、初回利用や正常な保存では警告しない',()=>{
 const s=emptyState();s.tickets=[ticket('one')];assert.match(dataProblems(s,new Map(),true)[0],/1ファイル/);
 assert.deepEqual(dataProblems(s,new Map([['one.jpg',new Blob(['photo'])]]),true,{saved:true,ids:['one']}),[]);
 assert.match(dataProblems(emptyState(),new Map(),false,{saved:true,ids:['one']})[0],/復元/);assert.deepEqual(dataProblems(emptyState(),new Map(),false),[]);
 assert.match(dataProblems(emptyState(),new Map(),true,{saved:true,ids:['one']})[0],/一部/);
});
function fakeCaches(){const contents=new Map<string,Map<string,Response>>();const storage={keys:async()=>[...contents.keys()],has:async(name:string)=>contents.has(name),delete:async(name:string)=>contents.delete(name),open:async(name:string)=>{if(!contents.has(name))contents.set(name,new Map());const rows=contents.get(name)!;return {keys:async()=>[...rows.keys()].map(url=>new Request(url)),match:async(input:Request|URL|string)=>rows.get(input instanceof Request?input.url:String(input))?.clone(),put:async(input:Request|URL|string,response:Response)=>{rows.set(input instanceof Request?input.url:String(input),response)}}}};return {storage:storage as unknown as CacheStorage,contents}}
test('キャッシュ欠損の検出と再準備は正常ファイルを保ち、削除はこのアプリだけ',async()=>{
 const {storage,contents}=fakeCaches(),scope='https://example.test/app/',name='ouboken-pwa-'+scope+'-v1',files=['index.html','ocr/model.onnx'],sizes={'index.html':4,'ocr/model.onnx':5};
 assert.equal((await cacheHealth(storage,name,scope,files,sizes)).missing.length,2);assert.equal(contents.size,0);
 await prepareCache(storage,name,scope,files,async request=>new Response(request.url.endsWith('.html')?'page':'model'));assert.deepEqual(await cacheHealth(storage,name,scope,files,sizes),{missing:[],bytes:9});
 contents.get(name)!.delete(scope+'ocr/model.onnx');let fetched=0;await prepareCache(storage,name,scope,files,async()=>{fetched++;return new Response('model')});assert.equal(fetched,1);assert.equal(await (await storage.open(name)).match(scope+'index.html')!.then(r=>r!.text()),'page');
 await storage.open('ouboken-pwa-https://example.test/app2/-v1');await storage.open('another-app');await deleteAppCaches(storage,scope);assert.deepEqual(await storage.keys(),['ouboken-pwa-https://example.test/app2/-v1','another-app']);
});
test('再準備がHTMLエラーページを受け取った場合はOCRファイルとして保存しない',async()=>{
 const {storage}=fakeCaches();await assert.rejects(prepareCache(storage,'cache','https://example.test/',['ocr/model.onnx'],async()=>new Response('not found',{headers:{'Content-Type':'text/html'}})),/取得/);assert.equal(await (await storage.open('cache')).match('https://example.test/ocr/model.onnx'),undefined);
});
