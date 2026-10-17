/* Session-only small photo collection. Inactive entries hold files and document
   snapshots, never decoded source images, canvases or live preview workers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EditorWorkspace=api;})(globalThis,function(){
  const limits={photos:6,fileBytes:20*1024*1024,totalBytes:100*1024*1024,pixels:40*1000*1000};
  const types=new Set(['image/jpeg','image/png','image/webp']);
  const signature=file=>[file.name,file.size,file.lastModified||0,file.type].join(':');
  function admission(entries,file){
    if(!file||!types.has(file.type))return'仅支持 JPG / PNG / WebP，请重新选择图片。';
    if(file.size>limits.fileBytes)return'图片超过 20MB，请选择更小的文件。';
    if(entries.some(p=>signature(p.file)===signature(file)))return'这张照片已在工作区中。';
    if(entries.length>=limits.photos)return'工作区最多保留 6 张照片，请先关闭一张再添加。';
    if(entries.reduce((n,p)=>n+p.file.size,0)+file.size>limits.totalBytes)return'这组照片总大小超过 100MB，请先关闭一些照片。';
    return null;
  }
  // Inspect container headers before decoding very large compressed images.
  async function dimensions(file){
    const bytes=new Uint8Array(await file.slice(0,1024*1024).arrayBuffer()),v=new DataView(bytes.buffer);
    if(file.type==='image/png'&&bytes.length>=24&&v.getUint32(0)===0x89504e47)return{width:v.getUint32(16),height:v.getUint32(20)};
    if(file.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){
      let p=2;while(p+4<bytes.length){if(bytes[p++]!==255)continue;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd8))continue;
        const size=v.getUint16(p);if(size<2||p+size>bytes.length)break;
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&size>=7)return{width:v.getUint16(p+5),height:v.getUint16(p+3)};p+=size;
      }
    }
    if(file.type==='image/webp'&&bytes.length>=30){
      const text=(a,b)=>String.fromCharCode(...bytes.slice(a,b));
      if(text(0,4)==='RIFF'&&text(8,12)==='WEBP'){
        if(text(12,16)==='VP8X')return{width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};
        if(text(12,16)==='VP8 '&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a)return{width:v.getUint16(26,true)&0x3fff,height:v.getUint16(28,true)&0x3fff};
        if(text(12,16)==='VP8L'&&bytes[20]===0x2f)return{width:1+bytes[21]+((bytes[22]&0x3f)<<8),height:1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&0xf)<<10)};
      }
    }
    return null;
  }
  function validateDimensions(size){if(size&&(!size.width||!size.height||size.width*size.height>limits.pixels))throw Error('照片像素过大，当前支持最多 4000 万像素，请先缩小图片。');}
  return{limits,admission,dimensions,validateDimensions};
});
