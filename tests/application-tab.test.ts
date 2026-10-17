import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveApplicationTab,showApplication,closeApplicationTab} from '../src/application-tab';
import type {ApplicationTab} from '../src/application-tab';
function fake(){const urls:string[]=[],tab:ApplicationTab={closed:false,opener:{private:'original window'},location:{replace:url=>{urls.push(url)}},close:()=>{tab.closed=true}};return {tab,urls}}
test('タブを先に確保して元画面への参照を外し、出力成功後だけ応募先へ移動する',()=>{
 const {tab,urls}=fake();let opened=0;const reserved=reserveApplicationTab(()=>{opened++;return tab});assert.equal(opened,1);assert.equal(reserved,tab);assert.equal(tab.opener,null);assert.deepEqual(urls,[]);assert.equal(showApplication(reserved,'https://example.test/application'),true);assert.deepEqual(urls,['https://example.test/application']);assert.equal(tab.closed,false);
});
test('ポップアップが拒否・例外・既に閉じている場合は通常リンクへ切り替えられる',()=>{
 assert.equal(reserveApplicationTab(()=>null),null);assert.equal(reserveApplicationTab(()=>{throw Error('blocked')}),null);assert.equal(showApplication(null,'https://example.test/application'),false);const {tab,urls}=fake();tab.closed=true;assert.equal(showApplication(tab,'https://example.test/application'),false);assert.deepEqual(urls,[]);
});
test('出力失敗や移動拒否で空のタブを残さず、元画面は閉じない',()=>{
 const {tab,urls}=fake();closeApplicationTab(reserveApplicationTab(()=>tab));assert.equal(tab.closed,true);assert.deepEqual(urls,[]);closeApplicationTab(tab);closeApplicationTab(null);const other=fake();other.tab.location.replace=()=>{throw Error('navigation denied')};assert.equal(showApplication(other.tab,'https://example.test/application'),false);assert.equal(other.tab.closed,true);
});
