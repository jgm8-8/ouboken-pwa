import {useState,useEffect} from 'react';
let registration:ServiceWorkerRegistration|undefined;
let status='準備中…';
const event=()=>window.dispatchEvent(new Event('ouboken-pwa-status'));
export async function startPwa(){
 if(!window.isSecureContext){status='ホーム画面追加とオフライン利用にはHTTPSの公開URLが必要です。';event();return}
 if(!('serviceWorker'in navigator)){status='このブラウザではオフライン利用に対応していません。';event();return}
 if(!import.meta.env.PROD){status='開発プレビューです。オフライン利用は本番ビルドで確認してください。';event();return}
 try{
  registration=await navigator.serviceWorker.register(new URL('sw.js',new URL(import.meta.env.BASE_URL,location.href)),{scope:import.meta.env.BASE_URL,updateViaCache:'none'});
  registration.addEventListener('updatefound',()=>{const worker=registration?.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'){status=navigator.serviceWorker.controller?'更新があります':'オフライン準備済み';event()}if(worker.state==='redundant'){status='オフラインの準備に失敗しました。オンラインで再読み込みしてください。';event()}})});
  await navigator.serviceWorker.ready;status=registration.waiting?'更新があります':'オフライン準備済み';event();
 }catch{status='オフラインの準備に失敗しました。オンラインで再読み込みしてください。';event()}
}
export function PwaStatus(){
 const [label,setLabel]=useState(status),[persisted,setPersisted]=useState(false);
 useEffect(()=>{const refresh=()=>setLabel(status);window.addEventListener('ouboken-pwa-status',refresh);navigator.storage?.persisted?.().then(setPersisted).catch(()=>{});return()=>window.removeEventListener('ouboken-pwa-status',refresh)},[]);
 return <section className="panel"><h2>アプリ</h2><p>{label}</p><p className="muted">Safariの共有から「ホーム画面に追加」。入力内容はこの端末内に保存します。{persisted?'保存の保持が許可されています。':'台帳はバックアップも保存してください。'}</p>{registration?.waiting&&<button className="secondary" onClick={()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration!.waiting!.postMessage('ACTIVATE')}}>更新して再起動</button>}{!persisted&&navigator.storage?.persist&&<button className="secondary" onClick={()=>void navigator.storage.persist().then(setPersisted)}>保存の保持をリクエスト</button>}</section>;
}
