import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {readBackup,mutate,clearImageUrls} from './store';
import {schema,validateAnswers} from './domain';
import type {State,RawTicket} from './store';
const MAGIC=strToU8('OUBOKEN-PWA-BACKUP-1\n');
const LIMIT=250_000_000;
function passwordCheck(password:string){if(password.length<8)throw Error('バックアップ用パスワードを8文字以上で入力してください')}
async function keyFor(password:string,salt:Uint8Array<ArrayBuffer>){passwordCheck(password);const material=await crypto.subtle.importKey('raw',strToU8(password)as Uint8Array<ArrayBuffer>,'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
export async function encodeBackup(state:State,images:Map<string,Blob>,password:string){
 passwordCheck(password);const files:Record<string,any>={'state.json':strToU8(JSON.stringify(state))};let size=files['state.json'].byteLength;
 for(const [name,blob]of images){size+=blob.size;if(size>LIMIT)throw Error('バックアップが大きすぎます');files['images/'+name]=[new Uint8Array(await blob.arrayBuffer()),{level:0}]}
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await keyFor(password,salt);
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:MAGIC as Uint8Array<ArrayBuffer>},key,zipSync(files,{level:6})as Uint8Array<ArrayBuffer>);
 return new Blob([MAGIC as Uint8Array<ArrayBuffer>,salt,iv,encrypted],{type:'application/octet-stream'});
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
export async function decodeBackup(file:Blob,password:string){
 passwordCheck(password);if(file.size>LIMIT+10_000_000)throw Error('バックアップが大きすぎます');
 const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length<MAGIC.length+44||!MAGIC.every((x,i)=>bytes[i]===x))throw Error('このPWAのバックアップを選択してください');
 const salt=bytes.slice(MAGIC.length,MAGIC.length+16),iv=bytes.slice(MAGIC.length+16,MAGIC.length+28),key=await keyFor(password,salt);let plain:ArrayBuffer;
 try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:MAGIC as Uint8Array<ArrayBuffer>},key,bytes.slice(MAGIC.length+28))}catch{throw Error('パスワードが違うか、バックアップが破損しています')}
 let total=0;const files=unzipSync(new Uint8Array(plain),{filter:file=>{total+=file.originalSize;if(total>LIMIT||file.originalSize>25_000_000)throw Error('バックアップが大きすぎます');return file.name==='state.json'||/^images\/[A-Za-z0-9-]{1,80}\.jpg$/.test(file.name)}});
 if(!files['state.json'])throw Error('台帳が見つかりません');const state=JSON.parse(strFromU8(files['state.json']));const images=new Map<string,Blob>();
 for(const [name,bytes]of Object.entries(files))if(name.startsWith('images/'))images.set(name.slice(7),new Blob([bytes as Uint8Array<ArrayBuffer>],{type:'image/jpeg'}));
 validateBackup(state,images);return {state,images};
}
export async function createBackup(password:string){const {state,images}=await readBackup();return encodeBackup(state,images,password)}
export async function restoreBackup(backup:{state:State,images:Map<string,Blob>}){
 validateBackup(backup.state,backup.images);await mutate((state,images)=>{images.clear();for(const [name,blob]of backup.images)images.put(blob,name);Object.assign(state,structuredClone(backup.state))});clearImageUrls();
}
