import {useState,useRef,useEffect} from 'react';
import {X} from 'lucide-react';
import {createBackupFile,decodeBackup,restoreBackup,backupFilename,backupTime} from './backup';
import {download} from './api';
import type {State} from './store';
import type {BackupMetadata} from './backup';
export function BackupPanel({home=false,disabled=false,createOnly=false,flush}:{home?:boolean,disabled?:boolean,createOnly?:boolean,flush:()=>Promise<void>}){
 const [metadata,setMetadata]=useState<BackupMetadata|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[mode,setMode]=useState<'create'|'restore'|null>(null),[file,setFile]=useState<File|null>(null),[prepared,setPrepared]=useState<{state:State,images:Map<string,Blob>,metadata:BackupMetadata}|null>(null);
 const picker=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(mode)dialog.current?.showModal()},[mode]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 const close=()=>{if(!busy){setMode(null);setPrepared(null);setFile(null);setError('')}};
 const create=()=>{setFile(null);setPrepared(null);setMode('create');void run(async()=>{await flush();const {blob,metadata}=await createBackupFile();setMetadata(metadata);setFile(new File([blob],backupFilename(metadata),{type:blob.type}))})};
 const save=()=>void run(async()=>{if(!file)return;if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Oubokenバックアップ'});setMode(null);return}catch(e){if((e as Error).name==='AbortError')return}}download(file,file.name);setMode(null)});
 return <section className={createOnly?'backup-only':home?'home-backup':'panel'}>{!home&&!createOnly&&<h2>バックアップ・復元</h2>}<div className="backup-actions"><button className="secondary" disabled={disabled||busy} onClick={create}>バックアップを作成</button>{!createOnly&&<button className="secondary" disabled={disabled||busy} onClick={()=>picker.current?.click()}>バックアップから復元</button>}</div>
 <input ref={picker} type="file" accept=".ouboken,application/octet-stream" hidden onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected){setPrepared(null);setFile(null);setMode('restore');void run(async()=>setPrepared(await decodeBackup(selected)))}}}/>
 {mode&&<dialog ref={dialog} className="shortcut-dialog backup-dialog" aria-labelledby="backup-title" onCancel={e=>{if(busy)e.preventDefault();else close()}}><div className="shortcut-dialog-body"><div className="section-title"><h2 id="backup-title">{mode==='create'?'バックアップを作成':'バックアップから復元'}</h2><button className="icon-button" aria-label="閉じる" disabled={busy} onClick={close}><X size={20}/></button></div>
 {busy&&<p role="status" className="muted">処理中…</p>}{error&&<p className="alert" role="alert">{error}</p>}
 {file&&<><p>写真・応募者情報・回答・履歴をまとめました。</p><dl className="backup-info"><div><dt>作成日時</dt><dd>{metadata&&backupTime(metadata)}</dd></div><div><dt>応募券</dt><dd>{metadata?.ticket_count}枚</dd></div></dl><p className="muted">{file.name}</p><button className="primary export-download" disabled={busy} onClick={save}>ファイルに保存</button></>}
 {prepared&&<><dl className="backup-info"><div><dt>作成日時</dt><dd>{backupTime(prepared.metadata)}</dd></div><div><dt>応募券</dt><dd>{prepared.state.tickets.length}枚</dd></div></dl><p className="muted">現在の写真・応募者情報・回答・履歴を、このバックアップの内容で置き換えます。</p><div className="delete-actions"><button className="secondary" disabled={busy} onClick={close}>キャンセル</button><button className="primary" disabled={busy} onClick={()=>void run(async()=>{await flush();await restoreBackup(prepared);location.reload()})}>復元する</button></div></>}
 </div></dialog>}</section>;
}
