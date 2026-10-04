import {useRef,useState,useEffect} from 'react';
import {clearStoredData} from './store';
import {configureLlm} from './llm';
import {hasRunningOcr} from './ocr';
import {BackupPanel} from './BackupPanel';
export function DeleteAllPanel({disabled,flush}:{disabled:boolean,flush:()=>Promise<void>}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(confirm)dialog.current?.showModal()},[confirm]);
 const remove=async()=>{setBusy(true);setError('');try{await flush();if(hasRunningOcr())throw Error('写真の読み取りが終わってから削除してください');await clearStoredData();configureLlm('');location.reload()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 return <section className="panel delete-all-panel"><h2>データの削除</h2><p className="muted">写真・応募者情報・回答・履歴を、この端末からまとめて削除します。</p><button className="secondary delete-all-open" disabled={disabled||busy} onClick={()=>{setError('');setConfirm(true)}}>全データを削除</button>{confirm&&<dialog ref={dialog} className="shortcut-dialog" aria-labelledby="delete-all-title" onCancel={e=>{if(busy)e.preventDefault();else setConfirm(false)}}><div className="shortcut-dialog-body"><h2 id="delete-all-title">全データを削除しますか？</h2><p>写真・応募者情報・回答・履歴をすべて削除します。元に戻すにはバックアップが必要です。</p><BackupPanel createOnly disabled={busy} flush={flush}/><p className="muted">アプリのキャッシュと、ダウンロード済みのZIP・バックアップは残ります。</p>{error&&<p className="alert" role="alert">{error}</p>}<div className="delete-actions"><button className="secondary" disabled={busy} onClick={()=>setConfirm(false)}>キャンセル</button><button className="danger" disabled={busy} onClick={()=>void remove()}>{busy?'削除中…':'すべて削除する'}</button></div></div></dialog>}</section>;
}
