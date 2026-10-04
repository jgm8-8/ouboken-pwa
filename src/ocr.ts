import {createWorker,PSM} from 'tesseract.js';
import type {Worker} from 'tesseract.js';
import {digest,uniqueId,now,mutate,readState,readImages} from './store';
import {schema} from './domain';
import type {RawTicket} from './store';
// Vite's BASE_URL can be relative; use the document's app root, never a CDN.
const root=new URL(import.meta.env.BASE_URL,location.href);
let worker:Promise<Worker>|undefined;
let serial=Promise.resolve();
const jobs=new Map<string,{status:string,total:number,done:number,results:unknown[],errors:{filename:string,message:string}[]}>();
function engine(){
 if(!worker)worker=createWorker('eng',1,{workerPath:new URL('ocr/worker.min.js',root).href,corePath:new URL('ocr/core/',root).href,langPath:new URL('ocr/lang/',root).href,workerBlobURL:false,cacheMethod:'none',gzip:true}).then(async w=>{await w.setParameters({tessedit_pageseg_mode:PSM.AUTO});return w}).catch(e=>{worker=undefined;throw e});
 return worker;
}
const toBlob=(canvas:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('写真を変換できませんでした')),'image/jpeg',.9));
async function decode(blob:Blob){
 const url=URL.createObjectURL(blob),image=new Image();try{await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('写真を開けません。JPEG・PNGで選び直してください。'));image.src=url});return image}finally{URL.revokeObjectURL(url)}
}
async function normalize(blob:Blob){
 const image=await decode(blob);if(image.naturalWidth*image.naturalHeight>45_000_000)throw Error('写真が大きすぎます');
 const canvas=document.createElement('canvas'),scale=Math.min(1,2000/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return {blob:await toBlob(canvas),canvas};
}
async function recognize(ticket:RawTicket,blob:Blob){
 const image=await decode(blob);const w=await engine();
 // HTMLImageElement would make Tesseract fetch its already-revoked blob URL.
 const result=await w.recognize(blob,{}, {blocks:true,text:true});
 const words=result.data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)))??[];
 // This event uses ten-character codes; excluding dates prevents false candidates.
 const candidates=words.filter(w=>/^[A-Z0-9]{10}$/.test(w.text.replace(/\s/g,''))&&/[A-Z]/.test(w.text)&&/[0-9]/.test(w.text)).map(word=>({text:word.text.replace(/\s/g,''),confidence:word.confidence/100,box:[[word.bbox.x0,word.bbox.y0],[word.bbox.x1,word.bbox.y0],[word.bbox.x1,word.bbox.y1],[word.bbox.x0,word.bbox.y1]]}));
 const unique=[...new Map(candidates.map(c=>[c.text,c])).values()];let crop:Blob|undefined;
 if(unique.length===1){const box=unique[0].box;const x=Math.max(0,box[0][0]-20),y=Math.max(0,box[0][1]-20),width=Math.min(image.naturalWidth-x,box[2][0]-x+20),height=Math.min(image.naturalHeight-y,box[2][1]-y+20);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.drawImage(image,x,y,width,height,0,0,width,height);crop=await toBlob(canvas)}
 await mutate((state,images)=>{const t=state.tickets.find(t=>t.id===ticket.id);if(!t||!t.ocr_pending)return;const code=unique.length===1?unique[0].text:'';const duplicate=code&&state.tickets.some(other=>other.id!==t.id&&other.code===code&&other.code2===schema.code2);t.code=duplicate?'':code;t.ocr={candidates:unique,lines:result.data.text.split('\n').filter(Boolean)};t.note=duplicate?'同じコードの応募券が登録済みです。候補を確認してください。':unique.length?'画像とコードを照合してください。':'コードを読み取れませんでした。券面を見て入力してください。';t.ocr_pending=false;if(crop){t.crop=t.id+'-crop.jpg';images.put(crop,t.crop)}});
}
async function pending(jobId:string){
 const job=jobs.get(jobId)!;const state=await readState(),images=await readImages();const pending=state.tickets.filter(t=>t.ocr_pending);job.total=pending.length;
 for(const t of pending){try{const blob=images.get(t.image);if(!blob)throw Error('写真が見つかりません');await recognize(t,blob);job.results.push({id:t.id})}catch(e){console.error('写真の読み取り:',e);await mutate(s=>{const item=s.tickets.find(x=>x.id===t.id);if(item){item.ocr_pending=false;item.note='読み取りに失敗しました。写真を開いてコードを入力してください。 '+(e as Error).message}});job.errors.push({filename:t.filename,message:(e as Error).message})}job.done++}
 job.status='done';
}
export async function upload(files:File[]){
 if([...jobs.values()].some(j=>j.status==='running'))throw Error('取り込み中です。完了後に追加してください。');
 if(!files.length||files.length>150)throw Error('一度に1〜150枚を選択してください');
 const id=uniqueId(),job={status:'running',total:files.length,done:0,results:[]as unknown[],errors:[]as{filename:string,message:string}[]};jobs.set(id,job);
 serial=serial.then(async()=>{
  for(const file of files){try{if(file.size>25_000_000)throw Error('1枚25MB以内で選択してください');const hash=await digest(await file.arrayBuffer());if((await readState()).tickets.some(t=>t.hash===hash)){job.results.push({duplicate:true});continue}const normalized=await normalize(file),ident=uniqueId();await mutate((state,images)=>{if(state.tickets.some(t=>t.hash===hash))return;images.put(normalized.blob,ident+'.jpg');state.tickets.unshift({id:ident,hash,filename:file.name,image:ident+'.jpg',crop:ident+'.jpg',code:'',code2:schema.code2,qr:'',ocr:{candidates:[],lines:[]},state:'review',answers:{},approved:0,character:'',note:'読み取り待ち',created:now(),payload:null,history:[],ocr_pending:true})})}catch(e){job.errors.push({filename:file.name,message:(e as Error).message})}}
  await pending(id);
 }).catch(e=>{job.errors.push({filename:'',message:(e as Error).message});job.status='done'});
 return {id};
}
export function job(id:string){const item=jobs.get(id);if(!item)throw Error('読み取り記録がありません');return {...item,id}}
export async function resume(){
 if([...jobs.values()].some(j=>j.status==='running'))return null;
 const count=(await readState()).tickets.filter(t=>t.ocr_pending).length;if(!count)return null;
 const id=uniqueId();jobs.set(id,{status:'running',total:count,done:0,results:[],errors:[]});serial=serial.then(()=>pending(id)).catch(e=>{const j=jobs.get(id)!;j.status='done';j.errors.push({filename:'',message:(e as Error).message})});return {id,done:0,total:count};
}
