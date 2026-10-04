export type Point=[number,number];
export type Field={quad:Point[],x:number,y:number,width:number,height:number};
// Find the two enclosed light fields beside the black serial labels. Text is
// made of holes in these components, so it cannot split the field into words.
export function locateCodeField(gray:Uint8Array,width:number,height:number):Field|null{
 for(const threshold of [145,115,175]){
  const visited=new Uint8Array(gray.length),queue=new Int32Array(gray.length),fields:Field[]=[];
  for(let seed=0;seed<gray.length;seed++){
   if(visited[seed]||gray[seed]<=threshold)continue;
   let head=0,tail=1;queue[0]=seed;visited[seed]=1;
   let left=width,right=0,top=height,bottom=0,minSum=Infinity,maxSum=-Infinity,minDiff=Infinity,maxDiff=-Infinity;
   const quad:Point[]=[[0,0],[0,0],[0,0],[0,0]];
   while(head<tail){
    const i=queue[head++],x=i%width,y=Math.floor(i/width),sum=x+y,diff=x-y;
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    if(sum<minSum){minSum=sum;quad[0]=[x,y]}if(diff>maxDiff){maxDiff=diff;quad[1]=[x,y]}
    if(sum>maxSum){maxSum=sum;quad[2]=[x,y]}if(diff<minDiff){minDiff=diff;quad[3]=[x,y]}
    for(const next of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1]){
     if(next>=0&&!visited[next]&&gray[next]>threshold){visited[next]=1;queue[tail++]=next}
    }
   }
   const w=right-left+1,h=bottom-top+1;
   if(left>0&&top>0&&right<width-1&&bottom<height-1&&w>width*.12&&w<width*.55&&h>height*.02&&h<height*.16&&w/h>3&&w/h<14&&tail/(w*h)>.48)fields.push({quad,x:left,y:top,width:w,height:h});
  }
  const pairs=fields.flatMap(a=>fields.filter(b=>b.x>a.x+a.width&&b.width/a.width>.65&&b.width/a.width<1.5&&Math.abs((b.y+b.height/2)-(a.y+a.height/2))<Math.max(a.height,b.height)&&b.x-(a.x+a.width)<a.width*.9&&b.x-(a.x+a.width)>a.width*.12).map(b=>({a,score:Math.min(a.width,b.width)})));
  if(pairs.length)return pairs.sort((a,b)=>b.score-a.score)[0].a;
 }
 return null;
}
// Map an upright rectangle back to the photographed quadrilateral.
export function quadPoint(q:Point[],u:number,v:number):Point{
 const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q;
 const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
 const det=dx1*dy2-dx2*dy1;
 const g=Math.abs(det)<1e-8?0:(dx3*dy2-dx2*dy3)/det,h=Math.abs(det)<1e-8?0:(dx1*dy3-dx3*dy1)/det;
 const d=g*u+h*v+1;
 return [((x1-x0+g*x1)*u+(x3-x0+h*x3)*v+x0)/d,((y1-y0+g*y1)*u+(y3-y0+h*y3)*v+y0)/d];
}
export function rectify(gray:Uint8Array,width:number,height:number,quad:Point[],outWidth=788,outHeight=98){
 const result=new Uint8Array(outWidth*outHeight);
 for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){
  const [px,py]=quadPoint(quad,.0075+.985*x/(outWidth-1),.055+.89*y/(outHeight-1));
  const ix=Math.max(0,Math.min(width-2,Math.floor(px))),iy=Math.max(0,Math.min(height-2,Math.floor(py))),fx=Math.max(0,Math.min(1,px-ix)),fy=Math.max(0,Math.min(1,py-iy));
  result[y*outWidth+x]=(gray[iy*width+ix]*(1-fx)+gray[iy*width+ix+1]*fx)*(1-fy)+(gray[(iy+1)*width+ix]*(1-fx)+gray[(iy+1)*width+ix+1]*fx)*fy;
 }
 return result;
}
// CTC decoding adapted from RapidOCR (Apache-2.0), PaddlePaddle Authors
// Copyright (c) 2020. Browser adaptation: see models/README.md and LICENSE.
export function decodeCTC(data:Float32Array,steps:number,classes:number,characters:string[]){
 let previous=-1,text='',confidence=0,count=0;
 for(let t=0;t<steps;t++){
  let best=0;for(let i=1;i<classes;i++)if(data[t*classes+i]>data[t*classes+best])best=i;
  if(best!==previous&&best!==0){text+=characters[best]??'';confidence+=data[t*classes+best];count++}previous=best;
 }
 return {text:text.replace(/\s/g,''),confidence:count?confidence/count:0};
}
