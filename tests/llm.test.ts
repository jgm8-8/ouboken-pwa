import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../llm-worker/worker';
import {configureLlm,llmConfig,validateEndpoint,generate} from '../src/llm';
const env={OPENAI_API_KEY:'server-test-key',APP_TOKEN:'test-access-code-at-least-24-characters',ALLOWED_ORIGIN:'https://jgm8-8.github.io',LLM_LIMITER:{limit:async()=>({success:true})}};
const body={notes:{c_q29:'会場の展示が良かった'},count:1,max_length:250};
const request=(data:unknown=body,token=env.APP_TOKEN,origin=env.ALLOWED_ORIGIN)=>new Request('https://example.workers.dev/generate',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});
const success=(variants:unknown)=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({variants})}]}]});
test('許可されない接続元・利用コード・入力・上限でOpenAIへの通信を行わない',async()=>{
 let calls=0;const handler=createHandler(async()=>{calls++;return success([{c_q29:'候補'}])});
 assert.equal((await handler(request(body,'wrong'),env)).status,401);assert.equal((await handler(request(body,env.APP_TOKEN,'https://other.test'),env)).status,403);
 for(const invalid of [null,{...body,profile:{name:'送信不可'}},{...body,notes:{c_q21:'好きな作品を捏造'}},{...body,max_length:999999}])assert.equal((await handler(request(invalid),env)).status,400);
 assert.equal((await handler(request(),{...env,LLM_LIMITER:{limit:async()=>({success:false})}})).status,429);assert.equal(calls,0);
});
test('整形は文章だけを送信し、JSON形式と保存無効を指定して候補を返す',async()=>{
 const handler=createHandler(async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');const sent=JSON.parse(String(options!.body));assert.equal(sent.store,false);assert.equal(sent.text.format.type,'json_schema');assert.deepEqual(JSON.parse(sent.input),{notes:body.notes,max_length:250});assert(!sent.input.includes('server-test-key'));return success([{c_q29:' 展示が良かったです。 '}])});
 const result=await handler(request(),env);assert.equal(result.status,200);assert.deepEqual(await result.json(),{variants:[{c_q29:'展示が良かったです。'}]});assert.equal(result.headers.get('Cache-Control'),'no-store');
});
test('拒否・未完了・不正な候補・上流エラーは元の文章を置き換える候補を返さない',async()=>{
 for(const response of [Response.json({status:'incomplete'}),Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]}),success([{c_q29:'a'.repeat(251)}]),success([{c_q29:'',c_q30:'捏造'}]),new Response('秘密のエラー',{status:401})]){const result=await createHandler(async()=>response)(request(),env);assert(result.status>=400);const content=await result.text();assert(!content.includes('variants'));assert(!content.includes('秘密'));assert(!content.includes(env.OPENAI_API_KEY))}
});
test('ブラウザはAPIキーを受け付けず、利用コードをセッションだけに置く',async()=>{
 const persistent=new Map<string,string>(),session=new Map<string,string>();const adapter=(map:Map<string,string>)=>({getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)});
 Object.assign(globalThis,{localStorage:adapter(persistent),sessionStorage:adapter(session)});
 for(const endpoint of ['http://x.y.workers.dev','https://evil.test','https://x.y.workers.dev/?key=secret','https://x.y.workers.dev:444'])assert.throws(()=>validateEndpoint(endpoint));
 assert.throws(()=>configureLlm('https://x.y.workers.dev',' sk-secret '),/APIキー/);configureLlm('https://x.y.workers.dev',env.APP_TOKEN);assert.equal(llmConfig().has_key,true);assert(!JSON.stringify([...persistent.values()]).includes(env.APP_TOKEN));
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://x.y.workers.dev/generate');assert.deepEqual(JSON.parse(String(options!.body)),body);return Response.json({variants:[{c_q29:'候補'}]})};try{await generate({...body,profile:{name:'秘密'},code:'秘密',image:'秘密'})}finally{globalThis.fetch=original}
 session.clear();assert.equal(llmConfig().has_key,false);
});
