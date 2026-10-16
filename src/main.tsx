import React, {useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Ticket, List, Settings2, Plus, Search, ChevronRight, Copy, Check, ArrowUpRight, Download, X, LoaderCircle, ArrowLeft, Trash2} from 'lucide-react';
import './style.css';

type Answers = Record<string,string|string[]>;
type Question={id:string,label:string,type:string,options?:string[],generate?:boolean};
type Payload={profile:Record<string,string>,answers:Answers,character:string,code:string,code2:string};
type TicketData={id:string,filename:string,image:string,crop:string,thumbnail?:string,code:string,code2:string,state:string,character:string,approved:number,answers:Answers,answer_overrides?:Answers,character_override?:string,note:string,created:string,ocr:{candidates?:{text:string}[]},payload?:Payload|null,history?:{state:string,note:string,created:string,snapshot?:Payload|null}[]};
type Boot={token:string,profile:Record<string,string>,survey:{answers?:Answers,character?:string,notes?:Record<string,string>},llm:{model:string,has_key:boolean},schema:{profile:[string,string,boolean][],selects:Record<string,string[]>,questions:Question[],characters:string[],url:string,code2:string}};
import {api,imageUrl,exportZip,download as saveDownload} from './api';
import {BackupPanel} from './BackupPanel';
import {PwaStatus,startPwa} from './PwaStatus';
import {StoragePanel,useStorageWarnings} from './StoragePanel';
import {TicketThumbnail} from './TicketThumbnail';
import {DeleteAllPanel} from './DeleteAllPanel';
import {BatchStatusDialog} from './BatchStatusDialog';
// Serialize writes so a slow response cannot overwrite a newer edit.
function useAutosave(value:unknown, dirty:boolean, ready:boolean, write:(value:any)=>Promise<void>, clean:()=>void){
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
function SaveStatus({save}:{save:ReturnType<typeof useAutosave>}){return <div className="save-status" role="status"><span>{save.status}</span>{save.failure&&<><span className="save-error">{save.failure}</span><button className="secondary" onClick={()=>void save.flush().catch(()=>{})}>再試行</button></>}</div>}
const states:Record<string,string>={review:'要確認',ready:'確認済み',prepared:'出力済み',done:'応募済み（手動）',unknown:'結果不明'};
import {characterSummary} from './character-summary';
function App(){
 const uploadInput=useRef<HTMLInputElement>(null),detailFlush=useRef<null|(()=>Promise<void>)>(null);
 const [boot,setBoot]=useState<Boot|null>(null),[tickets,setTickets]=useState<TicketData[]>([]),[page,setPage]=useState('home'),[open,setOpen]=useState('');
 const [character,setCharacter]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState(''),[focusCharacter,setFocusCharacter]=useState(false);
 const [deleteTarget,setDeleteTarget]=useState<TicketData|null>(null),[job,setJob]=useState<{id:string,done:number,total:number}|null>(null),[exportIds,setExportIds]=useState<string[]|null>(null),[reviewIds,setReviewIds]=useState<string[]>([]);
 const [selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([]),[batch,setBatch]=useState<TicketData[]|null>(null),[search,setSearch]=useState(''),[filter,setFilter]=useState('');
 const [duplicates,setDuplicates]=useState<{filename:string,code:string,existing:string}[]>([]);const warnings=useStorageWarnings();
 const notify=(message:string)=>{setToast(message);setTimeout(()=>setToast(''),3000)};
 const refresh=async()=>setTickets(await api('/tickets'));
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 useEffect(()=>{void run(async()=>{const b=await api('/bootstrap');if(b.job)setJob(b.job);setBoot(b);setCharacter(b.survey.character||'');await refresh()})},[]);
 const auto=useAutosave({character},dirty,!!boot,async value=>{await api('/character','PUT',value);setBoot(b=>b?{...b,survey:{...b.survey,character:value.character}}:b);await refresh()},()=>setDirty(false));
 const flush=async()=>{await auto.flush();await detailFlush.current?.()};
 const navigate=(target:string)=>run(async()=>{await flush();setOpen('');setSelecting(false);setSelected([]);if(target==='list'){setSearch('');setFilter('')}setPage(target);window.scrollTo({top:0,behavior:'instant'})});
 useEffect(()=>{if(page==='home'&&focusCharacter){document.getElementById('common-character')?.focus();setFocusCharacter(false)}},[page,focusCharacter]);
 useEffect(()=>{if(!job)return;const timer=setInterval(async()=>{try{const r=await api('/jobs/'+job.id);setJob(r.status==='done'?null:{id:job.id,done:r.done,total:r.total});await refresh();if(r.status==='done'){setDuplicates(r.results.filter((v:any)=>v.duplicate));if(r.errors.length)setError(r.errors.map((e:{filename:string,message:string})=>e.filename+': '+e.message).join(' / '))}}catch(e){setError((e as Error).message);setJob(null)}},1500);return()=>clearInterval(timer)},[job?.id]);
 const upload=(files:FileList|null)=>{if(!files?.length)return;void run(async()=>{await flush();const data=new FormData();Array.from(files).forEach(f=>data.append('files',f));const r=await api('/upload','POST',data);setDuplicates([]);setJob({id:r.id,done:0,total:files.length})})};
 const startReview=(ids?:string[])=>run(async()=>{await flush();setReviewIds(ids||tickets.filter(t=>!t.approved&&!['done','unknown'].includes(t.state)).map(t=>t.id));setPage('review');window.scrollTo({top:0,behavior:'instant'})});
 const startExport=(ids=tickets.map(t=>t.id))=>run(async()=>{await flush();setExportIds(ids)});
 const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);notify('コピーしました')}catch{setError('コピーできませんでした。文字を長押ししてコピーしてください。')}};
 const requestDelete=(ticket:TicketData)=>run(async()=>{await flush();setDeleteTarget(ticket)});
 const deleteTicket=()=>run(async()=>{if(!deleteTarget)return;await detailFlush.current?.();await api('/tickets/'+deleteTarget.id,'DELETE');if(open===deleteTarget.id)setOpen('');setDeleteTarget(null);await refresh();notify('応募券を削除しました')});
 const toggleTicket=(id:string)=>run(async()=>{await flush();setOpen(open===id?'':id);window.scrollTo({top:0,behavior:'instant'})});
 const toggleSelection=(id:string)=>setSelected(ids=>ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]);
 const changeBatch=(state:string)=>run(async()=>{if(!batch)return;await flush();const result=await api('/tickets/status','POST',{ids:batch.map(t=>t.id),state});setBatch(null);setSelected([]);setSelecting(false);await refresh();notify(result.changed+'枚のステータスを変更しました')});
 if(!boot)return <div className="loading">{error||'読み込み中…'}</div>;
 const pending=tickets.filter(t=>!t.approved&&!['done','unknown'].includes(t.state)),active=tickets.filter(t=>!['done','unknown'].includes(t.state)),confirmed=active.filter(t=>t.approved);
 const visible=tickets.filter(t=>(!filter||t.state===filter)&&`${t.code} ${t.filename} ${t.character}`.toLowerCase().includes(search.toLowerCase()));
 const title=page==='home'?'応募券':page==='list'?(open?'応募券の詳細':'応募券一覧・履歴'):page==='settings'?'設定':'コードの確認';
 return <div className="app simple-app"><aside><div className="brand"><Ticket size={22}/><b>Ouboken</b></div><button className="header-settings" aria-label="設定" disabled={busy} onClick={()=>navigate('settings')}><Settings2 size={20}/></button></aside><div className="main"><main>
 {page!=='home'&&<button className="back-link" disabled={busy} onClick={()=>page==='list'&&open?toggleTicket(open):navigate('home')}><ArrowLeft size={18}/>前に戻る</button>}
 <div className="page-title"><h1>{title}</h1>{page==='home'&&<button className="secondary add-photo" disabled={busy||!!job} onClick={()=>uploadInput.current?.click()}><Plus size={19}/>写真</button>}{page==='list'&&!open&&<button className="secondary" disabled={busy||!!job||!tickets.length} onClick={()=>{setSelecting(!selecting);setSelected([])}}>{selecting?'選択を終了':'選択'}</button>}</div>
 {error&&<div role="alert" className="alert">{error}<button aria-label="エラーを閉じる" onClick={()=>setError('')}><X size={16}/></button></div>}
 <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>{upload(e.target.files);e.target.value=''}}/>
 {page==='home'&&<>
 {warnings.length>0&&<div className="storage-warning" role="alert">{warnings.map(m=><p key={m}>{m}</p>)}</div>}
 {duplicates.length>0&&<div className="duplicate-notice" role="status"><div><strong>重複を{duplicates.length}件検出しました</strong><button aria-label="重複通知を閉じる" onClick={()=>setDuplicates([])}><X size={16}/></button></div><details><summary>重複した写真・コード</summary>{duplicates.map((d,i)=><p key={i}>{d.filename}{d.code&&<>：<span className="serial">{d.code}</span></>}<small>登録済み：{d.existing}</small></p>)}</details></div>}
 <section className="home-work"><div className="home-count"><strong>{tickets.length}<small>枚</small></strong><span>{pending.length?`未確認 ${pending.length}枚`:`確認済み ${active.length}枚`}</span></div>
 <label className="field home-character">共通のキャラ<select id="common-character" disabled={busy} value={character} onChange={e=>{setCharacter(e.target.value);setDirty(true)}}><option value="">選択してください</option>{boot.schema.characters.map(c=><option key={c}>{c}</option>)}</select></label>
 {auto.failure&&<SaveStatus save={auto}/>}
 {job?<div className="progress"><LoaderCircle className="spin" size={18}/>写真を読み取り中 {job.done} / {job.total||'—'}</div>:!tickets.length?<button className="primary" onClick={()=>uploadInput.current?.click()}><Plus size={20}/>写真を追加</button>:<div className="workflow-steps">
 <button className="workflow-step" disabled={busy||!pending.length} onClick={()=>startReview()}><span className="step-number">1</span><span className="step-copy"><strong>コード確認</strong><small>{pending.length?`未確認 ${pending.length}枚`:'確認済み'}</small></span>{pending.length?<ChevronRight size={20}/>:<Check size={20}/>}</button>
 <button className="workflow-step" disabled={busy||!active.length} onClick={()=>startExport()}><span className="step-number">2</span><span className="step-copy"><strong>ZIPにまとめる</strong><small>コード①・②</small></span><Download size={20}/></button></div>}
 </section><BackupPanel home disabled={busy||!!job} flush={flush}/><section className="home-links"><button onClick={()=>navigate('list')}><List size={20}/><span>応募券一覧・履歴</span><ChevronRight size={18}/></button></section>
 {pending.length>0&&<details className="home-other"><summary>その他の操作</summary><button disabled={busy||!!job} onClick={()=>run(async()=>{const r=await api('/ocr/retry','POST');if(r)setJob(r)})}>未確認の写真を再読取</button></details>}</>}
 {page==='review'&&<CodeReview ids={reviewIds} refresh={refresh} registerFlush={fn=>{detailFlush.current=fn}} canExport={!!confirmed.length} onFinish={()=>startExport()} onBack={()=>navigate('home')}/>}
 {page==='list'&&<>{!open?<>
 {!!tickets.length&&<section className="character-summary" aria-label="キャラ別の枚数"><div className="section-title"><h2>キャラ別の枚数</h2><small>全{tickets.length}枚</small></div><div className="character-counts">{characterSummary(tickets).map(row=><div className="character-count" key={row.character}><strong>{row.character||'未記録'}</strong><span>計 <b>{row.total}</b>枚</span><small>応募済み {row.done}枚</small></div>)}</div></section>}
 <div className="search"><Search size={18}/><input disabled={selecting} aria-label="応募券を検索" placeholder="コード・写真名・キャラで検索" value={search} onChange={e=>setSearch(e.target.value)}/></div><select className="list-filter" disabled={selecting} aria-label="状態で絞り込み" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">すべて</option>{Object.entries(states).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
 {selecting&&<div className="bulk-bar"><span>{selected.length}枚選択</span><button disabled={busy} onClick={()=>setSelected(selected.length===visible.length?[]:visible.map(t=>t.id))}>{selected.length===visible.length?'選択解除':'すべて選択'}</button><button className="primary" disabled={busy||!selected.length} onClick={()=>{setError('');setBatch(tickets.filter(t=>selected.includes(t.id)))}}>ステータス変更</button></div>}
 {visible.map(t=><div className={'history-ticket-row'+(selected.includes(t.id)?' selected':'')} key={t.id}>{selecting&&<label className="ticket-check"><input type="checkbox" aria-label={(t.code||t.filename)+'を選択'} checked={selected.includes(t.id)} disabled={busy} onChange={()=>toggleSelection(t.id)}/></label>}<button className="history-ticket code-ticket" disabled={busy} aria-pressed={selecting?selected.includes(t.id):undefined} onClick={()=>selecting?toggleSelection(t.id):toggleTicket(t.id)}><TicketThumbnail id={t.id} image={t.image} thumbnail={t.thumbnail}/><span className="ticket-content"><b className="serial">{t.code||'未読取'}</b><span className="ticket-character">{t.character||'キャラ未記録'}</span><small><span className={'badge '+t.state}>{states[t.state]}</span></small></span>{!selecting&&<ChevronRight size={17}/>}</button>{!selecting&&<button className="ticket-delete" disabled={busy} aria-label={(t.code||t.filename)+'を削除'} onClick={()=>void requestDelete(t)}><Trash2 size={19}/></button>}</div>)}{!visible.length&&<p className="muted">該当する応募券がありません。</p>}</>:<TicketDetail key={open} id={open} boot={boot} refresh={refresh} run={run} busy={busy} notify={notify} copy={copy} registerFlush={fn=>{detailFlush.current=fn}} onBack={()=>toggleTicket(open)} onDelete={()=>{const ticket=tickets.find(t=>t.id===open);if(ticket)void requestDelete(ticket)}} onExport={()=>startExport([open])}/>}</>}
 {page==='settings'&&<><PwaStatus/><StoragePanel/><BackupPanel disabled={busy||!!job} flush={flush}/><DeleteAllPanel disabled={busy||!!job} flush={flush}/></>}
 </main></div>{batch&&<BatchStatusDialog tickets={batch} busy={busy} error={error} onCancel={()=>{setBatch(null);setError('')}} onSubmit={state=>void changeBatch(state)}/>}{exportIds&&<ShortcutExport ids={exportIds} onClose={()=>setExportIds(null)} onComplete={async()=>{await refresh();if(open)setOpen('');notify('ダウンロードを開始しました');setExportIds(null)}} onResolve={target=>{const ids=exportIds;setExportIds(null);if(target==='review')void startReview(ids.filter(id=>pending.some(t=>t.id===id)));else{void navigate('home');setFocusCharacter(true)}}}/>}{deleteTarget&&<DeleteTicketDialog ticket={deleteTarget} busy={busy} error={error} onCancel={()=>{setDeleteTarget(null);setError('')}} onDelete={()=>void deleteTicket()}/>} {toast&&<div className="toast" role="status"><Check size={18}/>{toast}</div>}</div>;
}

