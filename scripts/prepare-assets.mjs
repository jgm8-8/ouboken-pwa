import {mkdir,copyFile,readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve,join} from 'node:path';
const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const destination=join(root,'public/ocr');await mkdir(join(destination,'core'),{recursive:true});await mkdir(join(destination,'lang'),{recursive:true});
const tesseract=dirname(require.resolve('tesseract.js/package.json'));
await copyFile(join(tesseract,'dist/worker.min.js'),join(destination,'worker.min.js'));
const tesseractRequire=createRequire(join(tesseract,'package.json'));
const core=dirname(tesseractRequire.resolve('tesseract.js-core/package.json'));
for(const file of await readdir(core))if(/^tesseract-core.*\.wasm(?:\.js)?$/.test(file))await copyFile(join(core,file),join(destination,'core',file));
const lang=dirname(require.resolve('@tesseract.js-data/eng/package.json'));
await copyFile(join(lang,'4.0.0_best_int/eng.traineddata.gz'),join(destination,'lang/eng.traineddata.gz'));
const packages=['tesseract.js','tesseract.js-core','@tesseract.js-data/eng','fflate','react','react-dom','lucide-react'];let notices='Ouboken PWA third-party notices\n';
async function packageFolder(name){const loader=name==='tesseract.js-core'?tesseractRequire:require;try{return dirname(loader.resolve(name+'/package.json'))}catch{let dir=dirname(loader.resolve(name));while(dir!==dirname(dir)){try{if(JSON.parse(await readFile(join(dir,'package.json'),'utf8')).name===name)return dir}catch{}dir=dirname(dir)}throw Error('Package not found: '+name)}}
for(const name of packages){const dir=await packageFolder(name);const packageJson=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));notices+='\n\n'+name+' '+packageJson.version+' '+packageJson.license+'\n';for(const file of await readdir(dir))if(/^(license|notice|copying)/i.test(file)&&(await stat(join(dir,file))).isFile())notices+=await readFile(join(dir,file),'utf8');}
await writeFile(join(root,'public/THIRD_PARTY_NOTICES.txt'),notices);
console.log('Local OCR assets prepared; no CDN required at runtime');
