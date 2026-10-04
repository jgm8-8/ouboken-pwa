import type {State} from './store';
export const CHECKPOINT='ouboken-pwa-checkpoint';
export function checkpoint(state:State){
 try{localStorage.setItem(CHECKPOINT,JSON.stringify({saved:true,ids:state.tickets.map(t=>t.id)}))}catch{/* Storage may be denied; IndexedDB remains usable. */}
}
