const ENDPOINT='ouboken-llm-endpoint',TOKEN='ouboken-llm-access';
export function validateEndpoint(value:string){
 const url=new URL(value);if(url.protocol!=='https:'||! /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)||url.port||url.username||url.password||url.search||url.hash||!['/','/generate'].includes(url.pathname))throw Error('Cloudflare WorkersのHTTPS URLを入力してください');
 return url.origin+'/generate';
}
export function llmConfig(){let endpoint='',token='';try{endpoint=localStorage.getItem(ENDPOINT)||'';token=sessionStorage.getItem(TOKEN)||''}catch{}return {endpoint,token,model:endpoint?'server':'',has_key:!!endpoint&&!!token}}
export function configureLlm(endpoint:string,token:string){
 const valid=endpoint.trim()?validateEndpoint(endpoint.trim()):'';if(token.trim().startsWith('sk-'))throw Error('OpenAIのAPIキーは入力しないでください。中継サーバーの利用コードを使います。');
 localStorage.setItem(ENDPOINT,valid);if(token.trim())sessionStorage.setItem(TOKEN,token.trim());else sessionStorage.removeItem(TOKEN);return llmConfig();
}
export async function generate(body:any){
 const {endpoint,token,has_key}=llmConfig();if(!has_key)throw Error('設定で文章整形の接続先と利用コードを入力してください');
 const notes=Object.fromEntries(Object.entries(body.notes??{}).filter(([id,value])=>['c_q29','c_q30','c_q31'].includes(id)&&typeof value==='string'));
 if(!Object.keys(notes).length)throw Error('整形する文章を入力してください');
 const response=await fetch(validateEndpoint(endpoint),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({notes,count:1,max_length:250}),redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(75000)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'文章整形に接続できませんでした');
 if(!Array.isArray(result.variants)||result.variants.length!==1||Object.keys(notes).some(k=>typeof result.variants[0]?.[k]!=='string'||!result.variants[0][k].trim()||result.variants[0][k].length>250))throw Error('整形結果を確認できませんでした。元の文章は変更していません');return result;
}
