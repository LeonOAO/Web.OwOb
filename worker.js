/* ============================================================
 *  OwOb Proxy - Cloudflare Worker（CORS / 同源反向代理）v9
 *
 *  用法：
 *      GET  https://owob-proxy.kkwan812.workers.dev/?url=<已編碼的目標網址>
 *      POST https://owob-proxy.kkwan812.workers.dev/?url=<已編碼的目標網址>
 *           Body：application/x-www-form-urlencoded（或網頁 fetch 送出的原始內容類型）
 *
 *      設定 ACCESS_KEY 時，每個請求都必須附上金鑰（二擇一）：
 *          查詢參數 &key=<金鑰>   ← <img> 等無法自訂標頭的資源請求使用
 *          請求標頭 X-Proxy-Key
 *
 *  自訂請求標頭（由 OwOb 前端送出）：
 *      X-Proxy-Cookie-Jar：同站 Cookie 罐（JSON 後再 URI 編碼，可跨子網域轉址使用）
 *      X-Proxy-Cookie   ：舊版格式「a=1; b=2」（相容用，只套用到起始主機）
 *      X-Proxy-Referer  ：要轉送給目標網站的 Referer（送出表單時的頁面網址）
 *      X-Proxy-Key      ：存取金鑰（亦可改用 key 查詢參數）
 *
 *  會轉送給目標網站的一般標頭：
 *      Accept（非預設值時）、Range（影音分段載入）
 *
 *  自訂回應標頭（回傳給 OwOb 前端）：
 *      X-Final-URL         ：轉址後的最終網址
 *      X-Proxy-Status      ：目標網站原始狀態碼
 *      X-Proxy-Set-Cookie  ：目標網站設定的 Cookie（JSON 後再 URI 編碼）
 *
 *  架構：
 *      1. 設定（允許來源、轉送標頭、轉址上限）
 *      2. CORS 工具函式
 *      3. 安全檢查（協定 / 內網位址 / 存取金鑰）
 *      4. Cookie 工具函式
 *      5. 逐步轉址抓取（保留每一跳的 Set-Cookie）
 *      6. 主要處理流程（OPTIONS / GET / HEAD / POST）
 *
 *  環境變數（Cloudflare → Worker → Settings → Variables）：
 *      ALLOWED_ORIGINS = https://leonoao.github.io
 *      （多個來源以逗號分隔；只填「協定 + 網域」，不可含路徑與結尾斜線）
 *
 *      ACCESS_KEY = <自訂的一組長亂碼>（選填，建議設為 Secret）
 *      （設定後未附正確金鑰的請求一律回傳 401，避免代理被他人盜用；
 *        OwOb 前端請在「設定 → 代理伺服器 → 代理金鑰」填入相同值）
 * ============================================================ */


/* ============================================================
 *  1. 設定
 * ============================================================ */

// 未設定環境變數時使用的預設允許來源
const DefaultAllowedOrigins = [
    "https://leonoao.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
];

// 最多跟隨幾次轉址
const MaxRedirects = 15;

// 回應給前端時要移除的標頭（避免 iframe 被擋、避免長度不符）
const StripResponseHeaders = [
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
    "strict-transport-security",
    "set-cookie",
    "content-length",
    "location"
];

// 模擬一般瀏覽器的請求標頭，降低被目標網站拒絕的機率
const BrowserHeaders = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
};


/* ============================================================
 *  2. CORS 工具函式
 * ============================================================ */

/** 自訂錯誤：帶 HTTP 狀態碼 */
class ProxyError extends Error {
    constructor(status, message) {
        super(message);
        this.Status = status;
    }
}

/** 取得允許來源清單（環境變數優先） */
function GetAllowedOrigins(env) {
    const raw = (env && env.ALLOWED_ORIGINS) ? String(env.ALLOWED_ORIGINS) : "";

    const list = raw
        ? raw.split(",")
        : DefaultAllowedOrigins;

    // 去除空白與結尾斜線，避免「https://xxx.github.io/」這類寫法比對失敗
    return list
        .map(item => item.trim().replace(/\/+$/, ""))
        .filter(Boolean);
}

/**
 * 判斷請求來源是否允許
 *   - 無 Origin：直接在網址列開啟、iframe src 載入圖片 / PDF → 允許
 *   - "null"：沙箱 iframe 內發出的請求 → 允許
 *   - 清單內含 "*" → 全部允許
 */
