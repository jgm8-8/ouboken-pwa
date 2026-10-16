import {useEffect,useRef,useState} from 'react';
import {Copy,Sparkles,X} from 'lucide-react';
import {api} from './api';
import {useAutosave,SaveStatus} from './autosave';
import {LlmPanel} from './LlmPanel';
import {llmConfig} from './llm';
import {writingFields} from './writing';
import type {WritingNotes} from './writing';
import schema from './schema.json';
type Draft={id:(typeof writingFields)[number],before:string,after:string};
const tabs={c_q29:'感想・要望',c_q30:'イベント',c_q31:'新商品'};
export function WritingHelper({id,busy,copy,registerFlush}:{id:string,busy:boolean,copy:(text:string)=>Promise<void>,registerFlush:(fn:(()=>Promise<void>)|null)=>void}){
 const [notes,setNotes]=useState<WritingNotes>({}),[ready,setReady]=useState(false),[dirty,setDirty]=useState(false),[field,setField]=useState<(typeof writingFields)[number]>('c_q29');
 const [error,setError]=useState(''),[generating,setGenerating]=useState(false),[draft,setDraft]=useState<Draft|null>(null),[reload,setReload]=useState(0),[keyOpen,setKeyOpen]=useState(false),[configured,setConfigured]=useState(llmConfig().has_key);
 const alive=useRef(true),generation=useRef(0),keys=useRef<HTMLDetailsElement>(null),helper=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{alive.current=true;let active=true;setReady(false);setError('');api('/tickets/'+id+'/writing').then(result=>{if(active){setNotes(result.notes);setDirty(false);setReady(true)}}).catch(e=>{if(active)setError((e as Error).message)});return()=>{active=false;alive.current=false;generation.current++}},[id,reload]);
 const auto=useAutosave(notes,dirty,ready,async notes=>{await api('/tickets/'+id+'/writing','PUT',{notes})},()=>setDirty(false));
 useEffect(()=>{registerFlush(auto.flush);return()=>registerFlush(null)},[]);
 useEffect(()=>{if(keyOpen&&!configured)keys.current?.querySelector<HTMLInputElement>('input')?.focus()},[keyOpen]);
 const question=schema.questions.find(q=>q.id===field)!;
 const polish=async()=>{
  setError('');if(!llmConfig().has_key){setKeyOpen(true);setError('OpenAI APIキーを入力してください');return}
  const before=notes[field]||'';if(!before.trim())return;const request=++generation.current;setGenerating(true);
  try{await auto.flush();const result=await api('/generate','POST',{notes:{[field]:before},count:1,max_length:250});if(alive.current&&generation.current===request&&helper.current?.open)setDraft({id:field,before,after:result.variants[0][field]})}
  catch(e){if(alive.current&&generation.current===request)setError((e as Error).message)}finally{if(alive.current&&generation.current===request)setGenerating(false)}
 };
 const accept=()=>{if(!draft)return;if(notes[draft.id]!==draft.before){setError('元の文章が変わりました。もう一度整形してください');setDraft(null);return}setNotes({...notes,[draft.id]:draft.after});setDirty(true);setDraft(null)};
 return <><details ref={helper} className="writing-helper"><summary>自由記述・AI整形（任意）</summary><div className="writing-helper-body"><p className="muted">入力・整形した文章はZIPに含まれません。</p>
 {error&&<p className="alert" role="alert">{error}</p>}{!ready&&<button className="secondary" disabled={busy} onClick={()=>setReload(n=>n+1)}>入力欄を再読み込み</button>}
 <div className="writing-tabs" role="tablist" aria-label="文章の項目">{writingFields.map(id=><button key={id} role="tab" id={'writing-tab-'+id} aria-selected={field===id} aria-controls={'writing-panel-'+id} disabled={busy||generating||!ready} onClick={()=>setField(id)}>{tabs[id]}</button>)}</div>
 <div className="writing-field" role="tabpanel" id={'writing-panel-'+field} aria-labelledby={'writing-tab-'+field}><label className="field" htmlFor={'writing-text-'+field}>{question.label}<textarea id={'writing-text-'+field} rows={5} maxLength={4000} value={notes[field]||''} disabled={busy||generating||!ready} onChange={e=>{setNotes({...notes,[field]:e.target.value});setDirty(true)}}/></label>
 <div className="writing-helper-actions"><button className="secondary" aria-label={question.label+'をコピー'} disabled={!ready||!notes[field]?.trim()} onClick={()=>void copy(notes[field]||'')}><Copy size={16}/>コピー</button><button className="primary" disabled={busy||generating||!ready||!notes[field]?.trim()} onClick={()=>void polish()}><Sparkles size={16}/>{generating?'整形中…':'文章を整える'}</button></div><SaveStatus save={auto}/></div>
 <details ref={keys} className="writing-key-settings" open={keyOpen} onToggle={e=>setKeyOpen(e.currentTarget.open)}><summary>APIキー設定{configured?'（設定済み）':''}</summary><LlmPanel compact onChange={()=>{setConfigured(llmConfig().has_key);setError('')}}/></details>
 </div></details>{draft&&<WritingDraft draft={draft} label={schema.questions.find(q=>q.id===draft.id)!.label} onClose={()=>setDraft(null)} onAccept={accept}/>}</>;
}
function WritingDraft({draft,label,onClose,onAccept}:{draft:Draft,label:string,onClose:()=>void,onAccept:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal()},[]);
 return <dialog ref={ref} className="shortcut-dialog" aria-label="文章の確認" onCancel={onClose}><div className="shortcut-dialog-body"><div className="section-title"><h2>{label}</h2><button className="icon-button" aria-label="閉じる" onClick={onClose}><X size={20}/></button></div><label className="field">元の文章<textarea rows={4} readOnly value={draft.before}/></label><label className="field">整えた文章<textarea rows={4} readOnly value={draft.after}/></label><div className="delete-actions"><button className="secondary" onClick={onClose}>元のまま</button><button className="primary" onClick={onAccept}>この文章を使う</button></div></div></dialog>;
}
