import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,unzipSync,strFromU8,strToU8} from 'fflate';
import {emptyState,mutate,readState,readBackup} from '../src/store';
import type {RawTicket,State} from '../src/store';
import {schema,confirm,effective,setStatus,removeTicket} from '../src/domain';
import {logicalPlan,makeZip,recordExport,preview} from '../src/export';
import {encodeBackup,decodeBackup,restoreBackup,validateBackup,createBackup} from '../src/backup';

function ticket(id:string,code:string):RawTicket{return {id,hash:'a'.repeat(64),filename:'test.jpg',image:id+'.jpg',crop:id+'.jpg',code,code2:schema.code2,qr:'',ocr:{candidates:[],lines:[]},state:'ready',answers:{},approved:1,character:'',note:'',created:'2026-10-05 00:00:00',payload:null,history:[]}}
function fixture():State{
 const state=emptyState();
 state.profile=Object.fromEntries(schema.profile.map(([key])=>[key,'テスト']));
 Object.assign(state.profile,{c_q1_left:'001',c_q1_right:'0002',c_q9_areacode:'090',c_q9_citycode:'0000',c_q9_subscribercode:'1234',c_q17:'test@example.com'});
 for(const [key,options]of Object.entries(schema.selects))state.profile[key]=options[0];
 state.survey={character:schema.characters[0],answers:{c_q29:'共通の感想'}};
 state.tickets=[ticket('first','00ABC12345'),ticket('second','00DEF12345')];
 return state;
}
async function seed(){const state=fixture();await mutate((s,images)=>{Object.assign(s,state);images.clear();for(const t of state.tickets)images.put(new Blob(['photo']),t.image)});return state}

test('重複コードの拒否は画像と台帳の両方をロールバックする',async()=>{
 await seed();await assert.rejects(mutate((s,images)=>{images.put(new Blob(['bad']),'bad.jpg');s.profile.c_q6_first='変更';confirm(s,'second',{code:s.tickets[0].code})}),/登録済み/);
 const b=await readBackup();assert.equal(b.state.profile.c_q6_first,'テスト');assert.equal(b.images.has('bad.jpg'),false);
});
test('複数券のZIPは先頭ゼロと券別文章を保ち、行単位でコピーできる',async()=>{
 const s=fixture();s.tickets[1].answers.c_q29='個別の感想\n続き';const plan=logicalPlan(s,{});assert.deepEqual(plan.issues,[]);assert.equal(plan.ticket_count,2);
 const zipped=unzipSync(new Uint8Array(await makeZip(plan).arrayBuffer()));const lines=strFromU8(zipped['コピー一覧.txt']).split('\n');
 assert.equal(lines[0],'00ABC12345');assert.equal(lines[plan.tickets[1].start-1],'00DEF12345');assert(lines.includes('個別の感想 続き'));assert(!lines.includes(''));assert.equal(strFromU8(zipped['次の位置.txt']),'1');
 recordExport(s,{},JSON.stringify(plan));setStatus(s,'second',{state:'done'});s.survey.answers!.c_q29='新しい共通文章';s.profile.c_q6_first='別の名前';
 assert.equal(effective(s.tickets[1],s).answers.c_q29,'個別の感想\n続き');assert.equal(s.tickets[1].payload!.profile.c_q6_first,'テスト');assert.equal(logicalPlan(s,{}).ticket_count,1);
});
test('プレビュー後に入力が変われば出力記録を書かない',async()=>{
 await seed();const old=await preview(await readState(),{});const {fingerprint,...logical}=old;
 await mutate(s=>{s.profile.c_q6_first='変更'});
 await assert.rejects(mutate(s=>recordExport(s,{},JSON.stringify(logical))),/変わりました/);
 assert.equal((await readState()).tickets[0].history.length,0);assert.notEqual((await preview(await readState(),{})).fingerprint,fingerprint);
});
test('コードだけの出力は住所不要で、未確認券の黙った省略を防ぐ',()=>{
 const s=fixture();s.profile={};s.tickets[1].approved=0;const p=logicalPlan(s,{mode:'codes'});assert.equal(p.issues[0].page,'review');assert.throws(()=>makeZip(p),/確認/);
 const body={mode:'codes' as const,exclude_unconfirmed:true};const valid=logicalPlan(s,body);assert.equal(valid.ticket_count,1);assert.equal(valid.entries.length,1);recordExport(s,body,JSON.stringify(valid));setStatus(s,'first',{state:'done'});assert.equal(s.tickets[0].payload!.code,'00ABC12345');
});
test('パスワードなしのバックアップで写真・回答・履歴を復元できる',async()=>{
 await seed();await mutate(s=>{s.tickets[0].answers.c_q29='個別の感想';const plan=logicalPlan(s,{});recordExport(s,{},JSON.stringify(plan));setStatus(s,'first',{state:'done'})});
 const original=await readBackup(),file=await createBackup();
 const header=strToU8('OUBOKEN-PWA-BACKUP-2\n'),archive=unzipSync(new Uint8Array(await file.arrayBuffer()).slice(header.length));
 assert.equal(JSON.parse(strFromU8(archive['state.json'])).profile.c_q17,'test@example.com');assert.equal(JSON.parse(strFromU8(archive['manifest.json'])).version,2);
 const decoded=await decodeBackup(file);await mutate((s,images)=>{s.profile.c_q6_first='変更';images.clear()});await restoreBackup(decoded);
 assert.deepEqual(await readState(),original.state);assert.equal(await (await readBackup()).images.get('first.jpg')!.text(),'photo');
});
test('バックアップの写真や台帳の破損を拒否し、現在の保存内容を保つ',async()=>{
 await seed();const original=await readBackup(),file=await createBackup(),header=strToU8('OUBOKEN-PWA-BACKUP-2\n');
 const archive=unzipSync(new Uint8Array(await file.arrayBuffer()).slice(header.length));
 for(const name of ['images/first.jpg','state.json']){const altered={...archive,[name]:strToU8('changed')};await assert.rejects(decodeBackup(new Blob([header,zipSync(altered)])),/破損/)}
 const missing={...archive};delete missing['images/first.jpg'];await assert.rejects(decodeBackup(new Blob([header,zipSync(missing)])),/破損/);
 await assert.rejects(decodeBackup(new Blob([header,zipSync({...archive,'unexpected.txt':strToU8('extra')})])),/破損/);
 assert.deepEqual(await readState(),original.state);assert.equal(await (await readBackup()).images.get('first.jpg')!.text(),'photo');
});
test('欠損した台帳のバックアップ作成と旧暗号化形式の読み込みを拒否する',async()=>{
 await seed();const original=await readBackup();const missing=new Map(original.images);missing.delete('first.jpg');await assert.rejects(encodeBackup(original.state,missing),/写真/);
 await assert.rejects(decodeBackup(new Blob(['OUBOKEN-PWA-BACKUP-1\n','old encrypted file'])),/旧形式/);
 assert.deepEqual(await readState(),original.state);
});
test('破損バックアップを拒否し、復元前の台帳を保つ',async()=>{
 await seed();const b=await readBackup();b.state.tickets[1].code=b.state.tickets[0].code;assert.throws(()=>validateBackup(b.state,b.images),/重複/);await assert.rejects(restoreBackup(b),/重複/);assert.equal((await readState()).tickets[1].code,'00DEF12345');
 const missing=await readBackup();missing.images.delete('first.jpg');assert.throws(()=>validateBackup(missing.state,missing.images),/写真/);
});