function IsOriginAllowed(origin, allowedOrigins) {
    if (!origin || origin === "null") {
        return true;
    }

    if (allowedOrigins.includes("*")) {
        return true;
    }

    return allowedOrigins.includes(origin);
}

// 預設允許的請求標頭
const DefaultAllowHeaders = "Content-Type, Accept, Accept-Language, Range, Authorization, X-Requested-With, X-CSRF-Token, X-Reddit-Compression, X-Proxy-Cookie, X-Proxy-Cookie-Jar, X-Proxy-Referer, X-Proxy-Key, X-Proxy-Headers";

const ForwardRequestHeaders = ["Accept-Language", "Authorization", "X-Requested-With", "X-CSRF-Token", "X-Reddit-Compression"];
const BlockedForwardHeaders = new Set([
    "host", "cookie", "origin", "referer", "content-length", "connection",
    "cf-connecting-ip", "cf-ipcountry", "cf-ray", "x-forwarded-for", "x-forwarded-proto"
]);

function DecodeForwardHeaders(request) {
    const output = {};
    const encoded = request.headers.get("X-Proxy-Headers");
    if (encoded) {
        try {
            const parsed = JSON.parse(decodeURIComponent(encoded));
            Object.entries(parsed).forEach(([name, value]) => {
                const lower = String(name).toLowerCase();
                if (!BlockedForwardHeaders.has(lower) && !lower.startsWith("sec-") &&
                    !lower.startsWith("proxy-") && typeof value === "string") {
                    output[name] = value;
                }
            });
        } catch (error) { /* 格式錯誤時沿用基本標頭 */ }
    }
    ForwardRequestHeaders.forEach(name => {
        const value = request.headers.get(name);
        if (value) output[name] = value;
    });
    return output;
}

/**
 * 建立 CORS 標頭
 * @param {string|null} origin            請求來源；沙箱 iframe 為 "null"
 * @param {string|null} requestedHeaders  預檢請求的 Access-Control-Request-Headers
 *        網頁內 fetch 可能帶任意自訂標頭，預檢時一律回應允許，避免被瀏覽器擋下
 */
function BuildCorsHeaders(origin, requestedHeaders = null) {
    const headers = {
        "Access-Control-Allow-Origin":   origin || "*",
        "Access-Control-Allow-Methods":  "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":  requestedHeaders || DefaultAllowHeaders,
        "Access-Control-Expose-Headers": "Content-Type, Content-Range, Accept-Ranges, X-Final-URL, X-Proxy-Status, X-Proxy-Set-Cookie, X-OwOb-Worker-Version",
        "Access-Control-Max-Age":        "86400",
        "Vary":                          "Origin"
    };

    // 有明確來源時允許帶憑證（網頁 XHR 設定 withCredentials 時才不會被擋）
    if (origin) {
        headers["Access-Control-Allow-Credentials"] = "true";
    }

    return headers;
}

/**
 * 回傳 JSON 錯誤
 * 錯誤回應同樣附上 CORS 標頭，前端才讀得到錯誤內容，
 * 否則瀏覽器只會顯示「Failed to fetch」
 */
function JsonResponse(status, message, origin, extra = {}) {
    return new Response(
        JSON.stringify({ ok: status < 400, status, message, ...extra }),
        {
            status,
            headers: {
                ...BuildCorsHeaders(origin),
                "Content-Type": "application/json; charset=utf-8"
            }
        }
    );
}


/* ============================================================
 *  3. 安全檢查
 * ============================================================ */

/** 封鎖本機與內網位址，避免代理被拿來存取內部服務 */
function IsBlockedHost(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
        return true;
    }

    // IPv6 本機 / 內網
    if (host.includes(":")) {
        return (
            host === "::1" ||
            host.startsWith("fc") ||
            host.startsWith("fd") ||
            host.startsWith("fe80")
        );
    }

    // IPv4 內網
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
        return (
            a === 0   ||
            a === 10  ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127)
        );
    }

    return false;
}

/** 取得存取金鑰（未設定回傳空字串 = 不驗證） */
function GetAccessKey(env) {
    return env && env.ACCESS_KEY ? String(env.ACCESS_KEY).trim() : "";
}

/** 固定時間比較字串，避免以回應時間推測金鑰 */
function SafeEqual(a, b) {
    const left  = String(a);
    const right = String(b);
    let diff = left.length ^ right.length;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
    }
    return diff === 0;
}

