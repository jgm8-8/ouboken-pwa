import {useState,useEffect} from 'react';
import {workerRequest} from './storage-health';
let registration:ServiceWorkerRegistration|undefined;
let status='準備中…';
const event=()=>window.dispatchEvent(new Event('ouboken-pwa-status'));
export async function startPwa(){
 if(!window.isSecureContext){status='ホーム画面追加とオフライン利用にはHTTPSの公開URLが必要です。';event();return}
 if(!('serviceWorker'in navigator)){status='このブラウザではオフライン利用に対応していません。';event();return}
 if(!import.meta.env.PROD){status='開発プレビューです。オフライン利用は本番ビルドで確認してください。';event();return}
 try{
  registration=await navigator.serviceWorker.register(new URL('sw.js',new URL(import.meta.env.BASE_URL,location.href)),{scope:import.meta.env.BASE_URL,updateViaCache:'none'});
  registration.addEventListener('updatefound',()=>{const worker=registration?.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'){worker.postMessage('PRUNE');status=navigator.serviceWorker.controller?'更新があります':'オフライン準備済み';event()}if(worker.state==='redundant'){status='オフラインの準備に失敗しました。オンラインで再読み込みしてください。';event()}})});
  await navigator.serviceWorker.ready;registration.waiting?.postMessage('PRUNE');status=registration.waiting?'更新があります':'オフライン準備済み';event();
 }catch{status='オフラインの準備に失敗しました。オンラインで再読み込みしてください。';event()}
}
export function PwaStatus(){
 const [label,setLabel]=useState(status),[persisted,setPersisted]=useState(false),[requesting,setRequesting]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{const refresh=()=>{setLabel(status);void workerRequest('HEALTH').then(health=>{if(health?.missing.length)setLabel('キャッシュ不足（オンラインで再準備できます）')}).catch(()=>{})};refresh();window.addEventListener('ouboken-pwa-status',refresh);navigator.storage?.persisted?.().then(setPersisted).catch(()=>{});return()=>window.removeEventListener('ouboken-pwa-status',refresh)},[]);
 const request=async()=>{setRequesting(true);try{const allowed=await navigator.storage.persist();setPersisted(allowed);setMessage(allowed?'自動削除を抑える設定になりました。':'Safariが許可しませんでした。入力内容の自動保存は引き続き使えます。')}catch{setMessage('このブラウザでは設定を変更できませんでした。')}finally{setRequesting(false)}};
 return <section className="panel"><h2>アプリ</h2><p>{label}</p><p className="muted">Safariの共有から「ホーム画面に追加」。入力内容はこの端末内に保存します。</p>{registration?.waiting&&<button className="secondary" onClick={()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration!.waiting!.postMessage('ACTIVATE')}}>更新して再起動</button>}<details><summary>データの保存について</summary><p className="muted">容量不足などによる自動削除を抑える設定です。Safariが許可するかを判断します。閲覧データの削除には対応できないため、バックアップもファイルに保存してください。</p>{persisted?<p className="muted">自動削除を抑える設定：有効</p>:typeof navigator.storage?.persist==='function'&&<button className="secondary" disabled={requesting} onClick={()=>void request()}>{requesting?'確認中…':'自動削除を抑える'}</button>}{message&&<p role="status" className="muted">{message}</p>}</details></section>;
}

