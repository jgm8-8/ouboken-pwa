import {llmConfig,generate} from './llm';
import {readState,mutate,primeImages,releaseImageUrls} from './store';
import {schema,effective,find,editTicket,confirm,setStatus,validateAnswers,removeTicket} from './domain';
import {preview,logicalPlan,makeZip,recordExport,safeCell} from './export';
import type {ExportBody} from './export';
import {upload,job,resume,retryUnconfirmed} from './ocr';
export {imageUrl} from './store';
export async function api(path:string,method='GET',body:any=undefined):Promise<any>{
 if(path==='/bootstrap'){const state=await readState();return {token:'local',profile:state.profile,survey:state.survey,llm:{model:llmConfig().model,has_key:llmConfig().has_key},schema,job:await resume()}}
 if(path==='/tickets'&&method==='GET'){const state=await readState();await primeImages();return state.tickets.map(t=>effective(t,state))}
 if(path==='/settings'&&method==='PUT')return mutate(state=>{validateAnswers(body.survey?.answers??{});if(body.survey?.character&&!schema.characters.includes(body.survey.character))throw Error('キャラクターを選択してください');state.profile=Object.fromEntries(schema.profile.map(([key])=>[String(key),String(body.profile?.[String(key)]??'').slice(0,255)]));state.survey=body.survey??{};return {ok:true}});
 if(path==='/upload'&&method==='POST')return upload((body as FormData).getAll('files')as File[]);
 if(path==='/ocr/retry'&&method==='POST')return retryUnconfirmed();
 if(path.startsWith('/jobs/'))return job(path.slice(6));
 if(path==='/drafts')return {variants:[]};
 if(path==='/generate'&&method==='POST')return generate(body);
 if(path==='/shortcuts/preview')return preview(await readState(),body);
 const match=path.match(/^\/tickets\/([^/]+)(?:\/(confirm|status))?$/);
 if(match){const [,id,action]=match;if(method==='GET'){const state=await readState();await primeImages();return effective(find(state,id),state)}
  if(method==='DELETE'&&!action){const names=await mutate((state,images)=>removeTicket(state,images,id));releaseImageUrls(names);return {ok:true}}
  return mutate(state=>{if(action==='confirm')confirm(state,id,body);else if(action==='status')setStatus(state,id,body);else if(method==='PUT')editTicket(state,id,body);else throw Error('この操作には対応していません');return {ok:true}});
 }
 throw Error('この操作には対応していません');
}
export async function exportZip(body:ExportBody){
 const plan=await preview(await readState(),body);
 if(!body.fingerprint||body.fingerprint!==plan.fingerprint)throw Error('出力内容が変わりました。プレビューを開き直してください。');
 const blob=makeZip(plan);
 const {fingerprint:_,...logical}=plan;
 await mutate(state=>recordExport(state,body,JSON.stringify(logical)));
 return blob;
}
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
export async function exportCsv(){
 const state=await readState();const rows=[['シリアル','状態','キャラクター','回答(JSON)'],...state.tickets.map(t=>{const e=effective(t,state);return [t.code,t.state,e.character,JSON.stringify(e.answers)]})];
 const text='\uFEFF'+rows.map(row=>row.map(value=>'"'+safeCell(value).replace(/"/g,'""')+'"').join(',')).join('\r\n');download(new Blob([text],{type:'text/csv;charset=utf-8'}),'ouboken.csv');
}
