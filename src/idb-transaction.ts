export const storageWaitMs=15000;
export const storageWaitError=()=>Error('端末の保存領域から応答がありません。保存状態を確認してもう一度操作してください。続く場合はツールを開き直してください。');
// Never report success before commit, or replay an uncertain write automatically.
export function watchTransaction<T>(tx:IDBTransaction,readResult:()=>T,resolve:(value:T)=>void,reject:(error:unknown)=>void,onStall:()=>void,abortError:()=>unknown){
 let active=true;
 const finish=(action:()=>void)=>{if(!active)return;active=false;clearTimeout(timer);action()};
 let timer:ReturnType<typeof setTimeout>;
 const touch=()=>{if(!active)return;clearTimeout(timer);timer=setTimeout(()=>finish(()=>{try{tx.abort()}catch{/* Commit may already have happened. */}onStall();reject(storageWaitError())}),storageWaitMs)};touch();
 tx.oncomplete=()=>finish(()=>{try{resolve(readResult())}catch(error){reject(error)}});
 tx.onabort=()=>finish(()=>reject(abortError()));
 tx.onerror=()=>{}; // Abort is the terminal error event; domain errors retain their message.
 return {active:()=>active,touch};
}
