import {useState} from 'react';
import {configureLlm,llmConfig} from './llm';
export function LlmPanel({onChange}:{onChange:()=>void}){
 const config=llmConfig();const [endpoint,setEndpoint]=useState(config.endpoint),[token,setToken]=useState(config.token),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const save=(url:string,access:string)=>{try{configureLlm(url,access);setError('');setSaved(true);onChange()}catch(e){setError((e as Error).message);setSaved(false)}};
 return <section className="panel"><h2>文章整形</h2><p className="muted">選んだ項目の文章をOpenAIへ送信します。候補を確認してから採用できます。</p><label className="field">接続先<input type="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://ouboken-polish.….workers.dev" value={endpoint} onChange={e=>{setEndpoint(e.target.value);setSaved(false)}} onBlur={()=>save(endpoint,token)}/></label><label className="field">利用コード<input type="password" autoComplete="off" value={token} onChange={e=>{setToken(e.target.value);setSaved(false)}} onBlur={()=>save(endpoint,token)}/></label><p className="muted">OpenAIのAPIキーは中継サーバーに設定します。利用コードはタブ内でのみ保持します。</p>{saved&&<p role="status" className="muted">接続設定を保存しました</p>}{error&&<p role="alert" className="save-error">{error}</p>}</section>;
}
