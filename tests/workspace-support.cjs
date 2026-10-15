// Functional regressions open the new disclosure ancestors before exercising an existing control.
async function reveal(page,selector){
 const locator=page.locator(selector).first();
 if(await locator.evaluate(e=>!!e.closest('#panel-edit'))){const tab=page.getByRole('tab',{name:'编辑',exact:true});if(await tab.getAttribute('aria-selected')!=='true')await tab.click();}
 await locator.evaluate(e=>{for(let p=e;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
 await locator.scrollIntoViewIfNeeded();
}
module.exports={reveal};
