// Browser adaptation of PP-OCRv4 inference; see models/README.md and LICENSE.
import * as ort from 'onnxruntime-web/wasm';
import {decodeCTC} from './code-image';
let engine:Promise<{session:ort.InferenceSession,characters:string[]}>|undefined;
self.onmessage=async(event:MessageEvent<{root:string,pixels:Float32Array,width:number}>)=>{
 try{
  const {root,pixels,width}=event.data;
  if(!engine){ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=root+'ocr/';
   engine=Promise.all([ort.InferenceSession.create(root+'ocr/ch_PP-OCRv4_rec_infer.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'all'}),fetch(root+'ocr/characters.json').then(async r=>{if(!r.ok)throw Error('文字認識データを取得できません');return r.json()})]).then(([session,characters])=>({session,characters}));
  }
  const {session,characters}=await engine,result=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',pixels,[1,3,48,width])});
  const output=result[session.outputNames[0]];
  self.postMessage({result:decodeCTC(output.data as Float32Array,Number(output.dims[1]),Number(output.dims[2]),characters)});
 }catch(e){engine=undefined;self.postMessage({error:(e as Error).message})}
};