function DeleteTicketDialog({ticket,busy,error,onCancel,onDelete}:{ticket:TicketData,busy:boolean,error:string,onCancel:()=>void,onDelete:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal()},[]);
 return <dialog ref={ref} className="shortcut-dialog delete-dialog" aria-labelledby="delete-title" onCancel={e=>{if(busy)e.preventDefault();else onCancel()}}><div className="shortcut-dialog-body"><h2 id="delete-title">この応募券を削除しますか？</h2><p className="serial">{ticket.code||ticket.filename}</p><p className="muted">この券の写真・コード・キャラ・履歴を削除します。元には戻せません。</p>{error&&<p role="alert" className="alert">{error}</p>}<div className="delete-actions"><button className="secondary" disabled={busy} onClick={onCancel}>キャンセル</button><button className="danger" disabled={busy} onClick={onDelete}>{busy?'削除中…':'削除する'}</button></div></div></dialog>;
}

function CodeReview({ids,refresh,onFinish,onBack,canExport,registerFlush}:{ids:string[],refresh:()=>Promise<void>,onFinish:()=>void,onBack:()=>void,canExport:boolean,registerFlush:(fn:(()=>Promise<void>)|null)=>void}){
 const [index,setIndex]=useState(0),[t,setT]=useState<TicketData|null>(null),[code,setCode]=useState(''),[code2,setCode2]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[skipped,setSkipped]=useState(0),[dirty,setDirty]=useState(false),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;setT(null);setError('');if(index>=ids.length)return;api('/tickets/'+ids[index]).then(x=>{if(active){setT(x);setCode(x.code);setCode2(x.code2);setDirty(false)}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[index,ids,reload]);
 const auto=useAutosave({code,code2},dirty,!!t,async value=>{await api('/tickets/'+t!.id,'PUT',{...value,approved:false,character:t!.character_override||'',answers:t!.answer_overrides||{}});await refresh()},()=>setDirty(false));
 useEffect(()=>{registerFlush(auto.flush);return()=>{registerFlush(null)}},[]);
 const next=async(confirm:boolean)=>{if(!t)return;setBusy(true);setError('');try{await auto.flush();if(confirm){await api('/tickets/'+t.id+'/confirm','POST',{code,code2})}else{setSkipped(n=>n+1)}await refresh();setIndex(i=>i+1);window.scrollTo({top:0,behavior:'instant'})}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 if(index>=ids.length)return <section className="panel review-finished"><Check size={28}/><h2>確認が終わりました</h2>{skipped>0&&<p>あとで確認 {skipped}枚</p>}<button className="primary" disabled={!canExport} onClick={onFinish}>ZIPにまとめる<ChevronRight size={18}/></button><button className="secondary" onClick={onBack}>前に戻る</button></section>;
 return <section className="review-card"><div className="review-position">{index+1} / {ids.length}</div>{error&&<div className="alert" role="alert">{error}</div>}{t?<><a className="review-crop" href={imageUrl(t.image)} target="_blank" rel="noreferrer"><img src={imageUrl(t.crop||t.image)} alt="画像のシリアルコード"/></a><label className="field">シリアルコード①<input className="serial" autoCapitalize="characters" autoCorrect="off" spellCheck={false} disabled={busy} value={code} onChange={e=>{setCode(e.target.value);setDirty(true)}}/></label>{(!code||/[0O1I]/.test(code))&&<p className="muted">{code?'0とO・1とIを券面で確認してください。':t.note}</p>}<details className="review-original"><summary>原画像・コード②</summary><img src={imageUrl(t.image)} alt="原画像"/><label className="field">シリアルコード②<input disabled={busy} value={code2} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e=>{setCode2(e.target.value);setDirty(true)}}/></label></details><SaveStatus save={auto}/><div className="review-actions"><button className="primary" disabled={busy||!code.trim()} onClick={()=>void next(true)}>確認して次へ<ChevronRight size={18}/></button><button className="secondary" disabled={busy} onClick={()=>void next(false)}>あとで確認</button></div></>:error?<button className="secondary" onClick={()=>setReload(v=>v+1)}>再読み込み</button>:<p className="muted">読み込み中…</p>}</section>;
}

type ExportPlan={fingerprint:string,count:number,ticket_count:number,unconfirmed:number,excluded:number,issues:{page:string,message:string}[],entries:{line:number,code:string,label:string,value:string}[]};
function ShortcutExport({ids,onClose,onComplete,onResolve}:{ids:string[],onClose:()=>void,onComplete:()=>Promise<void>,onResolve:(page:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);const [exclude,setExclude]=useState(false),[plan,setPlan]=useState<ExportPlan|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
 useEffect(()=>{dialog.current?.showModal()},[]);
 useEffect(()=>{let active=true;setPlan(null);setError('');api('/shortcuts/preview','POST',{mode:'codes',ids,exclude_unconfirmed:exclude}).then(p=>{if(active)setPlan(p)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[ids,exclude,version]);
 const download=async()=>{setBusy(true);setError('');try{const blob=await exportZip({mode:'codes',ids,exclude_unconfirmed:exclude,fingerprint:plan?.fingerprint});saveDownload(blob,'ouboken-shortcuts.zip');await onComplete()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 return <dialog ref={dialog} className="shortcut-dialog" onCancel={e=>{if(busy)e.preventDefault();else onClose()}} aria-labelledby="shortcut-title"><div className="shortcut-dialog-body"><div className="section-title"><h2 id="shortcut-title">ZIPにまとめる</h2><button className="icon-button" aria-label="閉じる" disabled={busy} onClick={onClose}><X size={20}/></button></div>{error&&<div role="alert" className="alert">{error}<button onClick={()=>setVersion(v=>v+1)}>再確認</button></div>}{plan?<>{plan.issues.length>0&&<div className="export-issues">{plan.issues.map((issue,i)=><button key={i} onClick={()=>onResolve(issue.page)}>{issue.message}<ChevronRight size={18}/></button>)}</div>}{plan.unconfirmed>0&&<label className="check-line"><input type="checkbox" disabled={busy} checked={exclude} onChange={e=>setExclude(e.target.checked)}/>未確認 {plan.unconfirmed}枚を今回は含めない</label>}<div className="export-count"><strong>{plan.ticket_count}枚 / {plan.count}行</strong>{plan.excluded>0&&<span>応募済み・結果不明 {plan.excluded}枚を除外</span>}</div>{plan.count>0&&<details className="export-preview"><summary>出力するコード①・②</summary><ol>{plan.entries.map(e=><li key={e.line}><small>{e.label}</small><p className="serial">{e.value}</p></li>)}</ol></details>}{!plan.count&&!plan.issues.length&&<p className="muted">出力対象の券がありません。</p>}</>:<p className="muted">確認中…</p>}<button className="primary export-download" disabled={busy||!plan?.count||!!plan.issues.length} onClick={()=>void download()}><Download size={18}/>{busy?'出力中…':'ファイルを出力'}</button></div></dialog>;
}

function TicketDetail({id,boot,refresh,run,busy,notify,copy,registerFlush,onBack,onExport,onDelete}:{id:string,boot:Boot,refresh:()=>Promise<void>,run:(fn:()=>Promise<void>)=>Promise<void>,busy:boolean,notify:(s:string)=>void,copy:(s:string)=>Promise<void>,registerFlush:(fn:(()=>Promise<void>)|null)=>void,onBack:()=>void,onExport:()=>void,onDelete:()=>void}){
 const [t,setT]=useState<TicketData|null>(null),[code,setCode]=useState(''),[code2,setCode2]=useState(''),[approved,setApproved]=useState(false),[dirty,setDirty]=useState(false);
 const load=async()=>{const x=await api('/tickets/'+id);setT(x);setCode(x.code);setCode2(x.code2);setApproved(!!x.approved);setDirty(false)};
 useEffect(()=>{void run(load)},[id]);
 const auto=useAutosave({code,code2,approved},dirty,!!t,async value=>{await api('/tickets/'+id,'PUT',{...value,character:t!.character_override||'',answers:t!.answer_overrides||{}});setT(await api('/tickets/'+id));await refresh()},()=>setDirty(false));
 useEffect(()=>{registerFlush(auto.flush);return()=>registerFlush(null)},[]);
 if(!t)return <div className="detail">読み込み中…</div>;
 const locked=['done','unknown'].includes(t.state);
 return <div className="detail"><div className="detail-heading"><strong className="serial">{t.code||'未読取'}</strong><span className={'badge '+t.state}>{states[t.state]}</span></div>
 <label className="field">応募するキャラ<select aria-label="この券のキャラ" disabled={busy} value={t.character} onChange={e=>{const character=e.target.value;void run(async()=>{await auto.flush();await api('/tickets/'+id+'/character','PUT',{character});await load();await refresh();notify('キャラを記録しました')})}}><option value="" disabled>未記録</option>{boot.schema.characters.map(c=><option key={c}>{c}</option>)}</select></label>
 <label className="field status-control">ステータス<select aria-label="ステータス" disabled={busy} value={t.state} onChange={e=>{const state=e.target.value;void run(async()=>{await auto.flush();await api('/tickets/'+id+'/status','POST',{state});await load();await refresh();notify('ステータスを変更しました')})}}>{Object.entries(states).map(([state,label])=><option key={state} value={state} disabled={state==='ready'&&!t.approved||['prepared','done','unknown'].includes(state)&&!t.payload&&state!==t.state}>{label}</option>)}</select></label>
 {locked&&<p className="muted">コードを直す場合は「確認済み」に戻してください。</p>}
 <section className="panel serial-fields">{([['シリアルコード①',code,setCode],['シリアルコード②',code2,setCode2]] as const).map(([label,value,setValue])=><div className="serial-field" key={label}><label className="field">{label}<input className="serial" disabled={busy||locked} value={value} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e=>{setValue(e.target.value);setApproved(false);setDirty(true)}}/></label><button className="secondary" disabled={!value||dirty} aria-label={label+'をコピー'} onClick={()=>void copy(value)}><Copy size={17}/></button></div>)}<label className="check-line"><input type="checkbox" disabled={busy||locked} checked={approved} onChange={e=>{setApproved(e.target.checked);setDirty(true)}}/>画像とコードを照合済み</label><SaveStatus save={auto}/></section>
 <details className="detail-code"><summary>応募券の写真</summary><div className="photo-review"><a href={imageUrl(t.image)} target="_blank" rel="noreferrer"><img src={imageUrl(t.image)} alt={t.filename+' 原画像'}/><span>原画像を拡大 <ArrowUpRight size={14}/></span></a><img src={imageUrl(t.crop)} alt="コードの切り抜き"/></div></details>
 <div className="detail-save"><button className="secondary" disabled={busy} onClick={onBack}>一覧に戻る</button>{!locked&&<button className="primary" disabled={busy} onClick={onExport}>この券を出力</button>}</div>
 <a className="external-link" href={boot.schema.url} target="_blank" rel="noreferrer">応募ページを開く<ArrowUpRight size={16}/></a>
 <button className="detail-delete" disabled={busy} onClick={onDelete}><Trash2 size={18}/>この応募券を削除</button>
 <details className="history"><summary>操作履歴（{t.history?.length||0}件）</summary>{t.history?.map((h,i)=><div className="history-entry" key={i}><time>{h.created} UTC</time>{h.note}{h.snapshot&&<details><summary>この時点のコード・キャラ</summary><div className="history-snapshot"><p>コード①: {h.snapshot.code}<br/>コード②: {h.snapshot.code2}<br/>キャラ: {h.snapshot.character||'未記録'}</p></div></details>}</div>)}</details></div>;
}


startPwa();
createRoot(document.getElementById('root')!).render(<App/>);
