import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../llm-worker/worker';
import {configureLlm,llmConfig,generate} from '../src/llm';
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
test('本人のAPIキーはメモリだけに保持し、文章以外を送信しない',async()=>{
 const persistent=new Map<string,string>(),session=new Map<string,string>();const adapter=(map:Map<string,string>)=>({getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)});Object.assign(globalThis,{localStorage:adapter(persistent),sessionStorage:adapter(session)});
 assert.throws(()=>configureLlm('invalid'),/APIキー/);const key='sk-test-only-not-a-real-key-1234567890';configureLlm(key);assert.deepEqual(llmConfig(),{model:'gpt-5-nano',has_key:true});assert.equal(persistent.size,0);assert.equal(session.size,0);assert(!JSON.stringify(llmConfig()).includes(key));
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal((options!.headers as Record<string,string>).Authorization,'Bearer '+key);const sent=JSON.parse(String(options!.body));assert.deepEqual(JSON.parse(sent.input),{notes:body.notes,max_length:250});assert.equal(sent.model,'gpt-5-nano');assert.equal(sent.store,false);assert.equal(sent.text.format.type,'json_schema');assert.equal(sent.text.verbosity,'low');assert.deepEqual(sent.reasoning,{effort:'minimal'});return success([{c_q29:'候補'}])};try{assert.deepEqual(await generate({...body,profile:{name:'秘密'},code:'秘密',image:'秘密'}),{variants:[{c_q29:'候補'}]})}finally{globalThis.fetch=original;configureLlm('')};assert.equal(llmConfig().has_key,false);await assert.rejects(generate(body),/OpenAI APIキー/);
});
test('直接接続の失敗・拒否・不正な候補は回答を置き換える結果を返さない',async()=>{
 configureLlm('sk-test-only-not-a-real-key-1234567890');const original=globalThis.fetch;try{for(const response of [new Response('鍵を含む秘密のエラー',{status:401}),new Response('billing',{status:429}),Response.json({status:'incomplete'}),Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]}),success([{c_q29:'a'.repeat(251)}])]){globalThis.fetch=async()=>response;await assert.rejects(generate(body),error=>!String(error).includes('秘密'))}}finally{globalThis.fetch=original;configureLlm('')}
});
