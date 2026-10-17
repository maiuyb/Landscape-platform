const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../风景调色协作平台/frontend/editor-workspace.js'),F=require('../风景调色协作平台/frontend/editor-frames.js');
const file=(name,size=100,type='image/png')=>({name,size,type,lastModified:1});
test('small collection rejects unsupported, duplicate, excessive files and total size without changing entries',()=>{
 const entries=[{file:file('one')}];assert.equal(W.admission(entries,file('two')),null);assert.match(W.admission(entries,file('one')),/已在工作区/);
 assert.match(W.admission(entries,file('bad',1,'text/plain')),/仅支持/);assert.match(W.admission(entries,file('large',W.limits.fileBytes+1)),/20MB/);
 assert.match(W.admission(Array.from({length:6},(_,i)=>({file:file(String(i))})),file('extra')),/6 张/);
 assert.match(W.admission(Array.from({length:5},(_,i)=>({file:file(String(i),W.limits.fileBytes)})),file('extra')),/100MB/);assert.equal(entries.length,1);
});
test('container dimensions prevent huge compressed PNG/JPEG/WebP photos before source decoding',async()=>{
 const png=Buffer.alloc(24);png.writeUInt32BE(0x89504e47,0);png.writeUInt32BE(9000,16);png.writeUInt32BE(6000,20);
 const read=(buffer,type)=>W.dimensions({type,slice:()=>new Blob([buffer])});
 const size=await read(png,'image/png');assert.deepEqual(size,{width:9000,height:6000});assert.throws(()=>W.validateDimensions(size),/4000 万/);
 const jpeg=Buffer.from([255,216,255,192,0,11,8,2,88,3,32,3,1,17,0]);assert.deepEqual(await read(jpeg,'image/jpeg'),{width:800,height:600});
 const webp=Buffer.alloc(30);webp.write('RIFF',0);webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUIntLE(799,24,3);webp.writeUIntLE(599,27,3);assert.deepEqual(await read(webp,'image/webp'),{width:800,height:600});
 assert.equal(await read(Buffer.from('broken'),'image/jpeg'),null);W.validateDimensions({width:800,height:600});assert.throws(()=>W.validateDimensions({width:0,height:1}));
});
test('frame layout expands around the picture proportionally and keeps styles/limits deterministic',()=>{
 assert.deepEqual(F.layout(1000,600,{style:'paper',margin:10}),{style:'paper',mat:60,edge:30,inset:90,width:1180,height:780});
 const a=F.layout(1000,600,{style:'oak',margin:10}),b=F.layout(600,1000,{style:'charcoal',margin:10});assert.equal(a.width,b.height);assert.equal(a.height,b.width);assert.equal(a.edge,30);assert.equal(F.layout(1000,600,{width:7}).edge,42);
 assert.equal(F.layout(100,80,{style:'invalid',margin:999}).mat,13);assert.equal(F.layout(100,80,{style:'paper',margin:-1}).mat,0);
});
