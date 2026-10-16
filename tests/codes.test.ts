import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {emptyState} from '../src/store';
import type {State,RawTicket} from '../src/store';
import {schema,effective,setStatus,setStatuses,setTicketCharacter,setCommonCharacter} from '../src/domain';
import {logicalPlan,makeZip,recordExport} from '../src/export';
import {encodeBackup,decodeBackup} from '../src/backup';
import {characterSummary} from '../src/character-summary';
const body={mode:'codes' as const};
function fixture():State{const s=emptyState();s.profile={c_q17:'private@example.test'};s.survey={character:schema.characters[0],answers:{c_q29:'以前の共通回答'},notes:{c_q29:'以前の設定'}};for(let i=0;i<3;i++){const id='codes-'+i;s.tickets.push({id,code:String(i).padStart(10,'0'),code2:schema.code2,hash:'a'.repeat(64),filename:id+'.jpg',image:id+'.jpg',crop:id+'.jpg',approved:1,state:'ready',character:'',answers:{c_q29:'以前の個別回答'},ocr:{lines:[],candidates:[]},qr:'',note:'',created:'2026-10-16',payload:null,history:[]} as RawTicket)}return s}
function exportTickets(s:State,ids?:string[]){const b={...body,ids},plan=logicalPlan(s,b);recordExport(s,b,JSON.stringify(plan));return plan}

test('複数券のZIPはコード①②を交互に出力し、個人情報・キャラ・回答を含めない',async()=>{
 const s=fixture(),plan=logicalPlan(s,body);assert.deepEqual(plan.issues,[]);assert.equal(plan.count,6);
 const files=unzipSync(new Uint8Array(await makeZip(plan).arrayBuffer()));assert.deepEqual(Object.keys(files).sort(),['コピー一覧.txt','次の位置.txt'].sort());assert.equal(strFromU8(files['次の位置.txt']),'1');assert.deepEqual(strFromU8(files['コピー一覧.txt']).split('\n'),s.tickets.flatMap(t=>[t.code,t.code2]));
 for(const data of Object.values(files)){const text=strFromU8(data);assert(!text.includes('private@'));assert(!text.includes(schema.characters[0]));assert(!text.includes('以前の'))}
});
test('共通キャラの変更は旧設定を保ち、出力済み・応募済み券のキャラを変更しない',()=>{
 const s=fixture(),first=s.tickets[0],second=s.tickets[1],old=structuredClone(s);exportTickets(s,[first.id]);assert.equal(first.state,'prepared');assert.equal(first.payload!.codes_only,true);
 setCommonCharacter(s,schema.characters[1]);assert.deepEqual(s.profile,old.profile);assert.deepEqual(s.survey.answers,old.survey.answers);assert.deepEqual(s.survey.notes,old.survey.notes);assert.equal(effective(first,s).character,schema.characters[0]);assert.equal(effective(second,s).character,schema.characters[1]);setStatus(s,first.id,{state:'done'});exportTickets(s,[second.id]);setStatus(s,second.id,{state:'done'});setCommonCharacter(s,schema.characters[2]);assert.equal(effective(first,s).character,schema.characters[0]);assert.equal(effective(second,s).character,schema.characters[1]);
 setStatus(s,first.id,{state:'ready'});assert.equal(first.answers.c_q29,'以前の個別回答');assert.equal(first.character,schema.characters[0]);
});
test('券別キャラの訂正は応募記録を保ち、変更前の履歴と集計を残す',()=>{
 const s=fixture();exportTickets(s);setStatuses(s,s.tickets.map(t=>t.id),'done');const t=s.tickets[0],prior=structuredClone(t.payload);setTicketCharacter(s,t.id,schema.characters[1]);assert.equal(t.state,'done');assert.equal(t.payload!.code,prior!.code);assert.equal(t.payload!.character,schema.characters[1]);assert.deepEqual(t.history[0].snapshot,prior);assert.equal(t.history[1].snapshot!.character,schema.characters[0]);
 const rows=characterSummary(s.tickets.map(t=>effective(t,s)));assert.equal(rows.find(r=>r.character===schema.characters[0])!.done,2);assert.equal(rows.find(r=>r.character===schema.characters[1])!.done,1);const before=structuredClone(s);assert.throws(()=>setTicketCharacter(s,t.id,'不正なキャラ'),/選択/);assert.deepEqual(s,before);
});
test('未応募・結果不明を応募済み枚数へ含めず、未記録の旧券も分けて集計する',()=>{
 const rows=characterSummary([{character:'A',state:'ready'},{character:'A',state:'prepared'},{character:'A',state:'done'},{character:'A',state:'unknown'},{character:'',state:'done'}]);assert.deepEqual(rows,[{character:'A',total:4,done:1},{character:'',total:1,done:1}]);
});
test('キャラ未設定・コード②不正・未確認の券はZIPと出力記録を作れない',()=>{
 const s=fixture();setCommonCharacter(s,'');let plan=logicalPlan(s,body);assert(plan.issues.some(i=>i.page==='character'));assert.throws(()=>makeZip(plan),/確認/);assert.throws(()=>recordExport(s,body,JSON.stringify(plan)),/確認/);assert(s.tickets.every(t=>!t.payload));
 setCommonCharacter(s,schema.characters[0]);s.tickets[0].code2='不正';plan=logicalPlan(s,body);assert(plan.issues.some(i=>i.page==='review'));s.tickets[0].code2=schema.code2;s.tickets[0].approved=0;plan=logicalPlan(s,body);assert(plan.issues.some(i=>i.page==='review'));assert.equal(logicalPlan(s,{...body,exclude_unconfirmed:true}).count,4);
});
test('プレビュー後に共通キャラが変わった場合、古い出力内容を記録しない',()=>{
 const s=fixture(),plan=logicalPlan(s,body);setCommonCharacter(s,schema.characters[1]);assert.throws(()=>recordExport(s,body,JSON.stringify(plan)),/変わりました/);assert(s.tickets.every(t=>t.history.length===0));
});
test('コード専用のキャラ記録と以前の回答・住所はバックアップで保持する',async()=>{
 const s=fixture();exportTickets(s);setStatuses(s,s.tickets.map(t=>t.id),'done');const images=new Map(s.tickets.map(t=>[t.image,new Blob(['fake image'])]));const decoded=await decodeBackup(await encodeBackup(s,images));assert.deepEqual(decoded.state,s);assert.equal(decoded.state.tickets[0].payload!.character,schema.characters[0]);assert.equal(decoded.state.tickets[0].answers.c_q29,'以前の個別回答');
});
test('旧版でキャラが空欄の出力履歴へ、現在の共通キャラを勝手に割り当てない',()=>{
 const s=fixture(),t=s.tickets[0];t.state='prepared';t.payload={code:t.code,code2:t.code2,character:'',profile:{},answers:{}};assert.equal(effective(t,s).character,'');assert.throws(()=>setStatus(s,t.id,{state:'done'}),/キャラ/);setTicketCharacter(s,t.id,schema.characters[1]);setStatus(s,t.id,{state:'done'});assert.equal(effective(t,s).character,schema.characters[1]);
});
