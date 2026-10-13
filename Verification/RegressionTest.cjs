"use strict";
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const root = process.argv[2];
const sandbox = {console,URL,URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,
 document:{getElementById(){return {};},addEventListener(){},createElement(){return {set innerHTML(v){this.value=v.replace(/&amp;/g,"&");}};}},
 window:{addEventListener(){}},localStorage:{getItem(){return null;},setItem(){},removeItem(){}}};
vm.createContext(sandbox);
const parser=path.join(root,"Assets/acorn.js");
if(fs.existsSync(parser))vm.runInContext(fs.readFileSync(parser,"utf8"),sandbox);
vm.runInContext(fs.readFileSync(path.join(root,"script.js"),"utf8"),sandbox);
vm.runInContext('GetFlag=()=>false;GetProxyBase=()=>"https://proxy.example/?url=";GetProxyKey=()=>"";',sandbox);
const code='window.location.replace("http://www.redlib.com/lander");';
const output=sandbox.RewriteJavaScriptUrls(code,"https://www.redlib.com/");
console.log("NAVIGATION",output);
const html='<iframe src="http://www.redlib.com/lander"></iframe>';
const frame=sandbox.RewriteHtmlResources(html,"https://www.redlib.com/");
console.log("FRAME",frame);
const modified=fs.existsSync(parser);
if(modified){
 assert(output.includes("__OwObNavigate"));assert(frame.includes("https://proxy.example/__owo_proxy__/http/www.redlib.com/lander"));
 const cases=[
  ['location.href="/next";',true],['self.location.assign("/next");',true],['document.location="/next";',true],
  ['window["location"]["href"]="/next";',true],['location.href = location.href = "/next";',true],
  ['const text="window.location.href=1"; // location.href=2',false],
  ['function f(location){location.href="/next";}',false],
  ['const window={};window.location="/next";',false],['const broken = ;',false]
 ];
 for(const [input,change] of cases){const out=sandbox.RewriteNavigationJavaScript(input);assert.equal(out!==input,change,input);if(input!=="const broken = ;")sandbox.acorn.parse(out,{ecmaVersion:"latest"});}
 console.log("PARSER_CASES",cases.length,"PASS");
 let called=[];sandbox.__OwObNavigate=(v,r,m)=>{called.push([v,r,m]);return m?undefined:v;};
 vm.runInContext(output,sandbox);assert.equal(called[0][0],"http://www.redlib.com/lander");assert.equal(called[0][1],true);
 console.log("BRIDGE","replace=true; upstream location not executed");
 // Worker syntax, inline/external script rewriting and generated agent syntax.
 const worker={console,URL,URLSearchParams,Response,Request,Headers};vm.createContext(worker);
 vm.runInContext(fs.readFileSync(path.join(root,"worker.js"),"utf8").replace("export default {","globalThis.WorkerExport = {"),worker);
 const req=new URL("https://proxy.example/__owo_proxy__/https/www.redlib.com/");
 const inline=worker.RewriteSameOriginHtml('<head></head><script>'+code+'</script>',"https://www.redlib.com/",req);
 assert(inline.includes("__OwObNavigate"));
 assert(worker.RewriteJavaScriptResponse(code,"https://www.redlib.com/a.js",req).includes("__OwObNavigate"));
 const agent=worker.BuildSameOriginCompatibilityAgent("https://www.redlib.com/",req);
 new vm.Script(agent);
 console.log("WORKER","inline/external redirect rewritten; generated agent parses");
 // Verify runtime resource hooks without executing a real browser document.
 const agentSource=fs.readFileSync(path.join(root,"script.js"),"utf8");
 assert(agentSource.includes('HookProperty(window.HTMLIFrameElement, "src")'));
 assert(agentSource.includes('MapAttribute(property, String(value), this)'));
 assert(agentSource.includes('MapAttribute(lower, String(value), this)'));
 const parsed=sandbox.acorn.parse(agentSource,{ecmaVersion:"latest"});
 const frameAgent=parsed.body.find(n=>n.type==="FunctionDeclaration"&&n.id.name==="OwObFrameAgent");
 const nodes=frameAgent.body.body.filter(n=>n.type==="FunctionDeclaration"&&["MapAttribute","HookProperty"].includes(n.id.name));
 const hooks={URL,NativeURL:URL,Options:{ProxyBase:"https://proxy.example/?url=",ProxyKey:""},
  ToAbsolute:v=>new URL(v,"https://www.redlib.com/").href,
  ShouldProxy:v=>!v.startsWith("https://proxy.example/"),ToProxy:v=>v,
  IsRewritable:()=>true};
 vm.createContext(hooks);for(const n of nodes)vm.runInContext(agentSource.slice(n.start,n.end),hooks);
 class Frame {constructor(){this.tagName="IFRAME";}get src(){return this._src;}set src(v){this._src=v;}}
 hooks.HookProperty(Frame,"src");const element=new Frame();element.src="http://www.redlib.com/lander";
 assert.equal(element.src,"https://proxy.example/__owo_proxy__/http/www.redlib.com/lander");
 assert.equal(hooks.MapAttribute("src","http://www.redlib.com/lander",element),element.src);
 console.log("DYNAMIC_FRAME","native property setter and attribute mapper route to HTTPS proxy");
 vm.runInContext('RefreshToolbar=()=>{};SaveOpenTabs=()=>{};ResetFindStatus=()=>{};AddHistoryRecord=()=>{};LoadExternalPage=()=>{};',sandbox);
 const tab={Id:1,History:["https://www.redlib.com/"],Index:0,Abort:null};
 sandbox.Navigate(tab,"https://www.redlib.com/lander",false);
 assert.equal(tab.History.length,1);assert.equal(tab.History[0],"https://www.redlib.com/lander");
 console.log("REPLACE_HISTORY","current entry replaced; no extra history entry");
}else{assert.equal(output,code);assert.equal(frame,html);console.log("BASELINE","direct navigation and unproxied frame reproduced");}
console.log("RESULT PASS");
