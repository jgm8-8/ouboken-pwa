import {mkdir,copyFile,readdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve,join} from 'node:path';
const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const destination=resolve(root,'public/ocr');
if(destination!==join(root,'public','ocr'))throw Error('Unexpected generated asset directory');
await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
const runtime=dirname(require.resolve('onnxruntime-web/wasm'));
for(const file of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await copyFile(join(runtime,file),join(destination,file));
for(const file of ['ch_PP-OCRv4_rec_infer.onnx','characters.json'])await copyFile(join(root,'models',file),join(destination,file));
const packages=['onnxruntime-web','onnxruntime-common','fflate','react','react-dom','lucide-react'];let notices='Ouboken PWA third-party notices\n';
async function packageFolder(name){const loader=name==='onnxruntime-common'?createRequire(require.resolve('onnxruntime-web/wasm')):require;try{return dirname(loader.resolve(name+'/package.json'))}catch{let dir=dirname(loader.resolve(name));while(dir!==dirname(dir)){try{if(JSON.parse(await readFile(join(dir,'package.json'),'utf8')).name===name)return dir}catch{}dir=dirname(dir)}throw Error('Package not found: '+name)}}
for(const name of packages){const dir=await packageFolder(name);const packageJson=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));notices+='\n\n'+name+' '+packageJson.version+' '+packageJson.license+'\n';for(const file of await readdir(dir))if(/^(license|notice|copying)/i.test(file)&&(await stat(join(dir,file))).isFile())notices+=await readFile(join(dir,file),'utf8');}
notices+='\n\n'+await readFile(join(root,'models/README.md'),'utf8')+'\n'+await readFile(join(root,'models/LICENSE'),'utf8');
await writeFile(join(root,'public/THIRD_PARTY_NOTICES.txt'),notices);
console.log('Local OCR assets prepared; no CDN required at runtime');
