import {useEffect,useRef,useState} from 'react';
import {ensureThumbnail} from './thumbnails';
import {imageUrl} from './store';
export function TicketThumbnail({id,image,thumbnail}:{id:string,image:string,thumbnail?:string}){
 const ref=useRef<HTMLSpanElement>(null),[src,setSrc]=useState(thumbnail?imageUrl(thumbnail):'');
 useEffect(()=>{let alive=true;const load=()=>{void ensureThumbnail(id).then(url=>{if(alive)setSrc(url)}).catch(()=>{if(alive)setSrc(imageUrl(image))})};const target=ref.current;if(!target)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load()}},{rootMargin:'200px'});observer.observe(target);return()=>{alive=false;observer.disconnect()};
 },[id,image,thumbnail]);
 return <span ref={ref} className="ticket-thumb">{src&&<img src={src} alt="応募券" width={48} height={56} loading="lazy" decoding="async"/>}</span>;
}
