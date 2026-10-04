import test from 'node:test';
import assert from 'node:assert/strict';
import {locateCodeField,quadPoint,rectify,decodeCTC} from '../src/code-image';
import {queueOcrRetry} from '../src/domain';
import {emptyState} from '../src/store';
import type {RawTicket} from '../src/store';

test('左右の囲み枠からコード①だけを選び、単独の明るい領域は選ばない',()=>{
 const w=500,h=300,g=new Uint8Array(w*h).fill(50);
 const field=(left:number)=>{for(let y=120;y<150;y++)for(let x=left;x<left+150;x++)g[y*w+x]=220;for(let x=left+20;x<left+130;x+=12)for(let y=127;y<143;y++)g[y*w+x]=30};
 field(50);assert.equal(locateCodeField(g,w,h),null);field(280);
 assert.equal(locateCodeField(g,w,h)?.x,50);assert.equal(locateCodeField(new Uint8Array(w*h).fill(255),w,h),null);
});
test('傾いた四角形の四隅を保ち、切り出しが画像の範囲内に収まる',()=>{
 const q:[number,number][]=[[10,20],[150,10],[155,50],[15,60]];
 for(const [u,v,index]of [[0,0,0],[1,0,1],[1,1,2],[0,1,3]]){const p=quadPoint(q,u,v);assert(Math.abs(p[0]-q[index][0])<1e-8);assert(Math.abs(p[1]-q[index][1])<1e-8)}
 const gray=new Uint8Array(200*100).fill(175),crop=rectify(gray,200,100,q);assert.equal(crop.length,788*98);assert(crop.every(v=>v>=174&&v<=175));
});
test('CTCは連続出力をまとめるが、空白トークンを挟んだ同じ文字を保持する',()=>{
 const indexes=[1,1,0,1,2,2,0,3],data=new Float32Array(indexes.length*4);indexes.forEach((v,i)=>data[i*4+v]=.95);
 const result=decodeCTC(data,indexes.length,4,['blank','0','A',' ']);assert.equal(result.text,'00A');assert(Math.abs(result.confidence-.95)<1e-6);
});
test('再読取は未確認券だけを対象にし、確認済み・出力済み・応募記録と回答を保つ',()=>{
 const state=emptyState();state.tickets=['review','ready','prepared','done','unknown'].map((status,i)=>({id:String(i),state:status,approved:i===0?0:1,code:'TEST123456',answers:{c_q29:'個別文章'},payload:{code:'記録'},history:[{note:'出力時'}],ocr_pending:false,note:'元の記録'} as unknown as RawTicket));
 const before=JSON.parse(JSON.stringify(state.tickets));assert.equal(queueOcrRetry(state),1);assert.equal(state.tickets[0].ocr_pending,true);
 assert.equal(state.tickets[0].code,before[0].code);assert.deepEqual(state.tickets[0].answers,before[0].answers);assert.deepEqual(state.tickets.slice(1),before.slice(1));
});
