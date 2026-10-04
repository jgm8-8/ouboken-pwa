import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {readBackup,mutate,clearImageUrls} from './store';
import {schema,validateAnswers} from './domain';
import type {State,RawTicket} from './store';
const MAGIC=strToU8('OUBOKEN-PWA-BACKUP-2\n');
const LEGACY_MAGIC=strToU8('OUBOKEN-PWA-BACKUP-1\n');
const LIMIT=250_000_000;
const allowed=(name:string)=>name==='state.json'||/^images\/[A-Za-z0-9-]{1,80}\.jpg$/.test(name);
async function digest(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),x=>x.toString(16).padStart(2,'0')).join('')}
export async function encodeBackup(state:State,images:Map<string,Blob>){
 validateBackup(state,images);
 const files:Record<string,Uint8Array>={'state.json':strToU8(JSON.stringify(state))};let size=files['state.json'].byteLength;
 for(const [name,blob]of images){if(!allowed('images/'+name))throw Error('写真のファイル名が正しくありません');size+=blob.size;if(size>LIMIT||blob.size>25_000_000)throw Error('バックアップが大きすぎます');files['images/'+name]=new Uint8Array(await blob.arrayBuffer())}
 if(size>LIMIT||files['state.json'].byteLength>25_000_000)throw Error('バックアップが大きすぎます');
 const checksums:Record<string,string>={};for(const [name,bytes]of Object.entries(files))checksums[name]=await digest(bytes);
 const archive:Record<string,any>={'manifest.json':strToU8(JSON.stringify({version:2,checksums}))};
 for(const [name,bytes]of Object.entries(files))archive[name]=name.startsWith('images/')?[bytes,{level:0}]:bytes;
 return new Blob([MAGIC as Uint8Array<ArrayBuffer>,zipSync(archive,{level:6}) as Uint8Array<ArrayBuffer>],{type:'application/octet-stream'});
}
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)}
function stringMap(value:unknown){if(!isRecord(value)||Object.values(value).some(v=>typeof v!=='string'||v.length>4000))throw Error('バックアップの形式が正しくありません')}
export function validateBackup(value:unknown,images:Map<string,Blob>):asserts value is State{
 if(!isRecord(value)||value.version!==1||!Array.isArray(value.tickets)||value.tickets.length>3000||!isRecord(value.survey))throw Error('このPWAのバックアップではありません');
 stringMap(value.profile);if(value.survey.character&&!schema.characters.includes(String(value.survey.character)))throw Error('キャラクターの形式が正しくありません');validateAnswers((value.survey.answers??{})as any);
 const ids=new Set<string>(),codes=new Set<string>();
 for(const raw of value.tickets){const t=raw as RawTicket;
  if(!isRecord(t)||typeof t.id!=='string'||ids.has(t.id)||typeof t.hash!=='string'||!/^[a-f0-9]{64}$/.test(t.hash)||typeof t.filename!=='string'||typeof t.note!=='string'||typeof t.created!=='string'||typeof t.qr!=='string'||typeof t.code!=='string'||t.code&&!/^[A-Za-z0-9]{1,64}$/.test(t.code)||t.code2!==schema.code2||![0,1].includes(t.approved)||!['review','ready','prepared','done','unknown'].includes(t.state)||!isRecord(t.ocr)||!Array.isArray(t.ocr.lines)||t.ocr.lines.some(line=>typeof line!=='string')||!Array.isArray(t.ocr.candidates)||!Array.isArray(t.history))throw Error('応募券の形式が正しくありません');
  ids.add(t.id);const pair=t.code+'|'+t.code2;if(t.code&&codes.has(pair))throw Error('バックアップに重複コードがあります');if(t.code)codes.add(pair);
  validateAnswers(t.answers);if(t.character&&!schema.characters.includes(t.character))throw Error('キャラクターの形式が正しくありません');
  for(const name of [t.image,t.crop])if(typeof name!=='string'||! /^[A-Za-z0-9-]{1,80}\.jpg$/.test(name)||!images.has(name))throw Error('バックアップの写真が不足しています');
  for(const payload of [t.payload,...t.history.map(h=>h.snapshot)])if(payload){if(!isRecord(payload)||typeof payload.code!=='string'||typeof payload.code2!=='string'||typeof payload.character!=='string')throw Error('履歴の形式が正しくありません');stringMap(payload.profile);validateAnswers(payload.answers)}
  if(t.history.some(h=>!isRecord(h)||typeof h.state!=='string'||typeof h.note!=='string'||typeof h.created!=='string'))throw Error('履歴の形式が正しくありません');
 }
}
export async function decodeBackup(file:Blob){
 if(file.size>LIMIT+10_000_000)throw Error('バックアップが大きすぎます');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(LEGACY_MAGIC.every((x,i)=>bytes[i]===x))throw Error('旧形式のパスワード付きバックアップです。更新前の版で復元し、新しいバックアップを作成してください');
 if(bytes.length<MAGIC.length+22||!MAGIC.every((x,i)=>bytes[i]===x))throw Error('このPWAのバックアップを選択してください');
 let files:Record<string,Uint8Array>;let total=0;
 try{files=unzipSync(bytes.slice(MAGIC.length),{filter:file=>{total+=file.originalSize;if(total>LIMIT+1_000_000||file.originalSize>25_000_000)throw Error('容量');if(file.name!=='manifest.json'&&!allowed(file.name))throw Error('形式');return true}})}catch{throw Error('バックアップが破損しているか、容量が大きすぎます')}
 try{
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  if(manifest.version!==2||!isRecord(manifest.checksums)||!files['state.json']||Object.keys(files).length!==Object.keys(manifest.checksums).length+1)throw Error('形式');
  for(const [name,checksum]of Object.entries(manifest.checksums))if(!allowed(name)||!files[name]||typeof checksum!=='string'||await digest(files[name])!==checksum)throw Error('照合');
 }catch{throw Error('バックアップが破損しています')}
 let state:unknown;try{state=JSON.parse(strFromU8(files['state.json']))}catch{throw Error('バックアップの台帳が破損しています')}
 const images=new Map<string,Blob>();for(const [name,content]of Object.entries(files))if(name.startsWith('images/'))images.set(name.slice(7),new Blob([content as Uint8Array<ArrayBuffer>],{type:'image/jpeg'}));
 validateBackup(state,images);return {state,images};
}
export async function createBackup(){const {state,images}=await readBackup();return encodeBackup(state,images)}
export async function restoreBackup(backup:{state:State,images:Map<string,Blob>}){
 validateBackup(backup.state,backup.images);await mutate((state,images)=>{images.clear();for(const [name,blob]of backup.images)images.put(blob,name);Object.assign(state,structuredClone(backup.state))});clearImageUrls();
}
