const path=require('node:path'),{spawn}=require('node:child_process');
async function start({prefix=''}={}){
 const child=spawn(path.resolve('.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),['-u',path.join(__dirname,'community-test-server.py')],{stdio:['pipe','pipe','pipe'],env:{...process.env,HMI_TEST_PREFIX:prefix}});
 let logs='';child.stderr.on('data',d=>logs+=d);
 const url=await new Promise((resolve,reject)=>{let s='';const timer=setTimeout(()=>{child.kill();reject(Error('Isolated server timeout: '+logs));},15000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+logs));});child.stdout.on('data',d=>{s+=d;const m=s.match(/READY (http:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 return{url,stop:async()=>{child.stdin.end('\n');await new Promise(resolve=>{const t=setTimeout(()=>{child.kill();resolve();},3000);child.once('exit',()=>{clearTimeout(t);resolve();});});}};
}
module.exports={start};
if(require.main===module)(async()=>{
 const server=await start();try{for(const file of process.argv.slice(2)){
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.resolve(file)],{stdio:'inherit',env:{...process.env,HMI_TEST_URL:server.url}});child.on('error',reject);child.on('exit',resolve);});
  if(code!==0)throw Error(file+' failed ('+code+')');
 }}finally{await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
