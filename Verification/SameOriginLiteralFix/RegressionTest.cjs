'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[2];const calls=[];
const body='<html><head><script>window.location.replace("/lander");</script></head><body>fixture</body></html>';
const context={URL,URLSearchParams,Response,Request,Headers,console,fetch:async(url)=>{calls.push(String(url));return new Response(body,{headers:{'Content-Type':'text/html'}});}};
vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8').replace('export default {','globalThis.Worker={'),context);
(async()=>{
 const fixed=typeof context.RewriteSameOriginLiteralRedirects==='function';
 const req=new URL('https://proxy.example/__owo_proxy__/https/www.redlib.com/article?_owo_key=secret');
 const html=context.RewriteSameOriginHtml(body,'https://www.redlib.com/article',req);
 const script=html.match(/<script>\s*(location[^<]*|window.location[^<]*)<\/script>/)[1];
 let observed='';const location={replace(v){observed=v;},assign(v){observed=v;},set href(v){observed=v;}};
 vm.runInNewContext(script,{window:{location},location});
 const resolved=new URL(observed,req);
 console.log('SCRIPT_NAVIGATION',resolved.href);
 assert.equal(resolved.href,fixed?'https://proxy.example/__owo_proxy__/https/www.redlib.com/lander?_owo_key=secret':'https://proxy.example/lander');
 if(fixed){
  const cases=['location="/lander";','location.href = "/lander?x=1#part";','document.location.assign(\'/lander\');','self.location.replace("/lander");'];
  for(const code of cases){const result=context.RewriteSameOriginLiteralRedirects('<script>'+code+'</script>','https://www.redlib.com/article',req);assert(result.includes('/__owo_proxy__/https/www.redlib.com/lander'));}
  const unchanged=['<script>const s="location.href=1";</script>','<script>if(true)location.href="/lander";</script>','<script>location.href=target;</script>','<script>location.href="//other.example/path";</script>','<script src="a.js">location.href="/lander";</script>','<script type="application/json">{"path":"/lander"}</script>','<script>location.href="https://other.example/path";</script>'];
  for(const input of unchanged)assert.equal(context.RewriteSameOriginLiteralRedirects(input,'https://www.redlib.com/article',req),input);
  console.log('SUPPORTED_LITERAL_FORMS 4 PASS; COMPLEX/EXTERNAL/DATA_SCRIPTS 7 unchanged');
 }
 const standard=await context.Worker.fetch(new Request('https://proxy.example/?url=https%3A%2F%2Fwww.redlib.com%2Farticle&key=secret'),{ACCESS_KEY:'secret'});
 assert.equal(await standard.text(),body);console.log('STANDARD_HTML byte-identical to upstream fixture');
 const same=await context.Worker.fetch(new Request(req),{ACCESS_KEY:'secret'});const sameBody=await same.text();assert.equal(same.status,200);assert.equal(sameBody.includes('location.replace("https://proxy.example/__owo_proxy__/https/www.redlib.com/lander'),fixed);console.log('SAME_ORIGIN_HANDLER',fixed?'redirect rewritten':'redirect remains raw');
 const health=await context.Worker.fetch(new Request('https://proxy.example/'),{});assert((await health.json()).message.includes('運作中'));console.log('HEALTH unchanged');
 const denied=await context.Worker.fetch(new Request('https://proxy.example/__owo_proxy__/https/example.com/'),{ACCESS_KEY:'secret'});assert.equal(denied.status,401);
 const blocked=await context.Worker.fetch(new Request('https://proxy.example/?url=http://127.0.0.1/'),{});assert.equal(blocked.status,403);
 console.log('AUTH 401 and PRIVATE_HOST 403 unchanged');console.log('RESULT PASS',fixed?'MODIFIED':'BASELINE');
})().catch(e=>{console.error(e);process.exitCode=1;});