/** 驗證請求是否附上正確金鑰（查詢參數 key 或標頭 X-Proxy-Key） */
function IsKeyValid(request, requestUrl, accessKey) {
    if (!accessKey) return true;
    const provided = requestUrl.searchParams.get("key") || requestUrl.searchParams.get("_owo_key") || request.headers.get("X-Proxy-Key") || "";
    return SafeEqual(provided, accessKey);
}

/** 檢查網址協定與主機 */
function AssertSafeUrl(url) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new ProxyError(400, `只支援 http / https：${url.protocol}`);
    }

    if (IsBlockedHost(url.hostname)) {
        throw new ProxyError(403, `禁止存取內網位址：${url.hostname}`);
    }
}


/* ============================================================
 *  4. Cookie 工具函式（依網域管理）
 *     轉址鏈中常會在不同子網域間跳轉（例如 tw.search.yahoo.com
 *     → guce.yahoo.com → tw.search.yahoo.com），且以
 *     Domain=.yahoo.com 的 Cookie 確認「已設定 Cookie」。
 *     若換主機就清空 Cookie，網站會一直轉址回來 → 無限轉址。
 *     因此改用依網域比對的 Cookie 罐。
 * ============================================================ */

/**
 * 建立 Cookie 罐
 * 項目結構：{ Domain, Name, Value, HostOnly }
 */
function CreateCookieJar(entries) {
    const jar = [];

    (Array.isArray(entries) ? entries : []).forEach(item => {
        if (item && typeof item.Domain === "string" && typeof item.Name === "string") {
            jar.push({
                Domain:   item.Domain.toLowerCase(),
                Name:     item.Name,
                Value:    String(item.Value ?? ""),
                HostOnly: Boolean(item.HostOnly)
            });
        }
    });

    return jar;
}

/** 將「a=1; b=2」舊格式 Cookie 轉成 Cookie 罐項目（綁定起始主機） */
function ParseLegacyCookie(text, host) {
    const entries = [];

    String(text || "").split(";").forEach(part => {
        const index = part.indexOf("=");
        if (index > 0) {
            entries.push({
                Domain:   host,
                Name:     part.slice(0, index).trim(),
                Value:    part.slice(index + 1).trim(),
                HostOnly: true
            });
        }
    });

    return entries;
}

/** 取得要送給指定主機的 Cookie 標頭 */
function GetCookieHeaderForHost(jar, host) {
    const target = host.toLowerCase();

    return jar
        .filter(item =>
            target === item.Domain ||
            (!item.HostOnly && target.endsWith("." + item.Domain))
        )
        .map(item => `${item.Name}=${item.Value}`)
        .join("; ");
}

/**
 * 將一筆 Set-Cookie 寫入 Cookie 罐
 * @returns {boolean} Cookie 罐是否有變動
 */
function ApplySetCookieToJar(jar, host, cookie) {
    const parts = String(cookie).split(";");
    const pair  = parts.shift();
    const index = pair.indexOf("=");

    if (index <= 0) return false;

    const name  = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();

    let domain   = host.toLowerCase();
    let hostOnly = true;
    let expired  = false;

    for (const part of parts) {
        const [rawKey, ...rest] = part.split("=");
        const key = rawKey.trim().toLowerCase();
        const val = rest.join("=").trim();

        if (key === "domain" && val) {
            const cleaned = val.replace(/^\./, "").toLowerCase();

            // 只接受主機本身或其上層網域，避免跨站寫入
            if (domain !== cleaned && !domain.endsWith("." + cleaned)) {
                return false;
            }

            domain   = cleaned;
            hostOnly = false;
        } else if (key === "max-age" && val) {
            expired = Number(val) <= 0;
        } else if (key === "expires" && val) {
            const time = Date.parse(val);
            if (!Number.isNaN(time) && time <= Date.now()) expired = true;
        }
    }

    const existing = jar.findIndex(item => item.Domain === domain && item.Name === name);

    if (expired) {
        if (existing !== -1) {
            jar.splice(existing, 1);
            return true;
        }
        return false;
    }

    if (existing !== -1) {
        const changed = jar[existing].Value !== value;
        jar[existing] = { Domain: domain, Name: name, Value: value, HostOnly: hostOnly };
        return changed;
    }

    jar.push({ Domain: domain, Name: name, Value: value, HostOnly: hostOnly });
    return true;
}

