'use strict';
// Execute the actual fetch wrapper extracted from the project, using a local network stub.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const acorn=require('acorn');
const source=fs.readFileSync(process.argv[2],'utf8');
const tree=acorn.parse(source,{ecmaVersion:'latest'});
const functions={};let wrapper;
function walk(node){
 if(!node||typeof node!=='object')return;
 if(node.type==='FunctionDeclaration'&&['CreateQuietResponse','IsNonEssentialBackgroundRequest','GetRequestMethod'].includes(node.id.name))functions[node.id.name]=source.slice(node.start,node.end);
 if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'&&node.left.object.name==='window'&&node.left.property.name==='fetch')wrapper=source.slice(node.start,node.end);
 for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
}
walk(tree);assert(wrapper);assert.equal(Object.keys(functions).length,3);
const calls=[];
const ctx={Response,Request,Headers,URL,Promise,Map,Date,console,window:{},
 ToAbsolute:v=>new URL(v,'https://www.reddit.com/').href,
 ToProxy:v=>'https://proxy.example/?url='+encodeURIComponent(new URL(v,'https://www.reddit.com/').href),
 Options:{PageUrl:'https://www.reddit.com/'},OwObCookieJar:[],Send(){},
 OwObPendingGetRequests:new Map(),OwObRecentGetRequests:new Map(),OwObRequestCooldownMs:700,
 setTimeout(){return 0;},
 NativeFetch(input,init){calls.push({url:typeof input==='string'?input:input.url,method:init?.method||input.method||'GET'});return Promise.resolve(new Response('fixture',{status:200}));}};
vm.createContext(ctx);Object.values(functions).forEach(code=>vm.runInContext(code,ctx));vm.runInContext(wrapper,ctx);
(async()=>{
 let quietError='none';try{await ctx.CreateQuietResponse();}catch(e){quietError=e.name+': '+e.message;}
 console.log('QUIET_CONSTRUCTOR',quietError);
 const isFixed=quietError==='none';
 const endpoints=['https://www.reddit.com/svc/shreddit/events','https://www.reddit.com/svc/shreddit/client-errors','https://error-tracking.reddit.com/test'];
 for(const url of endpoints){calls.length=0;const response=await ctx.window.fetch(url,{method:'POST'});
 console.log('TELEMETRY',new URL(url).pathname,'status='+response.status,'network_calls='+calls.length);
 assert.equal(response.status,isFixed?204:200);assert.equal(calls.length,isFixed?0:1);
 if(isFixed){assert.equal(response.body,null);assert.equal(await response.text(),'');assert.equal(response.headers.get('X-OwOb-Suppressed'),'1');}
 else assert.equal(calls[0].url,url);
 }
 for(const input of ['https://www.reddit.com/svc/shreddit/community-more-posts/test',new Request('https://www.reddit.com/api/test',{method:'POST',body:'a=1'})]){
 calls.length=0;const response=await ctx.window.fetch(input);assert.equal(response.status,200);assert.equal(calls.length,1);assert(calls[0].url.startsWith('https://proxy.example/'));
 console.log('CONTENT_REQUEST','status='+response.status,'network_calls='+calls.length,'proxied=true','method='+calls[0].method);
 }
 console.log('RESULT PASS',isFixed?'MODIFIED':'BASELINE');
})().catch(e=>{console.error(e);process.exitCode=1;});
