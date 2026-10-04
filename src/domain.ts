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
 const unused=[...new Set([ticket.image,ticket.crop,ticket.thumbnail,ticket.id+'-crop.jpg',ticket.id+'-thumb.jpg'].filter((name):name is string=>!!name))].filter(name=>!state.tickets.some(t=>t.image===name||t.crop===name||t.thumbnail===name));
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
 if(typeof code2!=='string'||code2.length>4000)throw Error('コード②を4000文字以内で入力してください');
 if(code&&!/^[A-Za-z0-9]{1,64}$/.test(code))throw Error('コード①は券面どおりの英数字で入力してください');
 if(approved&&(!code||code2!==schema.code2))throw Error('画像とコード①・②を確認してください');
 if(code&&state.tickets.some(other=>other.id!==t.id&&other.code===code&&other.code2===code2))throw Error('同じシリアルコードが登録済みです。重複を確認してください。');
}
export function editTicket(state:State,id:string,body:any){
 const t=find(state,id);unlocked(t);const code=String(body.code??'').trim(),code2=body.code2??schema.code2,answers=body.answers??{},character=body.character??'';
 validateCode(state,t,code,code2,!!body.approved);validateAnswers(answers);
 if(character&&!schema.characters.includes(character))throw Error('キャラクターを選択してください');
 if(t.payload||t.history[0]?.state==='exported_codes')t.history.unshift({state:'edited',note:'出力後の内容を編集',created:now(),snapshot:t.payload?structuredClone(t.payload):null});
 Object.assign(t,{code,code2,answers,character,approved:Number(!!body.approved),state:body.approved?'ready':'review',payload:null,note:'',ocr_pending:false});
}
export function confirm(state:State,id:string,body:any){
 const t=find(state,id);unlocked(t);const code=String(body.code??'').trim(),code2=body.code2??schema.code2;
 validateCode(state,t,code,code2,true);Object.assign(t,{code,code2,approved:1,state:'ready',payload:null,note:'',ocr_pending:false});
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
 const t=find(state,id),target=String(body.state);if(!['review','ready','prepared','done','unknown'].includes(target))throw Error('状態が正しくありません');
 if(target===t.state)return;
 if(target==='ready'){validateCode(state,t,t.code,t.code2,true);if(!t.approved)throw Error('先に画像とコードを照合してください')}
 if(['done','unknown'].includes(target)&&!t.payload&&t.approved){const last=t.history[0];if(last?.state==='exported_codes'&&last.snapshot?.code===t.code&&last.snapshot.code2===t.code2)t.payload=structuredClone(last.snapshot)}
 if(['prepared','done','unknown'].includes(target)&&!t.payload)throw Error('内容を編集した場合は、もう一度iPhone用ファイルを出力してください');
 const snapshot=t.payload?structuredClone(t.payload):null;
 // Code-only exports do not contain answers; retain the original editable text.
 if(['done','unknown'].includes(t.state)&&['review','ready','prepared'].includes(target)&&snapshot&&(snapshot.character||Object.keys(snapshot.answers).length||Object.keys(snapshot.profile).length)){t.answers=structuredClone(snapshot.answers);t.character=snapshot.character}
 if(['review','ready'].includes(target)){
  t.payload=null;if(target==='review')t.approved=0;
 }
 t.state=target;t.note=String(body.note||({'review':'要確認に戻して編集を再開','ready':'確認済みに戻して編集を再開','prepared':'出力済みとして記録','done':'利用者が応募済みとして記録（サイトの受付確認は行っていません）','unknown':'利用者が結果不明として記録'}as Record<string,string>)[target]).slice(0,255);
 t.history.unshift({state:target,note:t.note,created:now(),snapshot});
}
export function applyRecognizedCode(state:State,id:string,text:string,confidence:number,box:number[][]=[]){
 const t=state.tickets.find(t=>t.id===id);if(!t||!t.ocr_pending||t.approved||['done','unknown'].includes(t.state))return null;
 const valid=/^[A-Z0-9]{10}$/.test(text)&&confidence>=.7,code=valid?text:'';
 const duplicate=code?state.tickets.find(other=>other.id!==id&&other.code===code&&other.code2===schema.code2):undefined;
 t.code=duplicate?'':code;t.ocr={candidates:valid?[{text,confidence,box}]:[],lines:text?[text]:[]};t.ocr_pending=false;
 if(duplicate)t.note='同じコードの応募券が登録済みです。候補を確認してください。';
 else if(valid)t.note=/[0O1I]/.test(code)?'0・O、1・Iは券面と照合してください。':'画像とコードを照合してください。';
 return duplicate?{filename:t.filename,code,existing:duplicate.filename}:null;
}

export const needsOcr=(t:RawTicket)=>!!t.ocr_pending&&!t.approved&&t.state==='review';
export function clearInactiveOcr(state:State){for(const t of state.tickets)if(t.ocr_pending&&!needsOcr(t))t.ocr_pending=false}
export function replaceCrop(state:State,images:IDBObjectStore,id:string,crop?:Blob){
 const t=find(state,id),previous=t.crop,shared=state.tickets.some(other=>other.id!==id&&(other.image===previous||other.crop===previous||other.thumbnail===previous));t.crop=crop?t.id+'-crop'+(shared?'-'+crypto.randomUUID():'')+'.jpg':t.image;if(crop)images.put(crop,t.crop);
 const removed:string[]=[];if(previous!==t.crop&&!state.tickets.some(other=>other.image===previous||other.crop===previous||other.thumbnail===previous)){images.delete(previous);removed.push(previous)}
 return [...removed,...(crop?[t.crop]:[])];
}
export function setStatuses(state:State,ids:string[],target:string){
 if(!Array.isArray(ids)||!ids.length||ids.length>3000||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('変更する応募券を選択してください');
 const staged=structuredClone(state);let changed=0;
 for(const id of ids){const t=find(staged,id);try{if(t.state!==target)changed++;setStatus(staged,id,{state:target})}catch(e){throw Error((t.code||t.filename)+'：'+(e as Error).message)}}
 Object.assign(state,staged);return {changed};
}
