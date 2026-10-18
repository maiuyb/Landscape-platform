const Core=require('../风景调色协作平台/frontend/editor-core.js');
function fixtures(){
  const s=Core.createState();
  Object.assign(s.adjustments,{exposure:.8,highlights:-20,shadows:16,whites:9,blacks:-7,vibrance:18});
  Core.setWhiteBalance(s,[1.12,1,.91],'sample');
  Object.assign(s.detail,{sharpen:25,radius:1.4,protection:35,luminance:12,color:14});
  Object.assign(s.effects,{clarity:11,dehaze:8});s.effects.vignette.amount=-25;s.effects.calibration.red.hue=12;s.effects.calibration.blue.saturation=-8;
  for(const [i,b] of Core.tools.bands.entries())s.hsl[b.key]={hue:i-3,saturation:i+7,luminance:-i};
  for(const [i,ch] of Core.tools.channels.entries())s.curves[ch]=[[0,0],[.4,.43+i*.02],[1,1]];
  s.geometry=[{type:'rotate',params:{angle:90}},{type:'flip',params:{direction:'h'}},{type:'crop',params:{unit:'normalized',x:.1,y:.1,width:.8,height:.7}},{type:'straighten',params:{angle:3.5,autoCrop:true}},{type:'perspective',params:{vertical:12,horizontal:-8,autoCrop:true}}];
  s.masks=['brush','linear','radial'].map((type,i)=>{const m=Core.masks.create(type,'fixture-'+i);m.adjustments.exposure=.25+i*.1;m.adjustments.saturation=8;m.opacity=75;return m;});
  s.masks[0].strokes=[{erase:false,radius:.08,feather:.6,points:[[.2,.3],[.4,.6]]}];
  s.filter='film';s.filterStrength=65;
  const modern={...Core.toRecipe(s),name:'完整往返'};
  const legacy={name:'旧版含义',steps:[{type:'exposure',params:{value:40}},{type:'highlights',params:{value:20}},{type:'shadows',params:{value:15}}]};
  const migrated={...Core.toRecipe(Core.recipeState(Core.createState(),legacy).state),name:'迁移后完整配方'};
  return Core.clone([modern,legacy,migrated]);
}
module.exports={fixtures};