test('応募券の削除は写真と切り抜きも消し、他の券と共通情報を保つ',async()=>{
 const original=await seed();await mutate((s,images)=>{s.tickets[0].crop='first-crop.jpg';images.put(new Blob(['crop']),'first-crop.jpg');s.tickets[0].ocr_pending=true});
 await mutate((s,images)=>removeTicket(s,images,'first'));
 const after=await readBackup();assert.deepEqual(after.state.tickets,[original.tickets[1]]);assert.deepEqual(after.state.profile,original.profile);assert.deepEqual(after.state.survey,original.survey);
 assert.equal(after.images.has('first.jpg'),false);assert.equal(after.images.has('first-crop.jpg'),false);assert.equal(await after.images.get('second.jpg')!.text(),'photo');
 validateBackup(after.state,after.images);
});
test('削除のトランザクションが失敗すれば台帳と画像を両方残す',async()=>{
 await seed();const original=await readBackup();await assert.rejects(mutate((s,images)=>{removeTicket(s,images,'first');throw Error('中断')}),/中断/);
 const after=await readBackup();assert.deepEqual(after.state,original.state);assert.equal(await after.images.get('first.jpg')!.text(),'photo');
 await assert.rejects(mutate((s,images)=>removeTicket(s,images,'missing')),/見つかりません/);assert.deepEqual(await readState(),original.state);
});
test('他の券が参照する画像は削除しない',async()=>{
 await seed();await mutate(s=>{s.tickets[1].crop=s.tickets[0].image});await mutate((s,images)=>removeTicket(s,images,'first'));
 const after=await readBackup();assert.equal(after.images.has('first.jpg'),true);validateBackup(after.state,after.images);
});
