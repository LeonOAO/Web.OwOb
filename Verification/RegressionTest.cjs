'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=process.argv[2],proxy='https://proxy.example',host='https://frontend.example';
const listeners=[],navigations=[],errors=[],upstream=[];
const front={console,URL,URLSearchParams,Response,Request,Headers,AbortController,setTimeout,clearTimeout,
 document:{getElementById(){return {};},addEventListener(){}},window:{addEventListener(type,fn){if(type==='message')listeners.push(fn);}},
 localStorage:{getItem(){return null;},setItem(){},removeItem(){}}};
vm.createContext(front);vm.runInContext(fs.readFileSync(path.join(root,'script.js'),'utf8'),front);
vm.runInContext('GetProxyBase=()=>"https://proxy.example/?url=";GetProxyKey=()=>"secret";UpdateTabHeader=()=>{};SetLoading=()=>{};RefreshToolbar=()=>{};',front);
front.record=(tab,url)=>navigations.push({id:tab.Id,url,proxy:front.BuildSameOriginProxyUrl(url)});
front.reportError=()=>errors.push('bounded loop');
vm.runInContext('Navigate=record;RenderErrorPage=reportError;',front);
const frameA={},frameB={};
const tabA={Id:1,LoadMode:'same-origin',History:['https://www.redlib.com/article'],Index:0,ViewEl:{querySelector(){return {contentWindow:frameA};}}};
const tabB={Id:2,LoadMode:'same-origin',History:['https://other.example/article'],Index:0,ViewEl:{querySelector(){return {contentWindow:frameB};}}};
front.tabs=[tabA,tabB];vm.runInContext('State.Tabs=tabs;',front);
const worker={console,URL,URLSearchParams,Response,Request,Headers,fetch:async(url)=>{upstream.push(String(url));return new Response('<html><head></head><body>fixture</body></html>',{headers:{'Content-Type':'text/html'}});}};
vm.createContext(worker);vm.runInContext(fs.readFileSync(path.join(root,'worker.js'),'utf8').replace('export default {','globalThis.Worker = {'),worker);
function send(data,source=frameA,origin=proxy){listeners.forEach(fn=>fn({data,source,origin}));}
(async()=>{
 const request=new Request(proxy+'/lander?x=1',{headers:{'Sec-Fetch-Dest':'iframe'}});
 const response=await worker.Worker.fetch(request,{ALLOWED_ORIGINS:host});const html=await response.text();
 const modified=html.includes('RecoverRootNavigation');
 console.log('ROOT_IFRAME',response.status,response.headers.get('Content-Type'),modified?'recovery document':'health JSON','upstream_calls='+upstream.length);
 assert.equal(upstream.length,0);
 if(!modified){assert(JSON.parse(html).message.includes('運作中'));send({OwObSameOrigin:true,Type:'RecoverRootNavigation',Path:'/lander?x=1#part'});assert.equal(navigations.length,0);console.log('BASELINE root navigation remains health JSON; no recovery');}
 else{
  // Execute the real returned document script, then deliver its actual message to the parent listener.
  const messages=[];const parent={postMessage(data,target){messages.push({data,target});}};
  const recovery={window:{parent},location:{pathname:'/lander',search:'?x=1',hash:'#part'}};
  vm.createContext(recovery);const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];vm.runInContext(code,recovery);
  assert.equal(messages.length,1);assert.equal(messages[0].target,host);send(messages[0].data);
  assert.equal(navigations[0].url,'https://www.redlib.com/lander?x=1#part');
  assert.equal(navigations[0].proxy,proxy+'/__owo_proxy__/https/www.redlib.com/lander?x=1&_owo_key=secret#part');
  console.log('RECOVERED',navigations[0].proxy);
  const count=navigations.length;
  send(messages[0].data,{},proxy);send(messages[0].data,frameA,'https://wrong.example');
  for(const Path of ['//evil.example/','/\\evil.example/','https://evil.example/','/__owo_proxy__/https/evil.example/','/a\n'])send({OwObSameOrigin:true,Type:'RecoverRootNavigation',Path});
  assert.equal(navigations.length,count);console.log('REJECTED wrong source/origin and 5 invalid paths');
  send(messages[0].data);assert.equal(navigations.length,count);console.log('DUPLICATE suppressed');
  send(messages[0].data,frameB);assert.equal(navigations.at(-1).url,'https://other.example/lander?x=1#part');console.log('MULTI_TAB isolated upstream origins');
  send({OwObSameOrigin:true,Type:'State',Url:'https://final.example/article',Title:'fixture'},frameB);
  send({OwObSameOrigin:true,Type:'RecoverRootNavigation',Path:'/next'},frameB);assert.equal(navigations.at(-1).url,'https://final.example/next');console.log('STATE uses last confirmed upstream origin');
  tabA.LoadMode='standard';const before=navigations.length;send({OwObSameOrigin:true,Type:'RecoverRootNavigation',Path:'/standard'});assert.equal(navigations.length,before);tabA.LoadMode='same-origin';console.log('STANDARD_MODE unchanged');
  for(const Path of ['/two','/three','/four'])send({OwObSameOrigin:true,Type:'RecoverRootNavigation',Path});assert.equal(errors.length,1);console.log('LOOP bounded after 3 recoveries');
  const withKey=await worker.Worker.fetch(request,{ALLOWED_ORIGINS:host,ACCESS_KEY:'secret'});assert.equal(withKey.status,200);assert((await withKey.text()).includes('RecoverRootNavigation'));assert.equal(upstream.length,0);
  const denied=await worker.Worker.fetch(new Request(proxy+'/__owo_proxy__/https/example.com/'),{ACCESS_KEY:'secret'});assert.equal(denied.status,401);console.log('AUTH recovery forwards no upstream data; canonical request still requires key');
 }
 const health=await worker.Worker.fetch(new Request(proxy+'/'),{});assert.equal(health.status,200);assert((await health.json()).message.includes('運作中'));console.log('HEALTH normal root GET unchanged');
 const options=await worker.Worker.fetch(new Request(proxy+'/lander',{method:'OPTIONS'}),{});assert.equal(options.status,204);console.log('OPTIONS unchanged 204');
 const blocked=await worker.Worker.fetch(new Request(proxy+'/?url=http%3A%2F%2F127.0.0.1%2F'),{});assert.equal(blocked.status,403);console.log('PRIVATE_HOST blocked 403');
 const forbiddenOrigin=await worker.Worker.fetch(new Request(proxy+'/lander',{headers:{'Sec-Fetch-Dest':'iframe',Origin:'https://evil.example'}}),{ALLOWED_ORIGINS:host});assert.equal(forbiddenOrigin.status,403);console.log('ORIGIN_POLICY unchanged 403');
 const canonical=await worker.Worker.fetch(new Request(proxy+'/__owo_proxy__/https/example.com/page?_owo_key=secret'),{ACCESS_KEY:'secret'});assert.equal(canonical.status,200);assert.equal(upstream.at(-1),'https://example.com/page');assert((await canonical.text()).includes('__owo_same_origin_agent__'));console.log('CANONICAL proxy route and key validation PASS');
 assert(fs.readFileSync(path.join(root,'script.js'),'utf8').includes('new Response(null, {'));console.log('204_FIX retained');
 console.log('RESULT PASS',modified?'MODIFIED':'BASELINE');
})().catch(e=>{console.error(e);process.exitCode=1;});
