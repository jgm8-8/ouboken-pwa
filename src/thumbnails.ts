import {readState,readImage,mutate,imageUrl,cacheImageUrl} from './store';
export function thumbnailSize(width:number,height:number){const scale=Math.min(1,160/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))}}
export async function thumbnailFromCanvas(source:HTMLCanvasElement|HTMLImageElement){
 const w=source instanceof HTMLImageElement?source.naturalWidth:source.width,h=source instanceof HTMLImageElement?source.naturalHeight:source.height;
 const canvas=document.createElement('canvas');Object.assign(canvas,thumbnailSize(w,h));canvas.getContext('2d')!.drawImage(source,0,0,canvas.width,canvas.height);
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('一覧画像を作れませんでした')),'image/jpeg',.7));
}
let queue:Promise<unknown>=Promise.resolve();const pending=new Map<string,Promise<string>>();
export function ensureThumbnail(id:string){
 if(pending.has(id))return pending.get(id)!;
 const task=queue.then(async()=>{
  const ticket=(await readState()).tickets.find(t=>t.id===id);if(!ticket)throw Error('応募券が見つかりません');
  if(ticket.thumbnail){const existing=await readImage(ticket.thumbnail);if(existing)return imageUrl(ticket.thumbnail)||cacheImageUrl(ticket.thumbnail,existing)}
  const original=await readImage(ticket.image);if(!original)throw Error('写真が見つかりません');
  const url=URL.createObjectURL(original),image=new Image();let blob:Blob;try{await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('写真を開けません'));image.src=url});blob=await thumbnailFromCanvas(image)}finally{URL.revokeObjectURL(url)}
  const name=id+'-thumb.jpg';await mutate((state,images)=>{const current=state.tickets.find(t=>t.id===id);if(!current||current.image!==ticket.image)throw Error('応募券が変更されました');current.thumbnail=name;images.put(blob,name)});return cacheImageUrl(name,blob);
 });pending.set(id,task);queue=task.catch(()=>{});void task.finally(()=>pending.delete(id)).catch(()=>{});return task;
}