/** 取得回應中所有 Set-Cookie（相容不同 Workers 執行環境） */
function GetSetCookies(headers) {
    if (typeof headers.getSetCookie === "function") {
        return headers.getSetCookie();
    }

    if (typeof headers.getAll === "function") {
        return headers.getAll("Set-Cookie");
    }

    const single = headers.get("Set-Cookie");
    return single ? [single] : [];
}


/* ============================================================
 *  5. 逐步轉址抓取
 *     使用 redirect: "manual" 自行跟隨轉址，
 *     保留每一跳的 Set-Cookie，並依網域送出正確 Cookie
 * ============================================================ */

async function FetchWithRedirects(startUrl, options) {
    let currentUrl = new URL(startUrl);
    let method     = options.Method;
    let body       = options.Body;
    let referer    = options.Referer;

    const jar       = options.Jar;
    const collected = [];          // [{ Host, Cookie }] 回傳給前端保存
    const visited   = new Map();   // 網址 → 上次經過時的 Cookie 狀態（偵測無限轉址）

    for (let hop = 0; hop <= MaxRedirects; hop++) {
        AssertSafeUrl(currentUrl);

        /* ---------- 無限轉址偵測 ---------- */
        // 同一網址、同一 Cookie 狀態再次出現 → 一定會一直繞圈，提早結束
        const stateKey = method + " " + currentUrl.toString();
        const cookieState = GetCookieHeaderForHost(jar, currentUrl.hostname);

        if (visited.get(stateKey) === cookieState) {
            throw new ProxyError(
                508,
                `目標網站形成轉址迴圈（${currentUrl.hostname}），網站可能拒絕代理伺服器或要求額外驗證`
            );
        }
        visited.set(stateKey, cookieState);

        /* ---------- 組合請求標頭 ---------- */
        const headers = new Headers(BrowserHeaders);

        if (options.ForwardHeaders) {
            Object.entries(options.ForwardHeaders).forEach(([name, value]) => {
                if (value) headers.set(name, value);
            });
        }

        if (cookieState) {
            headers.set("Cookie", cookieState);
        }

        if (referer) {
            headers.set("Referer", referer);
        }

        if (options.Accept) {
            headers.set("Accept", options.Accept);
        }

        if (options.Range) {
            headers.set("Range", options.Range);
        }

        if (!["GET", "HEAD"].includes(method)) {
            headers.set("Content-Type", options.ContentType);
            headers.set("Origin", currentUrl.origin);
        }

        /* ---------- 發出請求 ---------- */
        const response = await fetch(currentUrl.toString(), {
            method,
            headers,
            body:     ["GET", "HEAD"].includes(method) ? undefined : body,
            redirect: "manual"
        });

        /* ---------- 收集 Set-Cookie ---------- */
        GetSetCookies(response.headers).forEach(cookie => {
            collected.push({ Host: currentUrl.hostname, Cookie: cookie });
            ApplySetCookieToJar(jar, currentUrl.hostname, cookie);
        });

        /* ---------- 處理轉址 ---------- */
        const location   = response.headers.get("Location");
        const isRedirect = response.status >= 300 && response.status < 400 && location;

        if (!isRedirect) {
            return {
                Response:   response,
                FinalUrl:   currentUrl.toString(),
                SetCookies: collected
            };
        }

        // 丟棄轉址回應的內容，釋放連線
        if (response.body) {
            await response.body.cancel().catch(() => {});
        }

        const nextUrl = new URL(location, currentUrl);

        // 301 / 302 / 303 遇到 POST 時改為 GET（與瀏覽器行為一致）
        if (response.status === 303 || (!["GET", "HEAD"].includes(method) && (response.status === 301 || response.status === 302))) {
            method = "GET";
            body   = null;
        }

        referer    = currentUrl.toString();
        currentUrl = nextUrl;
    }

    throw new ProxyError(508, `轉址次數超過 ${MaxRedirects} 次`);
}


/* ============================================================
 *  6. JavaScript 模組網址改寫
 * ============================================================ */
