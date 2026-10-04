import {locateCodeField,rectify} from './code-image';
import {digest,uniqueId,now,mutate,readState,readImages} from './store';
import {schema,queueOcrRetry} from './domain';
import type {RawTicket} from './store';
// Vite's BASE_URL can be relative; use the document's app root, never a CDN.
const root=new URL(import.meta.env.BASE_URL,location.href);
let worker:Worker|undefined;
let serial=Promise.resolve();
const jobs=new Map<string,{status:string,total:number,done:number,results:unknown[],errors:{filename:string,message:string}[]}>();
async function readCode(canvas:HTMLCanvasElement){
 const resized=document.createElement('canvas'),width=Math.max(320,Math.ceil(48*canvas.width/canvas.height));resized.width=width;resized.height=48;
 const ctx=resized.getContext('2d')!;const contentWidth=Math.min(width,Math.ceil(48*canvas.width/canvas.height));ctx.drawImage(canvas,0,0,contentWidth,48);
 const rgb=ctx.getImageData(0,0,width,48).data,pixels=new Float32Array(3*48*width);
 // PP-OCRv4 uses BGR, CHW, (pixel / 255 - .5) / .5.
 for(let y=0;y<48;y++)for(let x=0;x<contentWidth;x++){const i=y*width+x;for(let c=0;c<3;c++)pixels[c*width*48+i]=rgb[i*4+2-c]/127.5-1;}
 if(!worker)worker=new Worker(new URL('./recognizer.worker.ts',import.meta.url),{type:'module'});
 return new Promise<{text:string,confidence:number}>((resolve,reject)=>{
  const timeout=setTimeout(()=>{worker?.terminate();worker=undefined;reject(Error('読み取りがタイムアウトしました。もう一度お試しください。'))},90000);
  worker!.onmessage=e=>{clearTimeout(timeout);if(e.data.error)reject(Error(e.data.error));else resolve(e.data.result)};
  worker!.onerror=e=>{clearTimeout(timeout);worker?.terminate();worker=undefined;reject(Error(e.message||'文字認識を起動できませんでした'))};
  worker!.postMessage({root:root.href,pixels,width},[pixels.buffer]);
 });
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
 const image=await decode(blob),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
 const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,gray=new Uint8Array(canvas.width*canvas.height);
 for(let i=0;i<gray.length;i++)gray[i]=rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114;
 const field=locateCodeField(gray,canvas.width,canvas.height);let crop:Blob|undefined;
 let result={text:'',confidence:0};
 if(field){
  const pixels=rectify(gray,canvas.width,canvas.height,field.quad),cropped=document.createElement('canvas');cropped.width=788;cropped.height=98;
  const c=cropped.getContext('2d')!,data=c.createImageData(788,98);
  for(let i=0;i<pixels.length;i++){data.data[i*4]=data.data[i*4+1]=data.data[i*4+2]=pixels[i];data.data[i*4+3]=255}c.putImageData(data,0,0);
  crop=await toBlob(cropped);result=await readCode(cropped);
 }
 const valid=/^[A-Z0-9]{10}$/.test(result.text)&&result.confidence>=.7;
 const candidates=valid?[{text:result.text,confidence:result.confidence,box:field!.quad}]:[];
 await mutate((state,images)=>{const t=state.tickets.find(t=>t.id===ticket.id);if(!t||!t.ocr_pending||t.approved||['done','unknown'].includes(t.state))return;const code=valid?result.text:'';const duplicate=code&&state.tickets.some(other=>other.id!==t.id&&other.code===code&&other.code2===schema.code2);t.code=duplicate?'':code;t.ocr={candidates,lines:result.text?[result.text]:[]};t.note=duplicate?'同じコードの応募券が登録済みです。候補を確認してください。':valid?(/[0O1I]/.test(code)?'0・O、1・Iは券面と照合してください。':'画像とコードを照合してください。'):field?'コードを読み取れませんでした。券面を見て入力してください。':'コード欄が見つかりませんでした。券全体を正面から撮影してください。';t.ocr_pending=false;t.crop=t.image;if(crop){t.crop=t.id+'-crop.jpg';images.put(crop,t.crop)}});
}
async function pending(jobId:string){
 const job=jobs.get(jobId)!;const state=await readState(),images=await readImages();const pending=state.tickets.filter(t=>t.ocr_pending);job.total=pending.length;
 for(const t of pending){try{const blob=images.get(t.image);if(!blob)throw Error('写真が見つかりません');await recognize(t,blob);job.results.push({id:t.id})}catch(e){console.error('写真の読み取り:',e);await mutate(s=>{const item=s.tickets.find(x=>x.id===t.id);if(item&&item.ocr_pending&&!item.approved&&!['done','unknown'].includes(item.state)){item.ocr_pending=false;item.note='読み取りに失敗しました。写真を開いてコードを入力してください。 '+(e as Error).message}});job.errors.push({filename:t.filename,message:(e as Error).message})}job.done++}
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

export async function retryUnconfirmed(){
 if([...jobs.values()].some(j=>j.status==='running'))throw Error('読み取り中です。完了後にお試しください。');
 await mutate(queueOcrRetry);
 return resume();
}
