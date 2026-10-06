/** OwO Content Worker v8.10 Exact Original - GitHub Pages + Cloudflare Worker origin mode */
const ALLOW_HEADERS="Content-Type, Range, X-Requested-With";
function cors(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,HEAD,POST,OPTIONS","Access-Control-Allow-Headers":ALLOW_HEADERS,"Access-Control-Expose-Headers":"Content-Type,X-OwO-Final-URL,X-OwO-Version"}}
function json(status,message,extra={}){return new Response(JSON.stringify({ok:false,status,message,...extra}),{status,headers:{...cors(),"Content-Type":"application/json;charset=utf-8"}})}
function blockedHost(h){h=h.toLowerCase().replace(/^\[|\]$/g,"");if(h==="localhost"||h.endsWith(".local"))return true;if(h.includes(":"))return h==="::1"||/^(fc|fd|fe80)/.test(h);const p=h.split(".").map(Number);if(p.length!==4||p.some(Number.isNaN))return false;return p[0]===10||p[0]===127||p[0]===0||p[0]===169&&p[1]===254||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]>=224}
function safeUrl(raw){let u;try{u=new URL(raw)}catch{throw new Error("目標網址格式錯誤")}if(!/^https?:$/.test(u.protocol))throw new Error("只允許 HTTP 或 HTTPS");if(blockedHost(u.hostname))throw new Error("禁止存取本機或私人網路位址");return u}
function fnv(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
function proxyUrl(requestUrl,target,mode="resource"){const u=new URL(requestUrl.origin+"/browse");u.searchParams.set("mode",mode);u.searchParams.set("url",target);const key=requestUrl.searchParams.get("key");if(key)u.searchParams.set("key",key);return u.href}
function decodeHtmlUrl(value){return String(value==null?"":value).replace(/&amp;/gi,"&").replace(/&#0*38;/gi,"&").replace(/&#x0*26;/gi,"&")}
function decodeBase64Url(value){try{let b=String(value).replace(/-/g,"+").replace(/_/g,"/");while(b.length%4)b+="=";const bytes=Uint8Array.from(atob(b),c=>c.charCodeAt(0));return new TextDecoder().decode(bytes)}catch{return""}}
function unwrapKnownRedirect(raw,base,requestUrl){
  let absolute;
  try{absolute=new URL(decodeHtmlUrl(raw),base)}catch{return decodeHtmlUrl(raw)}
  // Unwrap our own Worker URL before interpreting search engine redirects.
  for(let depth=0;depth<8&&absolute.origin===requestUrl.origin;depth++){
    const nested=absolute.searchParams.get("url");if(!nested)break;
    try{absolute=new URL(decodeHtmlUrl(nested))}catch{break}
  }
  const host=absolute.hostname.toLowerCase(),path=absolute.pathname;
  let target="";
  if((host==="bing.com"||host.endsWith(".bing.com"))&&path.startsWith("/ck/a")){
    const u=decodeHtmlUrl(absolute.searchParams.get("u")||"");
    target=u.startsWith("a1")?decodeBase64Url(u.slice(2)):u;
  }else if((host==="duckduckgo.com"||host.endsWith(".duckduckgo.com"))&&path.startsWith("/l/")){
    target=absolute.searchParams.get("uddg")||"";
  }else if((host==="google.com"||host.includes(".google."))&&path==="/url"){
    target=absolute.searchParams.get("q")||absolute.searchParams.get("url")||"";
  }else if((host==="search.yahoo.com"||host.endsWith(".search.yahoo.com"))){
    const m=path.match(/\/RU=([^/]+)\//);if(m)try{target=decodeURIComponent(m[1])}catch{}
  }
  try{const t=new URL(decodeHtmlUrl(target));if(/^https?:$/.test(t.protocol))return t.href}catch{}
  return absolute.href;
}
function isNoiseEndpoint(url){try{const u=new URL(url);return /(?:^|\.)(?:bing\.com)$/.test(u.hostname)&&/(?:\/fd\/ls\/GLinkPingPost\.aspx$|\/recoRS$|\/reportActivity$)/i.test(u.pathname)}catch{return false}}
function mapUrl(value,base,requestUrl,mode="resource"){const clean=decodeHtmlUrl(value);if(!clean||/^(data:|blob:|about:|javascript:|#)/i.test(clean))return clean;try{const final=unwrapKnownRedirect(clean,base,requestUrl);const absolute=new URL(final);if(absolute.origin===requestUrl.origin&&absolute.pathname==="/browse"&&absolute.searchParams.has("url"))return absolute.href;return proxyUrl(requestUrl,absolute.href,mode)}catch{return clean}}
function srcset(value,base,requestUrl){return String(value||"").split(",").map(x=>{const m=x.trim().match(/^(\S+)(\s+.+)?$/);return m?mapUrl(m[1],base,requestUrl)+String(m[2]||""):x}).join(", ")}
function cookieForTarget(header,host){const prefix="__owo_"+fnv(host)+"_";return String(header||"").split(/;\s*/).filter(x=>x.startsWith(prefix)).map(x=>x.slice(prefix.length)).join("; ")}
function mappedSetCookie(raw,host){const first=String(raw).split(";",1)[0];const i=first.indexOf("=");if(i<1)return null;const name=first.slice(0,i),value=first.slice(i+1);return `__owo_${fnv(host)}_${name}=${value}; Path=/; Secure; SameSite=Lax`}
const BRIDGE_JS=`(function(){"use strict";var OriginalBase=__OWO_ORIGINAL_BASE__;function send(x){x.OwOContent=true;x.OwOb=true;x.TabId=Number(new URL(location.href).searchParams.get("tab")||0);parent.postMessage(x,"*")}function abs(v){try{var text=String(v==null?"":v).replace(/&amp;/gi,"&").replace(/&#0*38;/gi,"&").replace(/&#x0*26;/gi,"&");if(!text)return OriginalBase;var u=new URL(text,OriginalBase);for(var n=0;n<8&&u.origin===location.origin&&u.searchParams.has("url");n++)u=new URL(u.searchParams.get("url"));if(/(^|\.)bing\.com$/i.test(u.hostname)&&u.pathname.indexOf("/ck/a")===0){var x=u.searchParams.get("u")||"";if(x.indexOf("a1")===0){var b=x.slice(2).replace(/-/g,"+").replace(/_/g,"/");while(b.length%4)b+="=";try{u=new URL(decodeURIComponent(escape(atob(b))))}catch(e){}}}return u.href}catch{return v}}function p(v,m){if(!v||/^(data:|blob:|about:|javascript:|#)/i.test(v))return v;var a=abs(v);try{var u=new URL(a,location.href);if(u.origin===location.origin&&u.pathname==="/browse"&&u.searchParams.has("url"))return u.href}catch(e){}return "/browse?mode="+(m||"resource")+"&url="+encodeURIComponent(a)}window.open=function(u){var a=abs(u);if(/^https?:/i.test(a))send({Type:"OpenTab",Url:a});return{closed:false,close:function(){this.closed=true},focus:function(){},blur:function(){},postMessage:function(){}}};function routeLink(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var u=abs(a.getAttribute("data-owo-url")||a.href);if(!/^https?:/i.test(u))return;e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();if(e.ctrlKey||e.metaKey||e.shiftKey||e.button===1)send({Type:"OpenTab",Url:u});else send({Type:"Navigate",Url:u})}document.addEventListener("click",routeLink,true);document.addEventListener("auxclick",routeLink,true);document.addEventListener("keydown",function(e){var k=String(e.key||"").toLowerCase();if((e.ctrlKey&&["k","l","f","d","=","+","-","0"].includes(k))||(e.altKey&&["t","w","arrowleft","arrowright"].includes(k))||k==="f5"){e.preventDefault();send({Type:"Key",Key:k,Ctrl:e.ctrlKey,Alt:e.altKey,Shift:e.shiftKey})}},true);document.addEventListener("submit",function(e){var f=e.target;e.preventDefault();var u=new URL(f.action||location.href);var d=new FormData(f);if((f.method||"get").toLowerCase()==="get"){u.search=new URLSearchParams(d).toString();send({Type:"Navigate",Url:u.href})}else{fetch(p(u.href,"request"),{method:"POST",body:d,credentials:"include"}).then(r=>r.text()).then(h=>{document.open();document.write(h);document.close()})}},true);var nf=window.fetch;window.fetch=function(i,n){var u=typeof i==="string"?i:i.url,a=abs(u);if(/\/fd\/ls\/GLinkPingPost\.aspx|\/recoRS(?:\?|$)|\/reportActivity(?:\?|$)/i.test(a))return Promise.resolve(new Response("",{status:204}));return nf.call(this,p(a,"request"),n)};var no=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var a=abs(u);if(/\/fd\/ls\/GLinkPingPost\.aspx|\/recoRS(?:\?|$)|\/reportActivity(?:\?|$)/i.test(a))a="data:text/plain,";arguments[1]=p(a,"request");return no.apply(this,arguments)};new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(!n||n.nodeType!==1)return;[n].concat(Array.from(n.querySelectorAll?n.querySelectorAll("script[src],link[href],img[src],source[src],iframe[src]"):[])).forEach(function(e){var a=e.hasAttribute("src")?"src":"href";var v=e.getAttribute(a);if(v)e.setAttribute(a,p(v))})})})}).observe(document.documentElement,{subtree:true,childList:true});var Marks=[];function clearMarks(){Marks.forEach(function(m){var p=m.parentNode;if(!p)return;p.replaceChild(document.createTextNode(m.textContent),m);p.normalize()});Marks=[]}function findText(q,back){clearMarks();q=String(q||"").trim();if(!q){send({Type:"FindResult",Count:0,Index:0});return}var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){return n.parentElement&&!/^(SCRIPT|STYLE|TEXTAREA|INPUT)$/i.test(n.parentElement.tagName)&&n.nodeValue.toLowerCase().includes(q.toLowerCase())?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}});var nodes=[],n;while(n=walker.nextNode())nodes.push(n);nodes.forEach(function(node){var text=node.nodeValue,low=text.toLowerCase(),pos=0,frag=document.createDocumentFragment(),i;while((i=low.indexOf(q.toLowerCase(),pos))>=0){frag.append(text.slice(pos,i));var m=document.createElement("mark");m.textContent=text.slice(i,i+q.length);frag.append(m);Marks.push(m);pos=i+q.length}frag.append(text.slice(pos));node.parentNode.replaceChild(frag,node)});var index=Marks.length?(back?Marks.length:1):0;if(index)Marks[index-1].scrollIntoView({block:"center"});send({Type:"FindResult",Count:Marks.length,Index:index})}window.addEventListener("message",function(e){var d=e.data;if(d&&(d.OwOContent||d.OwObCommand)&&d.Type==="Find")findText(d.Text,d.Backwards)});function report(){send({Type:"Title",Title:document.title||location.hostname});send({Type:"Loaded"})}document.addEventListener("DOMContentLoaded",report);window.addEventListener("load",report)})();`;
class Attr{constructor(attr,base,req,mode="resource"){this.attr=attr;this.base=base;this.req=req;this.mode=mode}element(e){const v=e.getAttribute(this.attr);if(!v)return;if(this.attr==="srcset"){e.setAttribute(this.attr,srcset(v,this.base,this.req));return}if(e.tagName==="a"){try{e.setAttribute("data-owo-url",unwrapKnownRedirect(v,this.base,this.req))}catch{}e.removeAttribute("target");e.removeAttribute("ping");e.setAttribute("rel","noopener noreferrer")}if(e.tagName==="form")e.removeAttribute("target");e.setAttribute(this.attr,mapUrl(v,this.base,this.req,this.mode))}}
class Injector{constructor(base,req){this.base=base;this.req=req}element(e){const safeBase=String(this.base).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");const src=new URL(this.req.origin+"/__owo_bridge.js");src.searchParams.set("base",this.base);const tab=this.req.searchParams.get("tab");if(tab)src.searchParams.set("tab",tab);const key=this.req.searchParams.get("key");if(key)src.searchParams.set("key",key);e.prepend(`<base href="${safeBase}"><script src="${src.href.replace(/&/g,"&amp;")}"><\/script>`,{html:true})}}
function htmlTransform(response,base,req){let r=new HTMLRewriter().on("head",new Injector(base,req));[["a","href","page"],["form","action","page"],["script","src","resource"],["link","href","resource"],["img","src","resource"],["img","srcset","resource"],["source","src","resource"],["source","srcset","resource"],["iframe","src","page"],["video","src","resource"],["video","poster","resource"],["audio","src","resource"],["object","data","resource"]].forEach(x=>r=r.on(x[0],new Attr(x[1],base,req,x[2])));return r.transform(response)}

function unwrapSelfProxy(raw,requestUrl){
  let current=safeUrl(raw);
  for(let depth=0;depth<8;depth++){
    if(current.origin!==requestUrl.origin)break;
    const nested=current.searchParams.get("url");
    if(!nested)break;
    current=safeUrl(nested);
  }
  return current;
}

function targetFromRequest(request,requestUrl){
  const explicit=requestUrl.searchParams.get("url");
  if(explicit)return unwrapSelfProxy(explicit,requestUrl);

  const referer=request.headers.get("Referer")||"";
  if(!referer)throw new Error("缺少目標網址");

  let ref;
  try{ref=new URL(referer)}catch{throw new Error("來源網址格式錯誤")}
  if(ref.origin!==requestUrl.origin||ref.pathname!=="/browse")throw new Error("缺少目標網址");

  const previous=ref.searchParams.get("url");
  if(!previous)throw new Error("來源中沒有目標網址");
  const base=unwrapSelfProxy(previous,requestUrl);

  // 目標網站的 JS challenge 常以 /browse?solution=... 導覽。
  // 此時沿用上一個目標頁面的路徑，只以新查詢參數取代原查詢。
  if(requestUrl.pathname==="/browse"){
    const next=new URL(base.href);
    const params=new URLSearchParams(requestUrl.search);
    params.delete("mode");params.delete("key");params.delete("url");
    next.search=params.toString();
    return safeUrl(next.href);
  }

  // 對未經 HTMLRewriter 改寫的相對路徑，以原目標網站為基準還原。
  const relative=requestUrl.pathname+requestUrl.search+requestUrl.hash;
  return safeUrl(new URL(relative,base.origin).href);
}

export default{async fetch(request,env){const ru=new URL(request.url);if(request.method==="OPTIONS")return new Response(null,{headers:cors()});const requiredKey=String(env.PROXY_KEY||env.ACCESS_KEY||"");if(requiredKey&&ru.searchParams.get("key")!==requiredKey&&request.headers.get("X-Proxy-Key")!==requiredKey)return json(401,"代理金鑰錯誤");if(ru.pathname==="/__owo_bridge.js"){const base=ru.searchParams.get("base")||"about:blank";const code=BRIDGE_JS.replace("__OWO_ORIGINAL_BASE__",JSON.stringify(base).replace(/</g,"\u003c"));return new Response(code,{headers:{...cors(),"Content-Type":"application/javascript;charset=utf-8","Cache-Control":"no-store","X-OwO-Version":"origin-mode-v8.10-exact"}})}if(!ru.searchParams.get("url")&&!request.headers.get("Referer"))return new Response(JSON.stringify({ok:true,version:"origin-mode-v8.10-exact"}),{headers:{...cors(),"Content-Type":"application/json;charset=utf-8"}});let target;try{target=targetFromRequest(request,ru)}catch(e){return json(400,e.message)}const mode=ru.searchParams.get("mode")||(ru.pathname==="/browse"?"page":"resource");if(isNoiseEndpoint(target.href))return new Response("",{status:204,headers:cors()});try{const h=new Headers(request.headers);["host","origin","referer","cf-connecting-ip","x-forwarded-for","x-real-ip","cookie"].forEach(x=>h.delete(x));h.set("User-Agent","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 OwOSimpleBrowser/8.10");const ck=cookieForTarget(request.headers.get("Cookie"),target.hostname);if(ck)h.set("Cookie",ck);let body=null;if(!/^(GET|HEAD)$/i.test(request.method))body=await request.arrayBuffer();const upstream=await fetch(target,{method:request.method,headers:h,body,redirect:"follow"});const final=unwrapSelfProxy(upstream.url,ru);const oh=new Headers(upstream.headers);["content-security-policy","content-security-policy-report-only","x-frame-options","cross-origin-opener-policy","cross-origin-embedder-policy","cross-origin-resource-policy","set-cookie","content-length","location","referrer-policy"].forEach(x=>oh.delete(x));Object.entries(cors()).forEach(([k,v])=>oh.set(k,v));oh.set("Referrer-Policy","unsafe-url");oh.set("X-OwO-Final-URL",final.href);oh.set("X-OwO-Version","origin-mode-v8.10-exact");const getSet=upstream.headers.getSetCookie?upstream.headers.getSetCookie():[];for(const c of getSet){const m=mappedSetCookie(c,final.hostname);if(m)oh.append("Set-Cookie",m)}let out=new Response(request.method==="HEAD"?null:upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:oh});if(mode==="page"&&/text\/html/i.test(oh.get("Content-Type")||""))out=htmlTransform(out,final.href,ru);return out}catch(e){return json(502,"Cloudflare Worker 無法載入目標網站",{detail:String(e&&e.message||e),target:target.href})}}};
