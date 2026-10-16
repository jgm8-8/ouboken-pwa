import {useEffect,useState,useRef} from 'react';
// Serialize writes so a slow response cannot overwrite a newer edit.
export function useAutosave(value:unknown, dirty:boolean, ready:boolean, write:(value:any)=>Promise<void>, clean:()=>void){
 const serialized=JSON.stringify(value);
 const latest=useRef({serialized,dirty,ready,write,clean});
 latest.current={serialized,dirty,ready,write,clean};
 const saved=useRef(serialized), flight=useRef<Promise<void>|null>(null);
 const [status,setStatus]=useState(''),[failure,setFailure]=useState('');
 const flush=async():Promise<void>=>{
  if(flight.current){await flight.current;return flush()}
  if(!latest.current.ready||!latest.current.dirty)return;
  if(saved.current===latest.current.serialized){latest.current.clean();return}
  const task=(async()=>{
   setStatus('保存中…');setFailure('');
   try{
    while(latest.current.ready&&latest.current.dirty&&saved.current!==latest.current.serialized){
     const snapshot=latest.current.serialized;
     await latest.current.write(JSON.parse(snapshot));saved.current=snapshot;
    }
    latest.current.clean();setStatus('自動保存済み');
   }catch(e){setStatus('保存できませんでした');setFailure((e as Error).message);throw e}
  })();
  flight.current=task;
  try{await task}finally{flight.current=null}
 };
 useEffect(()=>{
  if(!dirty){saved.current=serialized;return}
  setStatus('保存待ち…');
  const timer=setTimeout(()=>{void flush().catch(()=>{})},600);
  return()=>clearTimeout(timer);
 },[serialized,dirty,ready]);
 useEffect(()=>{
  const warn=(e:BeforeUnloadEvent)=>{if(latest.current.dirty){e.preventDefault();e.returnValue=''}};
  const hide=()=>{if(document.visibilityState==='hidden')void flush().catch(()=>{})};
  window.addEventListener('beforeunload',warn);document.addEventListener('visibilitychange',hide);
  return()=>{window.removeEventListener('beforeunload',warn);document.removeEventListener('visibilitychange',hide)};
 },[]);
 return {flush,status,failure};
}
export function SaveStatus({save}:{save:ReturnType<typeof useAutosave>}){return <div className="save-status" role="status"><span>{save.status}</span>{save.failure&&<><span className="save-error">{save.failure}</span><button className="secondary" onClick={()=>void save.flush().catch(()=>{})}>再試行</button></>}</div>}
