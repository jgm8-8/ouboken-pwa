import {zipSync,strToU8} from 'fflate';
import {schema,effective,profileIssues,payloadFor,find} from './domain';
import {digest,now} from './store';
import type {Payload,State} from './store';
export type ExportBody={ids?:string[],mode?:'fields'|'codes',exclude_unconfirmed?:boolean,fingerprint?:string};
export const oneLine=(value:unknown)=>String(value??'').replace(/[\r\n\u0085\u2028\u2029]+/g,' ').replace(/^\uFEFF/,'').trim();
export function copyFields(p:Payload):[string,string][]{
 const fields:[string,unknown][]=[['シリアルコード①',p.code],['シリアルコード②',p.code2]];
 fields.push(...schema.profile.filter(([key])=>!(String(key)in schema.selects)).map(([key,label])=>[String(label),p.profile[String(key)]??'']as[string,string]));
 for(const q of schema.questions){if(q.id==='c_q26'&&p.answers.c_q25!=='サイトは見たが購入には至らなかった')continue;const value=p.answers[q.id]??'';if(q.type==='text')fields.push([q.label,value]);if(value==='その他'||Array.isArray(value)&&value.includes('その他'))fields.push([q.label+'（その他）',p.answers[q.id+'_etc']??''])}
 return fields.map(([label,value])=>[label,oneLine(value)]as[string,string]).filter(([,value])=>!!value);
}
export function logicalPlan(state:State,body:ExportBody){
 const mode=body.mode??'fields';if(!['fields','codes'].includes(mode))throw Error('出力形式が正しくありません');
 if(body.ids&&new Set(body.ids).size!==body.ids.length)throw Error('同じ応募券が重複しています');
 const rows=body.ids?body.ids.map(id=>find(state,id)):state.tickets;
 const active=rows.filter(t=>!['done','unknown'].includes(t.state)),unchecked=active.filter(t=>!t.approved||!t.code),confirmed=active.filter(t=>t.approved&&t.code);
 const issues=unchecked.length&&!body.exclude_unconfirmed?[{page:'review',message:`未確認 ${unchecked.length}枚`,count:unchecked.length}as{page:string,message:string,id?:string,count?:number}]:[];
 if(mode==='fields'&&confirmed.length){issues.push(...profileIssues(state.profile));const missing=confirmed.filter(t=>!effective(t,state).character);if(missing.length)issues.push({page:'survey',message:`希望キャラクター未設定 ${missing.length}枚`})}
 const snapshots:Record<string,Payload>={},entries:{line:number,ticket_id:string,code:string,filename:string,label:string,value:string}[]=[],tickets:{code:string,filename:string,start:number,end:number}[]=[];
 if(mode==='codes'||!issues.some(i=>['profile','survey'].includes(i.page)))for(const t of confirmed){
  const payload=mode==='fields'?payloadFor(t,state):{profile:{},answers:{},character:'',code:t.code,code2:t.code2};snapshots[t.id]=payload;
  const fields=mode==='fields'?copyFields(payload):[['シリアルコード①',t.code]];
  const start=entries.length+1;for(const [label,value]of fields)entries.push({line:entries.length+1,ticket_id:t.id,code:t.code,filename:t.filename,label,value:oneLine(value)});
  tickets.push({code:t.code,filename:t.filename,start,end:entries.length});
 }
 return {mode,issues,unconfirmed:unchecked.length,excluded:rows.length-active.length,skipped:rows.length-tickets.length,snapshots,entries,tickets,count:entries.length,ticket_count:tickets.length};
}
export async function preview(state:State,body:ExportBody){const plan=logicalPlan(state,body);return {...plan,fingerprint:await digest(new TextEncoder().encode(JSON.stringify(plan)))}}
export const safeCell=(value:unknown)=>{const s=String(value);return (/^\s*[=+@-]/.test(s)?"'":'')+s.replace(/[\r\n\t]+/g,' ')};
export function makeZip(plan:ReturnType<typeof logicalPlan>){
 if(plan.issues.length)throw Error('出力前の確認が必要です');if(!plan.count)throw Error('出力対象の券がありません');
 const mapping=[['行番号','シリアルコード①','写真','項目'],...plan.entries.map(e=>[e.line,e.code,e.filename,e.label])].map(row=>row.map(safeCell).join('\t')).join('\n')+'\n';
 return new Blob([zipSync({'コピー一覧.txt':strToU8(plan.entries.map(e=>e.value).join('\n')),'次の位置.txt':strToU8('1'),'項目一覧.tsv':strToU8(mapping),'はじめに.txt':strToU8(`${plan.ticket_count}枚 / ${plan.count}行\nコピー一覧.txtと次の位置.txtを同じOubokenフォルダへ保存してください。\n一覧を交換するときは次の位置.txtも置き換えてください。\n空欄と選択式回答は省略しています。\n応募はSafariで手動で行います。\n`)},{level:6})as Uint8Array<ArrayBuffer>],{type:'application/zip'});
}
export function recordExport(state:State,body:ExportBody,expected:string){
 // Comparing the entire logical plan avoids a crypto await inside the IDB transaction.
 const plan=logicalPlan(state,body);if(JSON.stringify(plan)!==expected)throw Error('出力内容が変わりました。プレビューを開き直してください。');
 for(const [id,payload]of Object.entries(plan.snapshots)){const t=find(state,id);if(plan.mode==='fields'){t.payload=structuredClone(payload);t.state='prepared'}t.history.unshift({state:plan.mode==='fields'?'prepared':'exported_codes',note:plan.mode==='fields'?'iPhone用に一括出力（コード・住所・自由記述）':'iPhone用に一括出力（コードのみ）',created:now(),snapshot:structuredClone(payload)})}
}
