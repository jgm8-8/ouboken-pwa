import schema from './schema.json';
import type {Answers,Payload,RawTicket,State} from './store';
import {now} from './store';
export {schema};
export function queueOcrRetry(state:State){
 let count=0;for(const t of state.tickets)if(!t.approved&&t.state==='review'){t.ocr_pending=true;t.note='読み取り待ち';count++}return count;
}
export function effective(t:RawTicket,state:State){
 const locked=['done','unknown'].includes(t.state)&&t.payload;
 return {...t,answers:locked?t.payload!.answers:{...state.survey.answers,...t.answers},character:locked?t.payload!.character:(t.character||state.survey.character||''),answer_overrides:t.answers,character_override:t.character};
}
export function find(state:State,id:string){const t=state.tickets.find(t=>t.id===id);if(!t)throw Error('応募券が見つかりません');return t}
export function removeTicket(state:State,images:IDBObjectStore,id:string){
 const ticket=find(state,id);state.tickets=state.tickets.filter(t=>t.id!==id);
 const unused=[...new Set([ticket.image,ticket.crop])].filter(name=>!state.tickets.some(t=>t.image===name||t.crop===name));
 for(const name of unused)images.delete(name);
 return unused;
}
export function unlocked(t:RawTicket){if(['done','unknown'].includes(t.state))throw Error('記録済みの内容は変更できません。状態を見直してから編集してください。')}
export function validateAnswers(answers:Answers){
 for(const q of schema.questions){const value=answers[q.id]??(q.type==='multi'?[]:'');
  if(q.type==='text'){if(typeof value!=='string'||value.length>4000)throw Error(q.label+'は4000文字以内で入力してください')}
  else {if(q.type==='multi'?!Array.isArray(value):typeof value!=='string')throw Error('回答の形式が正しくありません');const options=('options'in q?q.options:[])as string[];if((Array.isArray(value)?value:[value]).some(v=>v&&!options.includes(v)))throw Error(q.label+'の選択肢が正しくありません')}
  if(String(answers[q.id+'_etc']??'').length>255)throw Error('その他の記述は255文字以内です');
 }
}
export function validateCode(state:State,t:RawTicket,code:string,code2:string,approved:boolean){
 if(code&&!/^[A-Za-z0-9]{1,64}$/.test(code))throw Error('コード①は券面どおりの英数字で入力してください');
 if(approved&&(!code||code2!==schema.code2))throw Error('画像とコード①・②を確認してください');
 if(code&&state.tickets.some(other=>other.id!==t.id&&other.code===code&&other.code2===code2))throw Error('同じシリアルコードが登録済みです。重複を確認してください。');
}
export function editTicket(state:State,id:string,body:any){
 const t=find(state,id);unlocked(t);const code=String(body.code??'').trim(),code2=body.code2??schema.code2,answers=body.answers??{},character=body.character??'';
 validateCode(state,t,code,code2,!!body.approved);validateAnswers(answers);
 if(character&&!schema.characters.includes(character))throw Error('キャラクターを選択してください');
 Object.assign(t,{code,code2,answers,character,approved:Number(!!body.approved),state:body.approved?'ready':'review',payload:null,note:''});
}
export function confirm(state:State,id:string,body:any){
 const t=find(state,id);unlocked(t);const code=String(body.code??'').trim(),code2=body.code2??schema.code2;
 validateCode(state,t,code,code2,true);Object.assign(t,{code,code2,approved:1,state:'ready',payload:null,note:''});
}
export type Issue={id?:string,message:string,page:string,count?:number};
export function profileIssues(profile:Record<string,string>):Issue[]{
 const result:Issue[]=[];
 for(const [rawKey,label,required] of schema.profile){const key=String(rawKey),value=profile[key]??'';let message='';
  if(required&&!value.trim())message=label+'が未入力です';
  else if(value&&key in schema.selects&&!(schema.selects as Record<string,string[]>)[key].includes(value))message=label+'を選択してください';
  else if(value&&['c_q1_left','c_q1_right'].includes(key)&&!new RegExp(key.endsWith('left')?'^\\d{3}$':'^\\d{4}$').test(value))message=label+'の桁数を確認してください';
  else if(value&&key.startsWith('c_q9_')&&!new RegExp(key.endsWith('areacode')?'^\\d{1,5}$':'^\\d{1,4}$').test(value))message=label+'を数字で入力してください';
  else if(value&&key==='c_q17'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))message='メールアドレスを確認してください';
  if(message)result.push({id:key,message,page:'profile'});
 }return result;
}
export function payloadFor(t:RawTicket,state:State):Payload{
 const e=effective(t,state);return {profile:{...state.profile},answers:structuredClone(e.answers),character:e.character,code:t.code,code2:t.code2};
}
export function setStatus(state:State,id:string,body:any){
 const t=find(state,id);if(!['done','unknown','ready'].includes(body.state))throw Error('状態が正しくありません');
 if(['done','unknown'].includes(body.state)&&!t.payload&&t.approved){const last=t.history.find(h=>h.state==='exported_codes');if(last?.snapshot?.code===t.code&&last.snapshot.code2===t.code2)t.payload=structuredClone(last.snapshot)}
 if(['done','unknown'].includes(body.state)&&!t.payload)throw Error('先にiPhone用ファイルを出力してください');
 if(body.state==='ready'&&!String(body.note??'').trim())throw Error('状態を戻す理由を入力してください');
 t.state=body.state;t.note=body.note||(body.state==='done'?'利用者が応募済みとして記録（サイトの受付確認は行っていません）':'利用者が結果不明として記録');
 t.history.unshift({state:t.state,note:t.note,created:now(),snapshot:null});
}
