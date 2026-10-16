import type {RawTicket,State} from './store';
export const writingFields=['c_q29','c_q30','c_q31'] as const;
export type WritingNotes=Partial<Record<(typeof writingFields)[number],string>>;
export function validateWritingNotes(value:unknown):asserts value is WritingNotes{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([key,text])=>!writingFields.includes(key as (typeof writingFields)[number])||typeof text!=='string'||text.length>4000))throw Error('自由記述は各項目4000文字以内で入力してください');
}
export function writingNotes(ticket:RawTicket,state:State):WritingNotes{
 const previous=['done','unknown'].includes(ticket.state)&&ticket.payload&&!ticket.payload.codes_only?ticket.payload.answers:{...state.survey.answers,...ticket.answers};
 return Object.fromEntries(writingFields.map(id=>[id,ticket.writing_notes?.[id]??(typeof previous[id]==='string'?previous[id]:'')]));
}
export function saveWritingNotes(state:State,id:string,value:unknown){
 validateWritingNotes(value);const ticket=state.tickets.find(t=>t.id===id);if(!ticket)throw Error('応募券が見つかりません');ticket.writing_notes=structuredClone(value);
}
