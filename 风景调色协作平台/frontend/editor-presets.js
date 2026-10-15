/* Native recipes adapted for decoded photographs. Attribution: preset-sources.json. */
(function (root, factory) {
  const presets = factory(typeof module === 'object' && module.exports ? require('./editor-core.js') : root.EditorCore);
  if (typeof module === 'object' && module.exports) module.exports = presets;
  else root.EditorPresets = presets;
})(globalThis, function (Core) {
  const categories = [
    { key: 'natural', label: '自然通透', description: '保留风景本来的颜色，让光线更清楚。' },
    { key: 'forest', label: '山林植被', description: '从清新草木到深绿山林，找到喜欢的绿。' },
    { key: 'sunset', label: '日落暖色', description: '留住晚霞、暖光与傍晚的柔和气氛。' },
    { key: 'night', label: '城市夜景', description: '整理灯光与暗部，尝试城市的冷暖色彩。' },
    { key: 'film', label: '胶片柔和', description: '柔和亮部、褪色暗部，给照片一点回忆感。' },
    { key: 'mono', label: '黑白影调', description: '用不同灰阶表现天空、草木和建筑。' }
  ];
  const curve = points => points.map(p => p.map(v => v / 255));
  const catalog = [
    { id:'clear-day', label:'晴空通透', category:'natural', description:'轻收高光，蓝天更清楚，山景更有层次。', tags:'适合晴天 · 山湖', source:'provia',
      adjustments:{contrast:8,highlights:-18,shadows:12,whites:4,blacks:-5,vibrance:9}, hsl:{blue:{saturation:8,luminance:-6}}, effects:{clarity:5,dehaze:5} },
    { id:'soft-backlight', label:'逆光拾光', category:'natural', description:'提起暗处，温和收住亮部，保留自然感。', tags:'适合逆光 · 明暗反差大', source:'provia',
      adjustments:{contrast:3,highlights:-32,shadows:30,whites:-5,blacks:6,vibrance:5}, effects:{clarity:3,dehaze:2} },
    { id:'alpine-air', label:'山间清风', category:'natural', description:'偏清冷的蓝绿，突出远山与岩石的轮廓。', tags:'适合高山 · 雪景', source:'provia',
      adjustments:{contrast:12,highlights:-20,shadows:8,blacks:-8,vibrance:6}, hsl:{blue:{hue:-5,saturation:6,luminance:-5}}, curves:{blue:curve([[0,2],[128,132],[255,255]])}, effects:{clarity:9,dehaze:6} },
    { id:'deep-forest', label:'林间深绿', category:'forest', description:'收起刺眼黄绿，让树木和山谷更沉静。', tags:'适合树林 · 草木偏亮', source:'velvia',
      adjustments:{contrast:9,highlights:-20,shadows:10,blacks:-10,vibrance:3}, hsl:{green:{hue:16,saturation:-18,luminance:-16},yellow:{hue:-12,saturation:-18,luminance:-8},cyan:{saturation:-12}}, effects:{clarity:5,dehaze:4} },
    { id:'misty-woods', label:'薄雾森林', category:'forest', description:'柔化林间反差，留下灰绿与轻盈暗部。', tags:'适合晨雾 · 阴天树林', source:'velvia',
      adjustments:{contrast:-6,highlights:-12,shadows:12,vibrance:-5}, hsl:{green:{hue:12,saturation:-16},yellow:{saturation:-16}}, curves:{master:curve([[0,10],[64,65],[192,190],[255,248]]),blue:curve([[0,3],[100,104],[255,255]])}, effects:{clarity:-10,dehaze:-4} },
    { id:'golden-leaves', label:'草木金秋', category:'forest', description:'让黄绿偏向温暖橄榄色，保留叶片层次。', tags:'适合秋叶 · 暖色草地', source:'velvia',
      adjustments:{contrast:7,highlights:-18,shadows:9,vibrance:8}, hsl:{green:{hue:-48,saturation:-10,luminance:-5},yellow:{hue:-25,saturation:10,luminance:5},orange:{saturation:8}}, curves:{blue:curve([[0,0],[160,153],[255,250]])}, effects:{clarity:3} },
    { id:'golden-sunset', label:'金色晚霞', category:'sunset', description:'柔暖亮部与金橙色，留住傍晚的温度。', tags:'适合日出日落 · 暖光', source:'gold',
      adjustments:{contrast:7,highlights:-22,shadows:14,vibrance:10}, hsl:{orange:{saturation:14,luminance:6},yellow:{hue:-10,saturation:8},green:{saturation:-8}}, curves:{red:curve([[0,0],[128,133],[255,255]]),blue:curve([[0,2],[192,183],[255,250]])}, effects:{clarity:-3} },
    { id:'ember-sky', label:'落日余烬', category:'sunset', description:'更深的橙红与明暗反差，让晚霞更浓郁。', tags:'适合红橙晚霞 · 云层', source:'gold',
      adjustments:{contrast:13,highlights:-25,shadows:7,blacks:-8,vibrance:9}, hsl:{red:{saturation:13},orange:{hue:-5,saturation:17,luminance:-3},yellow:{hue:-16,saturation:5}}, curves:{master:curve([[0,0],[64,59],[192,198],[255,253]]),blue:curve([[0,0],[192,181],[255,249]])}, effects:{dehaze:4} },
    { id:'rose-dusk', label:'粉紫暮光', category:'sunset', description:'淡淡粉紫高光与冷色暗部，气氛更安静。', tags:'适合蓝紫暮色 · 水面', source:'gold',
      adjustments:{contrast:1,highlights:-17,shadows:10,vibrance:5}, hsl:{purple:{saturation:13},magenta:{saturation:10},blue:{hue:8,saturation:4}}, curves:{red:curve([[0,2],[128,132],[255,255]]),green:curve([[0,0],[192,188],[255,252]]),blue:curve([[0,4],[128,131],[255,255]])}, effects:{clarity:-4} },
    { id:'blue-hour', label:'蓝调夜色', category:'night', description:'蓝色暗部搭配暖色灯光，保留城市层次。', tags:'适合城市暮色 · 街灯', source:'neon',
      adjustments:{contrast:9,highlights:-24,shadows:15,blacks:-6,vibrance:5}, hsl:{blue:{hue:-6,saturation:12,luminance:-5},yellow:{saturation:-8},orange:{saturation:6}}, curves:{blue:curve([[0,4],[96,100],[220,218],[255,253]])}, effects:{clarity:4}, detail:{color:16,luminance:8} },
    { id:'neon-city', label:'霓虹漫游', category:'night', description:'青蓝与洋红更鲜明，给灯光一点电影感。', tags:'适合霓虹 · 风格化夜景', source:'neon',
      adjustments:{contrast:14,highlights:-25,shadows:12,blacks:-9,vibrance:6}, hsl:{blue:{hue:-13,saturation:20},cyan:{hue:-8,saturation:15},magenta:{saturation:18},yellow:{saturation:-22}}, curves:{red:curve([[0,0],[64,60],[192,198],[255,255]]),blue:curve([[0,7],[128,134],[255,252]])}, effects:{clarity:7,dehaze:4}, detail:{color:18,luminance:9} },
    { id:'quiet-night', label:'静谧街灯', category:'night', description:'降低杂色与锐利感，让夜色柔和安定。', tags:'适合高感照片 · 柔和灯光', source:'neon',
      adjustments:{contrast:4,highlights:-27,shadows:10,blacks:-3,vibrance:-9,saturation:-4}, hsl:{yellow:{saturation:-16},blue:{saturation:-8}}, effects:{clarity:-3}, detail:{color:25,luminance:20} },
    { id:'soft-fade', label:'柔和褪色', category:'film', description:'轻抬黑位、柔化亮部，像一张旧相片。', tags:'适合旅行 · 温和复古', source:'chrome',
      adjustments:{contrast:-4,highlights:-14,shadows:7,vibrance:-5}, curves:{master:curve([[0,16],[64,65],[192,191],[255,242]]),blue:curve([[0,4],[64,68],[192,188],[255,250]])}, effects:{clarity:-5} },
    { id:'airy-postcard', label:'清新明信片', category:'film', description:'明亮中间调与柔和浅绿，轻盈不浓烈。', tags:'适合海边 · 日间旅行', source:'chrome',
      adjustments:{contrast:-5,highlights:-10,shadows:12,blacks:3,vibrance:-3}, hsl:{green:{hue:9,saturation:-11,luminance:8},blue:{saturation:-8,luminance:7}}, curves:{master:curve([[0,6],[96,103],[192,198],[255,251]])}, effects:{clarity:-5} },
    { id:'muted-memory', label:'青调回忆', category:'film', description:'低饱和、冷色暗部，留下安静的纪实感。', tags:'适合街景 · 阴天旅行', source:'chrome',
      adjustments:{contrast:9,highlights:-18,shadows:2,blacks:-5,vibrance:-14,saturation:-3}, hsl:{blue:{hue:-12,saturation:-13},green:{hue:8,saturation:-14}}, curves:{master:curve([[0,9],[64,58],[192,193],[255,247]]),blue:curve([[0,5],[96,100],[255,250]])}, effects:{clarity:2} },
    { id:'mono-landscape', label:'黑白层次', category:'mono', description:'压暗蓝天、提亮草木，让云与山更分明。', tags:'适合山景 · 云层', source:'acros', monochrome:true,
      adjustments:{contrast:15,highlights:-12,shadows:7,whites:7,blacks:-9}, hsl:{blue:{luminance:-28},cyan:{luminance:-18},green:{luminance:12},yellow:{luminance:15},orange:{luminance:10}}, effects:{clarity:8,dehaze:3} },
    { id:'mono-soft', label:'柔调银灰', category:'mono', description:'温和灰阶与柔软黑位，适合安静的风景。', tags:'适合雾景 · 柔和光线', source:'acros', monochrome:true,
      adjustments:{contrast:-3,highlights:-11,shadows:10}, hsl:{blue:{luminance:-9},orange:{luminance:8}}, curves:{master:curve([[0,12],[64,66],[192,190],[255,245]])}, effects:{clarity:-4} },
    { id:'mono-architecture', label:'建筑炭黑', category:'mono', description:'更硬朗的黑白反差，突出建筑与几何线条。', tags:'适合建筑 · 强光影', source:'acros', monochrome:true,
      adjustments:{contrast:22,highlights:-8,shadows:-3,whites:9,blacks:-15}, hsl:{blue:{luminance:-22},yellow:{luminance:7}}, effects:{clarity:12,dehaze:4,vignette:{amount:-7}} }
  ];
  const byId = new Map(catalog.map(p => [p.id, p]));
  // Exposure, white balance, geometry, vignette shape and local masks are user-owned.
  const paths = [
    ...['contrast','highlights','shadows','whites','blacks','saturation','vibrance'].map(k=>'adjustments.'+k),
    ...Core.tools.bands.flatMap(b=>['hue','saturation','luminance'].map(k=>'hsl.'+b.key+'.'+k)),
    ...Core.tools.channels.map(k=>'curves.'+k),
    ...Core.detail.controls.map(c=>'detail.'+c.key),
    'effects.clarity','effects.dehaze','effects.vignette.amount',
    ...['red','green','blue'].flatMap(k=>['hue','saturation'].map(v=>'effects.calibration.'+k+'.'+v))
  ];
  const get = (s,p) => p.split('.').reduce((v,k)=>v[k],s);
  function put(s,p,value) { const keys=p.split('.'),last=keys.pop();keys.reduce((v,k)=>v[k],s)[last]=Core.clone(value); }
  const snapshot = state => Object.fromEntries(paths.map(p=>[p,Core.clone(get(state,p))]));
  function targetFor(preset) {
    const target=Core.createState();
    function merge(to,from) { for(const [key,value] of Object.entries(from||{})) { if(Array.isArray(value)||typeof value!=='object')to[key]=Core.clone(value);else merge(to[key],value); } }
    for(const group of ['adjustments','hsl','curves','effects','detail'])merge(target[group],preset[group]);
    // HSL evaluates luminance from the original color before desaturating it. Curves follow.
    if(preset.monochrome)for(const band of Core.tools.bands)target.hsl[band.key].saturation=-100;
    return snapshot(target);
  }
  function mixCurve(a,b,t) {
    if(t===0)return Core.clone(a);if(t===1)return Core.clone(b);
    if(JSON.stringify(a)===JSON.stringify(b))return Core.clone(a);
    let xs=[...new Set([...a,...b].map(p=>p[0]))].sort((x,y)=>x-y);
    if(xs.length>10||xs.some((x,i)=>i&&x-xs[i-1]<.001))xs=Array.from({length:10},(_,i)=>i/9);
    const la=Core.tools.curveLUT(a),lb=Core.tools.curveLUT(b);
    return xs.map(x=>[x,(Core.tools.lookup(la,x*255)*(1-t)+Core.tools.lookup(lb,x*255)*t)/255]);
  }
  function materialize(state,session,amount) {
    const next=Core.clone(state),t=Core.clamp(Number.isFinite(amount)?amount:100,0,100)/100;
    for(const p of paths) {
      let value;
      if(p.startsWith('curves.'))value=mixCurve(session.base[p],session.target[p],t);
      else if(t===0)value=session.base[p];
      else if(t===1)value=session.target[p];
      else {const scale=p==='detail.radius'?10:1;value=Math.round((session.base[p]*(1-t)+session.target[p]*t)*scale)/scale;}
      put(next,p,value);
    }
    next.filter=null;next.filterStrength=100;
    next.presetSession={...Core.clone(session),amount:Math.round(t*100),generated:snapshot(next)};
    return next;
  }
  function reconcile(state) {
    const session=state.presetSession;if(!session||!byId.has(session.id))return;
    let manual=!!session.manual;
    for(const p of paths) {
      const current=get(state,p);
      if(JSON.stringify(current)!==JSON.stringify(session.generated[p])) {
        // Pin a manually edited field at both endpoints so strength cannot overwrite it.
        session.base[p]=Core.clone(current);session.target[p]=Core.clone(current);manual=true;
      }
    }
    session.manual=manual;session.generated=snapshot(state);
  }
  function apply(state,id,amount=100) {
    const preset=byId.get(id);if(!preset)throw new Error('找不到这套预设。');
    const next=Core.clone(state);reconcile(next);
    const base=next.presetSession?next.presetSession.base:snapshot(next);
    return materialize(next,{id,base:Core.clone(base),target:targetFor(preset),manual:false},amount);
  }
  function setAmount(state,amount) {
    if(!state.presetSession)return Core.clone(state);
    const next=Core.clone(state);reconcile(next);
    return materialize(next,next.presetSession,amount);
  }
  function remove(state) {
    if(!state.presetSession)return Core.clone(state);
    const next=setAmount(state,0);delete next.presetSession;return next;
  }
  return {categories,catalog,byId,paths,snapshot,apply,setAmount,remove,reconcile};
});
