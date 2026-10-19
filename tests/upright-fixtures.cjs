const M=require('../风景调色协作平台/frontend/editor-masks.js');
const projection=[.72,.06,.08,-.04,.68,.12,.12,-.14,1];
const guide=(axis,a,b)=>({axis,a:M.transform(projection,...a),b:M.transform(projection,...b)});
const guides=[guide('vertical',[.15,.1],[.15,.9]),guide('vertical',[.85,.1],[.85,.9]),guide('horizontal',[.1,.15],[.9,.15]),guide('horizontal',[.1,.85],[.9,.85])];
function building(){const width=480,height=360,data=new Uint8ClampedArray(width*height*4);data.fill(255);const line=(a,b)=>{a=M.transform(projection,...a);b=M.transform(projection,...b);const n=Math.ceil(Math.hypot((b[0]-a[0])*width,(b[1]-a[1])*height)*2);for(let i=0;i<=n;i++){const x=Math.round((a[0]+(b[0]-a[0])*i/n)*width),y=Math.round((a[1]+(b[1]-a[1])*i/n)*height);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height){const p=((y+dy)*width+x+dx)*4;data[p]=data[p+1]=data[p+2]=25;}}};for(const x of [.15,.32,.5,.68,.85])line([x,.1],[x,.9]);for(const y of [.15,.32,.5,.68,.85])line([.1,y],[.9,y]);return{width,height,data};}
module.exports={building,guides};
