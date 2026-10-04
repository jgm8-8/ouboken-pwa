import {useState,useRef,useEffect} from 'react';
import {X} from 'lucide-react';
import {createBackup,decodeBackup,restoreBackup} from './backup';
import {download} from './api';
import type {State} from './store';
export function BackupPanel({home=false,disabled=false,flush}:{home?:boolean,disabled?:boolean,flush:()=>Promise<void>}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[mode,setMode]=useState<'create'|'restore'|null>(null),[file,setFile]=useState<File|null>(null),[prepared,setPrepared]=useState<{state:State,images:Map<string,Blob>}|null>(null);
 const picker=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(mode)dialog.current?.showModal()},[mode]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const close=()=>{if(!busy){setMode(null);setPrepared(null);setFile(null);setError('')}};
 const create=()=>{setFile(null);setPrepared(null);setMode('create');void run(async()=>{await flush();const blob=await createBackup();setFile(new File([blob],'ouboken-backup-'+new Date().toISOString().slice(0,10)+'.ouboken',{type:blob.type}))})};
 const save=()=>void run(async()=>{if(!file)return;if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Oubokenバックアップ'});setMode(null);return}catch(e){if((e as Error).name==='AbortError')return}}download(file,file.name);setMode(null)});
 return <section className={home?'home-backup':'panel'}>{!home&&<h2>バックアップ・復元</h2>}<div className="backup-actions"><button className="secondary" disabled={disabled||busy} onClick={create}>バックアップを作成</button><button className="secondary" disabled={disabled||busy} onClick={()=>picker.current?.click()}>バックアップから復元</button></div>
 <input ref={picker} type="file" accept=".ouboken,application/octet-stream" hidden onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected){setPrepared(null);setFile(null);setMode('restore');void run(async()=>setPrepared(await decodeBackup(selected)))}}}/>
 {mode&&<dialog ref={dialog} className="shortcut-dialog backup-dialog" aria-labelledby="backup-title" onCancel={e=>{if(busy)e.preventDefault();else close()}}><div className="shortcut-dialog-body"><div className="section-title"><h2 id="backup-title">{mode==='create'?'バックアップを作成':'バックアップから復元'}</h2><button className="icon-button" aria-label="閉じる" disabled={busy} onClick={close}><X size={20}/></button></div>
 {busy&&<p role="status" className="muted">処理中…</p>}{error&&<p className="alert" role="alert">{error}</p>}
 {file&&<><p>写真・応募者情報・回答・履歴をまとめました。</p><p className="muted">{file.name}</p><button className="primary export-download" disabled={busy} onClick={save}>ファイルに保存</button></>}
 {prepared&&<><p>応募券 {prepared.state.tickets.length}枚を復元します。</p><p className="muted">現在の写真・応募者情報・回答・履歴を、このバックアップの内容で置き換えます。</p><div className="delete-actions"><button className="secondary" disabled={busy} onClick={close}>キャンセル</button><button className="primary" disabled={busy} onClick={()=>void run(async()=>{await flush();await restoreBackup(prepared);location.reload()})}>復元する</button></div></>}
 </div></dialog>}</section>;
}