function IsJavaScriptResponse(headers, url) {
    const type = String(headers.get("Content-Type") || "").toLowerCase();
    return type.includes("javascript") || type.includes("ecmascript") || /\.(?:m?js)(?:$|[?#])/i.test(String(url));
}
function BuildNestedProxyUrl(requestUrl, targetUrl) {
    const nested = new URL(requestUrl.origin + requestUrl.pathname);
    nested.searchParams.set("url", targetUrl);
    const key = requestUrl.searchParams.get("key");
    if (key) nested.searchParams.set("key", key);
    return nested.toString();
}
function RewriteJavaScriptResponse(code, sourceUrl, requestUrl) {
    const map = value => {
        if (!value || /^(?:data:|blob:|javascript:|#)/i.test(value)) return value;
        try {
            const absoluteUrl = new URL(value, sourceUrl);
            const proxyPath   = requestUrl.origin + requestUrl.pathname;
            if (absoluteUrl.toString().startsWith(proxyPath + "?")) return value;
            return /^https?:\/\//i.test(absoluteUrl.toString())
                ? BuildNestedProxyUrl(requestUrl, absoluteUrl.toString())
                : value;
        } catch {
            return value;
        }
    };

    // 僅改寫 import/export 的模組指定符。全域 URL 字串替換會破壞大型壓縮腳本。
    return String(code).replace(
        /(\b(?:import\s*\(\s*|import\s+|(?:import|export)\b[^;]*?\bfrom\s*))(["'`])([^"'`$]+)\2/g,
        (match, prefix, quote, value) => `${prefix}${quote}${map(value)}${quote}`
    );
}

/* ============================================================
 *  7. 同源反向代理路徑模式
 * ============================================================ */
const SameOriginPrefix = "/__owo_proxy__/";
function ParseSameOriginTarget(requestUrl) {
    const rest = requestUrl.pathname.slice(SameOriginPrefix.length);
    const protocolEnd = rest.indexOf("/");
    const protocol = rest.slice(0, protocolEnd);
    const hostAndPath = rest.slice(protocolEnd + 1);
    const pathStart = hostAndPath.indexOf("/");
    const host = pathStart < 0 ? hostAndPath : hostAndPath.slice(0, pathStart);
    const path = pathStart < 0 ? "/" : hostAndPath.slice(pathStart);
    if (!/^(?:http|https)$/.test(protocol) || !host) throw new ProxyError(400, "同源代理路徑格式錯誤");
    const target = new URL(`${protocol}://${host}${path}`);
    requestUrl.searchParams.forEach((value, key) => { if (key !== "_owo_key") target.searchParams.append(key, value); });
    return target;
}
function BuildSameOriginPath(requestUrl, value, baseUrl) {
    const target = new URL(value, baseUrl);
    const result = new URL(requestUrl.origin);
    result.pathname = `${SameOriginPrefix}${target.protocol.slice(0, -1)}/${target.host}${target.pathname}`;
    result.search = target.search;
    const key = requestUrl.searchParams.get("_owo_key");
    if (key) result.searchParams.set("_owo_key", key);
    result.hash = target.hash;
    return result.toString();
}
function BuildSameOriginCompatibilityAgent(sourceUrl, requestUrl) {
    const config = JSON.stringify({ pageUrl:new URL(sourceUrl).toString(), pageOrigin:new URL(sourceUrl).origin, proxyOrigin:requestUrl.origin, key:requestUrl.searchParams.get("_owo_key")||"" });
    return `(function(C){"use strict";
if(window.__OwOSameOriginCompatibility)return;
var U=window.URL,F=window.fetch&&window.fetch.bind(window),XO=XMLHttpRequest.prototype.open,P=new WeakMap();
function isP(v){try{var u=new U(String(v),C.proxyOrigin);return u.origin===C.proxyOrigin&&u.pathname.indexOf("/__owo_proxy__/")===0;}catch(e){return false;}}
function unP(v){var value=String(v||"");for(var n=0;n<5&&isP(value);n++){try{var u=new U(value,C.proxyOrigin),r=u.pathname.slice(15),i=r.indexOf("/"),scheme=r.slice(0,i),hp=r.slice(i+1),j=hp.indexOf("/"),host=j<0?hp:hp.slice(0,j),path=j<0?"/":hp.slice(j),o=new U(scheme+"://"+host+path);u.searchParams.forEach(function(x,k){if(k!=="_owo_key")o.searchParams.append(k,x);});value=o.href;}catch(e){break;}}return value;}
function abs(v){var t=unP(String(v==null?"":v).trim().replace(/^null(?=\\/)/i,""));try{var u=new U(t,t.charAt(0)==="/"?C.pageOrigin:C.pageUrl),m=u.pathname.match(/\\/null(\\/(?:svc|api|graphql)(?:\\/|$).*)/i);if(m)u.pathname=m[1];return u.href;}catch(e){return null;}}
function px(v){if(isP(v))return new U(String(v),C.proxyOrigin).href;var t=abs(v);if(!t)return v;var u=new U(t),o=new U(C.proxyOrigin);o.pathname="/__owo_proxy__/"+u.protocol.slice(0,-1)+"/"+u.host+u.pathname;o.search=u.search;if(C.key)o.searchParams.set("_owo_key",C.key);o.hash=u.hash;return o.href;}
function map(v){return !!String(v||"")&&!/^(?:data:|blob:|about:|javascript:|mailto:|tel:|#)/i.test(String(v))&&!isP(v);}
var SA=Element.prototype.setAttribute,AC=Node.prototype.appendChild,IB=Node.prototype.insertBefore;
function node(n){if(!(n instanceof Element))return n;["src","href","action","formaction","poster"].forEach(function(a){var v=n.getAttribute(a);if(v&&map(v))SA.call(n,a,px(v));});return n;}
Element.prototype.setAttribute=function(a,v){if(["src","href","action","formaction","poster"].indexOf(String(a).toLowerCase())>=0&&map(v))v=px(v);return SA.call(this,a,v);};Node.prototype.appendChild=function(n){return AC.call(this,node(n));};Node.prototype.insertBefore=function(n,r){return IB.call(this,node(n),r);};
if(F)window.fetch=function(i,n){var v=i instanceof Request?i.url:String(i);if(map(v)){var m=px(v);i=i instanceof Request?new Request(m,i):m;}return F(i,n);};XMLHttpRequest.prototype.open=function(m,u){var a=[].slice.call(arguments);if(map(u))a[1]=px(u);return XO.apply(this,a);};
function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
function run(el,d,target,holder){if(P.has(el))return;target=abs(target);holder=holder||document.createElement("div");holder.className="owob-same-origin-partial";holder.innerHTML='<div class="owob-so-spinner"></div><div>正在載入更多內容…</div>';if(el.isConnected){el.style.setProperty("display","none","important");el.before(holder);}var q=d.request||{},method=String(q.method||el.getAttribute("method")||"GET").toUpperCase();function attempt(i){return wait([0,450,900][i]||0).then(function(){var h=new Headers(q.headers||{}),init={method:method,headers:h,credentials:"include",cache:"no-store"};if(method!=="GET"&&method!=="HEAD"&&q.body!=null)init.body=q.body;return F(px(target),init);}).then(function(r){return r.text().then(function(b){if(!r.ok||!b.trim()||/shreddit-feed-page-error|feed-page-error|partial-error/i.test(b))throw new Error("Partial "+r.status);return b;});}).catch(function(e){if(i<2)return attempt(i+1);throw e;});}var task=attempt(0).then(function(html){var range=document.createRange();range.selectNode(holder);holder.replaceWith(range.createContextualFragment(html));if(el.isConnected)el.remove();}).catch(function(e){holder.innerHTML='<div>載入下一頁時發生錯誤</div><button type="button">重試</button>';holder.querySelector("button").onclick=function(){P.delete(el);run(el,d,target,holder);};console.error("[OwO Same-Origin Partial]",e,target);}).finally(function(){P.delete(el);});P.set(el,task);}
var st=document.createElement("style");st.textContent='.owob-same-origin-partial{min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}.owob-so-spinner{width:42px;height:42px;border:4px solid #ffd8ca;border-top-color:#ff4500;border-radius:50%;animation:os .8s linear infinite}@keyframes os{to{transform:rotate(360deg)}}';(document.head||document.documentElement).appendChild(st);
document.addEventListener("faceplate-request",function(e){var d=e&&e.detail;if(!d||typeof d.resource!=="string")return;var t=abs(d.resource);if(!t)return;d.resource=t;if(/\\/svc\\/shreddit\\/community-more-posts\\//i.test(t)&&e.target&&e.target.tagName==="FACEPLATE-PARTIAL"){e.preventDefault();e.stopImmediatePropagation();run(e.target,d,t);}},true);
function title(){var host=new U(C.pageUrl).hostname.toLowerCase();return /(^|\\.)reddit\\.com$/.test(host)?"Reddit - 網路心之所在":(document.title||host);}
function sync(){parent.postMessage({OwObSameOrigin:true,Type:"State",Title:title(),Url:unP(location.href)},"*");}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sync,{once:true});else sync();window.addEventListener("load",sync,{once:true});
window.__OwOSameOriginCompatibility={version:"2.2.0",absolute:abs,proxy:px,retryPartial:run};
})(${config});`;
}

function RewriteSameOriginHtml(html, sourceUrl, requestUrl) {
    const map = value => /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(value) ? value : BuildSameOriginPath(requestUrl, value, sourceUrl);
    let output = String(html).replace(/\s(src|href|action|formaction|poster)\s*=\s*(["'])(.*?)\2/gi,
        (all, name, quote, value) => ` ${name}=${quote}${map(value)}${quote}`);
    output = output.replace(/\s(srcset)\s*=\s*(["'])(.*?)\2/gi, (all, name, quote, value) => {
        const rewritten = value.split(",").map(item => {
            const part = item.trim();
            const split = part.search(/\s/);
            return split < 0 ? map(part) : map(part.slice(0, split)) + part.slice(split);
        }).join(", ");
        return ` ${name}=${quote}${rewritten}${quote}`;
    });
    const agentUrl=new URL("/__owo_same_origin_agent__.js",requestUrl.origin);agentUrl.searchParams.set("page",new URL(sourceUrl).toString());const agentKey=requestUrl.searchParams.get("_owo_key");if(agentKey)agentUrl.searchParams.set("_owo_key",agentKey);const injected=`<base href="${BuildSameOriginPath(requestUrl,sourceUrl,sourceUrl)}"><script src="${agentUrl.toString()}"></script>`;
    return /<head[^>]*>/i.test(output) ? output.replace(/<head[^>]*>/i, tag => tag + injected) : injected + output;
}

function RewriteSameOriginCss(css, sourceUrl, requestUrl) {
    return String(css).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (all, quote, value) => {
        if (/^(?:data:|blob:|#)/i.test(value)) return all;
        try { return `url("${BuildSameOriginPath(requestUrl, value, sourceUrl)}")`; } catch { return all; }
    });
}

/* ============================================================
 *  8. 主要處理流程
 * ============================================================ */

/** 由前端請求標頭建立 Cookie 罐 */
function BuildRequestJar(request, targetUrl) {
    const rawJar = request.headers.get("X-Proxy-Cookie-Jar");

    if (rawJar) {
        try {
            return CreateCookieJar(JSON.parse(decodeURIComponent(rawJar)));
        } catch {
            /* 格式錯誤時改用舊格式 */
        }
    }

    return CreateCookieJar(ParseLegacyCookie(request.headers.get("X-Proxy-Cookie"), targetUrl.hostname));
}

export default {
    async fetch(request, env) {
        const origin         = request.headers.get("Origin");
        const allowedOrigins = GetAllowedOrigins(env);

        /* ---------- 來源檢查 ---------- */
        const requestOrigin=new URL(request.url).origin;const isWorkerSelfOrigin=origin===requestOrigin;
        if (!isWorkerSelfOrigin && !IsOriginAllowed(origin, allowedOrigins)) {
            return JsonResponse(
                403,
                `來源未被允許：${origin}（請將此來源加入 ALLOWED_ORIGINS）`,
                origin,
                { allowedOrigins }
            );
        }

        /* ---------- 預檢請求 ---------- */
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status:  204,
                headers: BuildCorsHeaders(origin, request.headers.get("Access-Control-Request-Headers"))
            });
        }

        /* ---------- 只接受 GET / HEAD / POST ---------- */
        if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
            return JsonResponse(405, `不支援的方法：${request.method}`, origin);
        }

        const requestUrl=new URL(request.url);
        if(requestUrl.pathname==="/__owo_same_origin_agent__.js"){if(!IsKeyValid(request,requestUrl,GetAccessKey(env)))return new Response("/* key rejected */",{status:401});let page;try{page=new URL(requestUrl.searchParams.get("page"));}catch{return new Response("throw new Error('Invalid agent URL')",{status:400,headers:{"Content-Type":"application/javascript"}});}return new Response(BuildSameOriginCompatibilityAgent(page.toString(),requestUrl),{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-store","X-OwOb-Worker-Version":"9.4.0",...BuildCorsHeaders(origin)}});}

        /* ---------- 存取金鑰檢查（預檢請求不帶金鑰，故放在預檢之後） ---------- */
        if (!IsKeyValid(request, requestUrl, GetAccessKey(env))) {
            return JsonResponse(401, "需要存取金鑰或金鑰錯誤", origin);
        }

        /* ---------- 解析目標網址 ---------- */
        const sameOriginMode = requestUrl.pathname.startsWith(SameOriginPrefix);
        const target = sameOriginMode ? null : requestUrl.searchParams.get("url");

        // 沒帶 url 參數且不是同源路徑 → 健康檢查
        if (!target && !sameOriginMode) {
            return JsonResponse(200, "OwOb Proxy 運作中", origin, {
                version:     "9.4.0",
                usage:       "/?url=<encoded url> 或 /__owo_proxy__/https/example.com/path",
                keyRequired: Boolean(GetAccessKey(env)),
                allowedOrigins,
                time:    new Date().toISOString()
            });
        }

        let targetUrl;
        try {
            targetUrl = sameOriginMode ? ParseSameOriginTarget(requestUrl) : new URL(target);
        } catch (error) {
            return JsonResponse(400, error.message || `網址格式錯誤：${target}`, origin);
        }

        /* ---------- 轉送請求 ---------- */
        try {
            const hasBody = !["GET", "HEAD"].includes(request.method);
            const forwardHeaders = DecodeForwardHeaders(request);

            // 前端主頁面 fetch 的 Accept 為預設「*/*」，此時沿用模擬瀏覽器的 HTML Accept；
            // 圖片等資源請求帶有具體 Accept 時則照實轉送
            const accept = request.headers.get("Accept") || "";

            const result = await FetchWithRedirects(targetUrl, {
                Method:      request.method,
                Body:        hasBody ? await request.arrayBuffer() : null,
                ForwardHeaders: forwardHeaders,
                ContentType: request.headers.get("Content-Type") || "application/x-www-form-urlencoded",
                Jar:         BuildRequestJar(request, targetUrl),
                Referer:     request.headers.get("X-Proxy-Referer") || "",
                Accept:      accept && accept !== "*/*" ? accept : "",
                Range:       request.headers.get("Range") || ""
            });

            const upstream = result.Response;

            // 複製並清理目標網站回應標頭
            const headers = new Headers(upstream.headers);
            StripResponseHeaders.forEach(name => headers.delete(name));

            // 加上 CORS、最終網址與 Cookie
            Object.entries(BuildCorsHeaders(origin)).forEach(([key, value]) => headers.set(key, value));
            headers.set("X-Final-URL",    result.FinalUrl);
            headers.set("X-Proxy-Status", String(upstream.status));
            headers.set("X-OwOb-Worker-Version", "9.4.0");

            if (result.SetCookies.length > 0) {
                headers.set("X-Proxy-Set-Cookie", encodeURIComponent(JSON.stringify(result.SetCookies)));
            }

            let responseBody = request.method === "HEAD" ? null : upstream.body;
            const responseType = String(headers.get("Content-Type") || "").toLowerCase();
            if (sameOriginMode && request.method !== "HEAD" && responseType.includes("text/html")) {
                responseBody = RewriteSameOriginHtml(await upstream.text(), result.FinalUrl, requestUrl);
                headers.delete("Content-Encoding");
                headers.set("Content-Type", "text/html; charset=utf-8");
                headers.set("Cache-Control", "no-store");
            } else if (sameOriginMode && request.method !== "HEAD" && responseType.includes("text/css")) {
                responseBody = RewriteSameOriginCss(await upstream.text(), result.FinalUrl, requestUrl);
                headers.delete("Content-Encoding");
                headers.set("Content-Type", "text/css; charset=utf-8");
            } else if (request.method !== "HEAD" && IsJavaScriptResponse(headers, result.FinalUrl)) {
                const source = await upstream.text();
                responseBody = RewriteJavaScriptResponse(source, result.FinalUrl, requestUrl);
                headers.delete("Content-Encoding");
                headers.set("Content-Type", "application/javascript; charset=utf-8");
                headers.set("Cache-Control", "no-store");
            }

            return new Response(responseBody, {
                status:     upstream.status,
                statusText: upstream.statusText,
                headers
            });
        } catch (error) {
            // 任何例外都回傳帶 CORS 的 JSON，避免前端只看到 Failed to fetch
            const status = error instanceof ProxyError ? error.Status : 502;
            const reason = error && error.message ? error.message : String(error);

            return JsonResponse(
                status,
                status === 502 ? `代理無法連線至目標網站：${reason}` : reason,
                origin,
                { target: targetUrl.toString() }
            );
        }
    }
};