import {useState} from 'react';
import {configureLlm,llmConfig} from './llm';
export function LlmPanel({onChange}:{onChange:()=>void}){
 const [key,setKey]=useState(''),[error,setError]=useState(''),[configured,setConfigured]=useState(llmConfig().has_key);
 const save=()=>{if(!key.trim())return;try{configureLlm(key);setKey('');setError('');setConfigured(true);onChange()}catch(e){setError((e as Error).message)}};
 const forget=()=>{try{configureLlm('');setKey('');setConfigured(false);setError('');onChange()}catch(e){setError((e as Error).message)}};
 return <section className="panel"><h2>文章整形</h2><p className="muted">選んだ項目の文章をOpenAIへ直接送信し、候補を確認してから採用できます。</p><label className="field">OpenAI APIキー<input type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={configured?'設定済み（差し替える場合だけ入力）':'sk-…'} value={key} onChange={e=>setKey(e.target.value)} onBlur={save}/></label><p className="muted">GPT5-nano を使用。キーはこの端末に保存され、再起動後も使えます。バックアップには含まれません。</p>{configured&&<><p role="status" className="muted">APIキー設定済み</p><button className="secondary" onClick={forget}>保存したキーを削除</button></>}{error&&<p role="alert" className="save-error">{error}</p>}</section>;
}
