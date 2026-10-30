/* Test-only observation/fixtures for isolated editors; never injected into a public site. */
async function observe(page){
 await page.route('**/app.js',async route=>{
  const url=new URL(route.request().url());
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname.endsWith('/community/assets/app.js')||url.pathname.endsWith('/community/app.js'))return route.continue();
  const response=await route.fetch(),body=await response.text(),marker='    return {\n      displayState,';
  const normalized=body.replace(/\r\n/g,'\n');
  if(!normalized.includes(marker))return route.fulfill({response});
  return route.fulfill({response,body:normalized.replace(marker,"    window.__editorTest={recipe:()=>Core.toRecipe(state.value),open:recipe=>openCommunityRecipe(recipe)};\n"+marker)});
 });
}
async function readRecipe(page){return page.evaluate(()=>window.__editorTest.recipe());}
async function previewRecipe(page,recipe){
 await page.evaluate(recipe=>window.__editorTest.open(recipe),recipe);
 const dialog=page.locator('dialog[aria-labelledby="recipe-title"]');await dialog.waitFor();
 for(const name of [/同时复用作者构图/,/同时复用作者局部选区/]){const box=dialog.getByRole('checkbox',{name});if(await box.count())await box.check();}
 await dialog.getByRole('button',{name:'在我的照片上预览',exact:true}).click();
}
module.exports={observe,readRecipe,previewRecipe};
