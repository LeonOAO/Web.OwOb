/** OwO Content Worker v8.2 - GitHub Pages + Cloudflare Worker origin mode */
const ALLOW_HEADERS="Content-Type, Range, X-Requested-With";
function cors(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,HEAD,POST,OPTIONS","Access-Control-Allow-Headers":ALLOW_HEADERS,"Access-Control-Expose-Headers":"Content-Type,X-OwO-Final-URL,X-OwO-Version"}}
function json(status,message,extra={}){return new Response(JSON.stringify({ok:false,status,message,...extra}),{status,headers:{...cors(),"Content-Type":"application/json;charset=utf-8"}})}
function blockedHost(h){h=h.toLowerCase().replace(/^\[|\]$/g,"");if(h==="localhost"||h.endsWith(".local"))return true;if(h.includes(":"))return h==="::1"||/^(fc|fd|fe80)/.test(h);const p=h.split(".").map(Number);if(p.length!==4||p.some(Number.isNaN))return false;return p[0]===10||p[0]===127||p[0]===0||p[0]===169&&p[1]===254||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]>=224}
function safeUrl(raw){let u;try{u=new URL(raw)}catch{throw new Error("目標網址格式錯誤")}if(!/^https?:$/.test(u.protocol))throw new Error("只允許 HTTP 或 HTTPS");if(blockedHost(u.hostname))throw new Error("禁止存取本機或私人網路位址");return u}
function fnv(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
function proxyUrl(requestUrl,target,mode="resource"){const u=new URL(requestUrl.origin+"/browse");u.searchParams.set("mode",mode);u.searchParams.set("url",target);const key=requestUrl.searchParams.get("key");if(key)u.searchParams.set("key",key);return u.href}
function mapUrl(value,base,requestUrl,mode="resource"){if(!value||/^(data:|blob:|about:|javascript:|#)/i.test(value))return value;try{const absolute=new URL(value,base);if(absolute.origin===requestUrl.origin&&absolute.pathname==="/browse"&&absolute.searchParams.has("url"))return absolute.href;return proxyUrl(requestUrl,absolute.href,mode)}catch{return value}}
function srcset(value,base,requestUrl){return String(value||"").split(",").map(x=>{const m=x.trim().match(/^(\S+)(\s+.+)?$/);return m?mapUrl(m[1],base,requestUrl)+String(m[2]||""):x}).join(", ")}
function cookieForTarget(header,host){const prefix="__owo_"+fnv(host)+"_";return String(header||"").split(/;\s*/).filter(x=>x.startsWith(prefix)).map(x=>x.slice(prefix.length)).join("; ")}
function mappedSetCookie(raw,host){const first=String(raw).split(";",1)[0];const i=first.indexOf("=");if(i<1)return null;const name=first.slice(0,i),value=first.slice(i+1);return `__owo_${fnv(host)}_${name}=${value}; Path=/; Secure; SameSite=Lax`}
const BRIDGE=`<script>(function(){"use strict";function send(x){x.OwOContent=true;parent.postMessage(x,"*")}function abs(v){try{return new URL(v,location.href).href}catch{return v}}function p(v,m){if(!v||/^(data:|blob:|about:|javascript:|#)/i.test(v))return v;var a=abs(v);try{var u=new URL(a,location.href);if(u.origin===location.origin&&u.pathname==="/browse"&&u.searchParams.has("url"))return u.href}catch(e){}return "/browse?mode="+(m||"resource")+"&url="+encodeURIComponent(a)}window.open=function(u){send({Type:"OpenTab",Url:abs(u)});return null};document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a)return;var u=abs(a.getAttribute("data-owo-url")||a.href);if(!/^https?:/i.test(u))return;e.preventDefault();send({Type:(a.target==="_blank"||e.ctrlKey||e.metaKey)?"OpenTab":"Navigate",Url:u})},true);document.addEventListener("submit",function(e){var f=e.target;e.preventDefault();var u=new URL(f.action||location.href);var d=new FormData(f);if((f.method||"get").toLowerCase()==="get"){u.search=new URLSearchParams(d).toString();send({Type:"Navigate",Url:u.href})}else{fetch(p(u.href,"request"),{method:"POST",body:d,credentials:"include"}).then(r=>r.text()).then(h=>{document.open();document.write(h);document.close()})}},true);var nf=window.fetch;window.fetch=function(i,n){var u=typeof i==="string"?i:i.url;return nf.call(this,p(u,"request"),n)};var no=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=p(u,"request");return no.apply(this,arguments)};new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(!n||n.nodeType!==1)return;[n].concat(Array.from(n.querySelectorAll?n.querySelectorAll("script[src],link[href],img[src],source[src],iframe[src]"):[])).forEach(function(e){var a=e.hasAttribute("src")?"src":"href";var v=e.getAttribute(a);if(v)e.setAttribute(a,p(v))})})})}).observe(document.documentElement,{subtree:true,childList:true});function report(){send({Type:"Title",Title:document.title||location.hostname});send({Type:"Loaded"})}document.addEventListener("DOMContentLoaded",report);window.addEventListener("load",report)})();<\/script>`;
class Attr{constructor(attr,base,req,mode="resource"){this.attr=attr;this.base=base;this.req=req;this.mode=mode}element(e){const v=e.getAttribute(this.attr);if(!v)return;if(this.attr==="srcset")e.setAttribute(this.attr,srcset(v,this.base,this.req));else{if(e.tagName==="a")e.setAttribute("data-owo-url",new URL(v,this.base).href);e.setAttribute(this.attr,mapUrl(v,this.base,this.req,this.mode))}}}
class Injector{element(e){e.prepend(BRIDGE,{html:true})}}
function htmlTransform(response,base,req){let r=new HTMLRewriter().on("head",new Injector());[["a","href","page"],["form","action","page"],["script","src","resource"],["link","href","resource"],["img","src","resource"],["img","srcset","resource"],["source","src","resource"],["source","srcset","resource"],["iframe","src","page"],["video","src","resource"],["video","poster","resource"],["audio","src","resource"],["object","data","resource"]].forEach(x=>r=r.on(x[0],new Attr(x[1],base,req,x[2])));return r.transform(response)}

function targetFromRequest(request,requestUrl){
  const explicit=requestUrl.searchParams.get("url");
  if(explicit)return safeUrl(explicit);

  const referer=request.headers.get("Referer")||"";
  if(!referer)throw new Error("缺少目標網址");

  let ref;
  try{ref=new URL(referer)}catch{throw new Error("來源網址格式錯誤")}
  if(ref.origin!==requestUrl.origin||ref.pathname!=="/browse")throw new Error("缺少目標網址");

  const previous=ref.searchParams.get("url");
  if(!previous)throw new Error("來源中沒有目標網址");
  const base=safeUrl(previous);

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

export default{async fetch(request,env){const ru=new URL(request.url);if(request.method==="OPTIONS")return new Response(null,{headers:cors()});if(env.PROXY_KEY&&ru.searchParams.get("key")!==env.PROXY_KEY)return json(401,"代理金鑰錯誤");let target;try{target=targetFromRequest(request,ru)}catch(e){return json(400,e.message)}const mode=ru.searchParams.get("mode")||(ru.pathname==="/browse"?"page":"resource");try{const h=new Headers(request.headers);["host","origin","referer","cf-connecting-ip","x-forwarded-for","x-real-ip","cookie"].forEach(x=>h.delete(x));h.set("User-Agent","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 OwOSimpleBrowser/8.2");const ck=cookieForTarget(request.headers.get("Cookie"),target.hostname);if(ck)h.set("Cookie",ck);let body=null;if(!/^(GET|HEAD)$/i.test(request.method))body=await request.arrayBuffer();const upstream=await fetch(target,{method:request.method,headers:h,body,redirect:"follow"});const final=safeUrl(upstream.url);const oh=new Headers(upstream.headers);["content-security-policy","content-security-policy-report-only","x-frame-options","cross-origin-opener-policy","cross-origin-embedder-policy","cross-origin-resource-policy","set-cookie","content-length"].forEach(x=>oh.delete(x));Object.entries(cors()).forEach(([k,v])=>oh.set(k,v));oh.set("X-OwO-Final-URL",final.href);oh.set("X-OwO-Version","origin-mode-v8.2");const getSet=upstream.headers.getSetCookie?upstream.headers.getSetCookie():[];for(const c of getSet){const m=mappedSetCookie(c,final.hostname);if(m)oh.append("Set-Cookie",m)}let out=new Response(request.method==="HEAD"?null:upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:oh});if(mode==="page"&&/text\/html/i.test(oh.get("Content-Type")||""))out=htmlTransform(out,final.href,ru);return out}catch(e){return json(502,"Cloudflare Worker 無法載入目標網站",{detail:String(e&&e.message||e),target:target.href})}}};
