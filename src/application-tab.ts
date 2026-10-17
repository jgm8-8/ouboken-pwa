export type ApplicationTab={closed:boolean,opener:unknown,location:{replace:(url:string)=>void},close:()=>void};
export function reserveApplicationTab(open=():ApplicationTab|null=>window.open('about:blank','_blank')){
 let tab:ApplicationTab|null=null;
 try{tab=open();if(tab)tab.opener=null;return tab}catch{closeApplicationTab(tab);return null}
}
export function closeApplicationTab(tab:ApplicationTab|null){try{if(tab&&!tab.closed)tab.close()}catch{/* The user may have already closed the tab. */}}
export function showApplication(tab:ApplicationTab|null,url:string){
 try{if(tab&&!tab.closed){tab.location.replace(url);return true}}catch{/* Offer the ordinary link if navigation is blocked. */}
 closeApplicationTab(tab);return false;
}
