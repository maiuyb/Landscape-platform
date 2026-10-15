const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const folder=path.resolve(__dirname,'../test-results/presets/photos');
const url=process.env.HMI_TEST_URL||'http://127.0.0.1:5050';
(async()=>{
  await fs.mkdir(folder,{recursive:true});const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1100}}),report=[];
  try{
    await page.goto(url);
    for(const name of ['alpine','sunset','night','snow']){
      const original=(await fs.readFile(path.resolve(__dirname,'../test-results/e1/photos/'+name+'.jpg'))).toString('base64');
      const items=await page.evaluate(async original=>{
        const image=new Image();image.src='data:image/jpeg;base64,'+original;await image.decode();
        const items=[{id:'original',label:'原图',state:EditorCore.createState()},...EditorPresets.catalog.map(p=>({id:p.id,label:p.label,category:p.category,description:p.description,state:EditorPresets.apply(EditorCore.createState(),p.id)}))];
        return items.map(item=>{
          const canvas=EditorCore.render(image,item.state,{maxSide:640}),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          let sum=0,black=0,white=0;for(let i=0;i<data.length;i+=4){const l=.299*data[i]+.587*data[i+1]+.114*data[i+2];sum+=l;if(l<3)black++;if(l>252)white++;}
          return{id:item.id,label:item.label,category:item.category,description:item.description,width:canvas.width,height:canvas.height,meanLuma:sum/(data.length/4),nearBlack:black/(data.length/4),nearWhite:white/(data.length/4),jpeg:canvas.toDataURL('image/jpeg',.91).split(',')[1],recipe:EditorCore.toRecipe(item.state)};
        });
      },original);
      for(const item of items){await fs.writeFile(path.join(folder,name+'-'+item.id+'.jpg'),Buffer.from(item.jpeg,'base64'));delete item.jpeg;assert.ok(item.meanLuma>5&&item.meanLuma<250);}
      report.push({photo:name,items});
      const card=item=>`<figure><img src="${name}-${item.id}.jpg"><figcaption><b>${item.label}</b><span>${item.description||'本次使用的原始工程照片'}</span></figcaption></figure>`;
      const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${name} · 预设检查</title><style>body{margin:24px;background:#f3efe5;color:#354535;font:14px "Segoe UI","Microsoft YaHei",sans-serif}h1{font-size:24px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}figure{margin:0;background:#fffcf6;border-radius:10px;overflow:hidden;border:1px solid #d5d9c8}img{display:block;width:100%;height:168px;object-fit:contain;background:#e5e5e0}figcaption{padding:10px;min-height:44px}b,span{display:block}span{font-size:11px;line-height:1.6;color:#6c6d60;margin-top:4px}a{color:#496a54}</style><h1>${name} · 18 款预设</h1><p>自有引擎重新调校。原图与所有变体均为工程检查，照片来源与许可见项目 tests/photo-fixtures.json。</p><div class="grid">${items.map(card).join('')}</div></html>`;
      await fs.writeFile(path.join(folder,name+'.html'),html);
    }
    await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));
    await fs.writeFile(path.join(folder,'index.html'),'<meta charset="utf-8"><h1>预设真实照片检查</h1>'+report.map(r=>`<p><a href="${r.photo}.html">${r.photo} · 原图与18款预设</a></p>`).join(''));
    for(const name of ['alpine','sunset','night','snow']){await page.goto('file:///'+path.join(folder,name+'.html').replaceAll('\\','/'));await page.screenshot({path:path.join(folder,name+'-contact.png'),fullPage:true});}
    console.log('Rendered 18 presets on four photographs; photo galleries, parameters and tonal metrics saved in '+folder);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
