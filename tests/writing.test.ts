import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {emptyState} from '../src/store';
import type {RawTicket,State} from '../src/store';
import {schema,setStatus} from '../src/domain';
import {logicalPlan,preview,makeZip,recordExport} from '../src/export';
import {writingNotes,saveWritingNotes} from '../src/writing';
import {encodeBackup,decodeBackup} from '../src/backup';
const body={mode:'codes' as const};
function fixture():State{const s=emptyState();s.survey={character:schema.characters[0],answers:{c_q29:'以前の共通文章',c_q30:'以前のイベント案'}};s.profile={c_q17:'private@example.test'};for(let i=0;i<2;i++){const id='writing-'+i;s.tickets.push({id,hash:'a'.repeat(64),filename:id+'.jpg',image:id+'.jpg',crop:id+'.jpg',code:String(i).padStart(10,'0'),code2:schema.code2,qr:'',ocr:{lines:[],candidates:[]},state:'ready',approved:1,character:'',answers:{c_q29:'以前の個別文章'},note:'',created:'2026-10-16',payload:null,history:[]} as RawTicket)}return s}
function exported(){const s=fixture(),plan=logicalPlan(s,body);recordExport(s,body,JSON.stringify(plan));return s}

test('任意の文章が未入力でもZIPを作成でき、下書きの追加・変更で出力内容が変わらない',async()=>{
 const s=fixture(),before=await preview(s,body),oldFiles=unzipSync(new Uint8Array(await makeZip(before).arrayBuffer()));saveWritingNotes(s,s.tickets[0].id,{c_q29:'',c_q30:'',c_q31:''});assert.equal((await preview(s,body)).fingerprint,before.fingerprint);saveWritingNotes(s,s.tickets[0].id,{c_q29:'とてもよかったのですが、期間が短いと感じました。',c_q30:'次回も展示が見たい'});assert.deepEqual(await preview(s,body),before);
 const files=unzipSync(new Uint8Array(await makeZip(logicalPlan(s,body)).arrayBuffer()));assert.deepEqual(Object.keys(files),Object.keys(oldFiles));for(const name of Object.keys(files))assert.equal(strFromU8(files[name]),strFromU8(oldFiles[name]));assert(!strFromU8(files['コピー一覧.txt']).includes('展示'));
});
test('要確認・確認済み・出力済み・応募済み・結果不明の下書き編集はコードと記録を変えない',()=>{
 for(const state of ['review','ready','prepared','done','unknown']){const s=exported(),t=s.tickets[0];t.state=state;if(state==='review')t.approved=0;const before=structuredClone(t),other=structuredClone(s.tickets[1]);saveWritingNotes(s,t.id,{c_q29:'自由な下書き'});const {writing_notes,...current}=t;assert.deepEqual(current,before);assert.deepEqual(s.tickets[1],other);assert.deepEqual(writing_notes,{c_q29:'自由な下書き'})}
});
test('プレビュー後の下書き保存でもコードの出力記録が成立し、下書きはそのまま残る',()=>{
 const s=fixture(),plan=logicalPlan(s,body);saveWritingNotes(s,s.tickets[0].id,{c_q29:'出力の対象ではない文章'});recordExport(s,body,JSON.stringify(plan));assert.equal(s.tickets[0].writing_notes!.c_q29,'出力の対象ではない文章');assert.equal(s.tickets[0].state,'prepared');assert.deepEqual(s.tickets[0].payload!.answers,{});assert.equal(s.tickets[0].payload!.character,schema.characters[0]);setStatus(s,s.tickets[0].id,{state:'done'});assert.equal(s.tickets[0].writing_notes!.c_q29,'出力の対象ではない文章');
});
test('過去の個別回答や応募時の回答を引き継ぎ、明示的に空欄にした下書きは復活させない',()=>{
 const s=fixture(),t=s.tickets[0];assert.deepEqual(writingNotes(t,s),{c_q29:'以前の個別文章',c_q30:'以前のイベント案',c_q31:''});t.state='done';t.payload={profile:{},character:schema.characters[0],answers:{c_q29:'応募時の文章'},code:t.code,code2:t.code2};assert.equal(writingNotes(t,s).c_q29,'応募時の文章');saveWritingNotes(s,t.id,{c_q29:'',c_q30:'新しい案'});assert.equal(writingNotes(t,s).c_q29,'');assert.equal(t.payload.answers.c_q29,'応募時の文章');
});
test('不正な下書きは保存せず、どの記録も変更しない',()=>{
 const s=fixture(),before=structuredClone(s);for(const invalid of [null,[],{c_q29:5},{c_q29:['文章']},{c_q29:'a'.repeat(4001)},{code:'上書き不可'},{c_q29:'途中',c_q30:{text:'不正'}}]){assert.throws(()=>saveWritingNotes(s,s.tickets[0].id,invalid),/自由記述/);assert.deepEqual(s,before)}assert.throws(()=>saveWritingNotes(s,'missing',{}),/見つかりません/);
});
test('下書きはバックアップへ含めて復元でき、旧バックアップも読める',async()=>{
 const s=exported(),images=new Map(s.tickets.map(t=>[t.image,new Blob(['fake image'])]));saveWritingNotes(s,s.tickets[0].id,{c_q29:'任意の文章',c_q30:'',c_q31:'新商品案'});assert.deepEqual((await decodeBackup(await encodeBackup(s,images))).state,s);delete s.tickets[0].writing_notes;const restored=(await decodeBackup(await encodeBackup(s,images))).state;assert.equal(restored.tickets[0].writing_notes,undefined);assert.equal(writingNotes(restored.tickets[0],restored).c_q29,'以前の個別文章');
 const invalid=structuredClone(s);(invalid.tickets[0] as any).writing_notes={c_q29:123};await assert.rejects(encodeBackup(invalid,images),/自由記述/);
});
