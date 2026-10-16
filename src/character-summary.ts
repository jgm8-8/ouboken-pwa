export function characterSummary(tickets:{character:string,state:string}[]){
 const groups=new Map<string,{character:string,total:number,done:number}>();
 for(const ticket of tickets){const name=ticket.character||'';let row=groups.get(name);if(!row){row={character:name,total:0,done:0};groups.set(name,row)}row.total++;if(ticket.state==='done')row.done++}
 return [...groups.values()].sort((a,b)=>a.character?b.character?a.character.localeCompare(b.character,'ja'): -1:1);
}
