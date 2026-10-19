importScripts('editor-masks.js','editor-upright.js');
self.onmessage=({data})=>{try{self.postMessage({result:EditorUpright.automatic(new Uint8ClampedArray(data.pixels),data.width,data.height)});}catch{self.postMessage({error:'无法可靠分析参考线，请使用导引式矫正。'});}};
