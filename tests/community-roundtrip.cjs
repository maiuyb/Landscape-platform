const assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const Core=require('../风景调色协作平台/frontend/editor-core.js'),Community=require('../风景调色协作平台/frontend/editor-community.js');
const {fixtures}=require('./community-fixtures.cjs');
function roundtrip(upstream){
 const input=fixtures(),py=path.resolve('.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const r=spawnSync(py,[path.join(__dirname,'community-roundtrip.py'),...(upstream?[upstream]:[])],{input:JSON.stringify(input),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);
 out.records.forEach((rec,i)=>{
  assert.equal(rec.status,201,rec.error);const raw=rec.detail.recipe;
  assert.equal(raw.version,input[i].version??1);assert.deepEqual(raw.rendering??null,input[i].rendering??null);assert.deepEqual(raw.steps,input[i].steps);
  // The returned API record must be accepted by the actual editor adapter too.
  const normalized=Community.normalize(rec.detail);
  assert.deepEqual(Core.recipeState(Core.createState(),normalized).state,Core.recipeState(Core.createState(),input[i]).state);
 });
 assert.deepEqual(out.rejected,Array(17).fill(400));assert.equal(out.unchanged,true);assert.equal(out.me,200);assert.equal(out.migration,true);
 return {input,records:out.records};
}
module.exports={roundtrip};
if(require.main===module){roundtrip(process.argv[2]);console.log('PASS: actual Core v6 / legacy / migrated recipes, full steps, rendering and 17 invalid inputs');}
