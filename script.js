/* ============================================================
 *  OwO Simple Browser - 主程式 v4
 *
 *  架構：
 *     1. 設定與狀態
 *     2. 工具函式（儲存、提示、網址處理）
 *     3. 偏好設定存取（代理、金鑰、逾時、載入選項）
 *     4. 代理網址工具（主頁面與 iframe 共用的純函式）
 *     5. Cookie 罐
 *     6. 瀏覽紀錄 / 書籤 / 首頁捷徑
 *     7. 共用介面元件（對話框、右鍵選單）
 *     8. 分頁管理（建立 / 切換 / 關閉 / 拖曳排序 / 複製 / 重新開啟）
 *     9. 導覽與工具列
 *    10. 網址列自動完成
 *    11. 內部頁面（start / settings / history / bookmarks / cookies）
 *    12. 外部頁面（經代理載入、CSS 內嵌、資源網址改寫）
 *    13. iframe 代理程式（連結 / 表單 / 資源 / 請求 / 頁內搜尋 / 快捷鍵）
 *    14. iframe 訊息接收
 *    15. 頁內搜尋 / 縮放
 *    16. 主題 / 備份 / 隱藏分頁
 *    17. 快捷鍵、事件綁定與初始化
 * ============================================================ */

"use strict";

/* ============================================================
 *  1. 設定與狀態
 * ============================================================ */

const Config = {
    // 預設代理（自架 Cloudflare Worker）；介面上不顯示，使用者可於設定頁自填覆蓋
    DefaultProxyBase: "https://owob-proxy.kkwan812.workers.dev/?url=",

    // 內建搜尋引擎（固定使用 Bing）
    SearchUrl: "https://www.bing.com/search?q=",

    // 首頁網址
    HomeUrl: "owob://start",

    // 代理請求逾時（秒）：預設值與可設定範圍
    DefaultTimeoutSec: 15,
    MinTimeoutSec:     5,
    MaxTimeoutSec:     120,

    // 各類清單上限
    MaxHistory:     500,
    MaxClosedTabs:  10,
    MaxSuggestions: 8,

    // 縮放級距
    ZoomLevels: [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2],

    // 外部樣式表內嵌：單頁上限、單一樣式表逾時（毫秒）
    MaxInlineStylesheets: 20,
    StylesheetTimeoutMs:  8000,

    // localStorage 鍵名
    StorageKeys: {
        Theme:          "OwOb.Theme",
        ProxyBase:      "OwOb.ProxyBase",
        ProxyKey:       "OwOb.ProxyKey",
        TimeoutSec:     "OwOb.TimeoutSec",
        ProxyResources: "OwOb.ProxyResources",
        ProxyScripts:   "OwOb.ProxyScripts",
        ProxyRequests:  "OwOb.ProxyRequests",
        History:        "OwOb.History",
        Bookmarks:      "OwOb.Bookmarks",
        Shortcuts:      "OwOb.Shortcuts",
        OpenTabs:       "OwOb.OpenTabs",
        ActiveTab:      "OwOb.ActiveTab",
        Cookies:        "OwOb.Cookies"
    },

    // 載入選項（開關）預設值
    DefaultFlags: {
        ProxyResources: true,    // 圖片、影音、字型經代理載入
        ProxyScripts:   false,   // 外部腳本經代理載入（可能使部分網站失效）
        ProxyRequests:  true     // 網頁內 fetch / XHR 經代理送出
    },

    // 預設首頁捷徑（使用者可新增、編輯、刪除、拖曳排序）
    DefaultShortcuts: [
        { Name: "Wikipedia",   Icon: "fa-brands fa-wikipedia-w", Url: "https://zh.wikipedia.org/" },
        { Name: "GitHub",      Icon: "fa-brands fa-github",      Url: "https://github.com/" },
        { Name: "Hacker News", Icon: "fa-brands fa-hacker-news", Url: "https://news.ycombinator.com/" },
        { Name: "Example",     Icon: "fa-solid fa-globe",        Url: "https://example.com/" },
        { Name: "書籤",         Icon: "fa-solid fa-star",         Url: "owob://bookmarks" },
        { Name: "設定",         Icon: "fa-solid fa-gear",         Url: "owob://settings" }
    ]
};

const State = {
    Tabs:       [],      // { Id, History, Index, Title, Loading, Zoom, HasAgent, TabEl, ViewEl, Abort }
    ActiveId:   null,
    NextId:     1,
    ClosedTabs: [],      // 最近關閉的分頁 { History, Index, Zoom }
    DragTabId:  null,    // 拖曳中的分頁
    Suggest:    { Items: [], Index: -1 },
    Find:       { Open: false }
};

// DOM 參照
const Dom = {
    TabList:         document.getElementById("TabList"),
    ViewArea:        document.getElementById("ViewArea"),
    AddTabButton:    document.getElementById("AddTabButton"),
    BackButton:      document.getElementById("BackButton"),
    ForwardButton:   document.getElementById("ForwardButton"),
    ReloadButton:    document.getElementById("ReloadButton"),
    HomeButton:      document.getElementById("HomeButton"),
    ThemeButton:     document.getElementById("ThemeButton"),
    SettingsButton:  document.getElementById("SettingsButton"),
    AddressForm:     document.getElementById("AddressForm"),
    AddressInput:    document.getElementById("AddressInput"),
    AddressIcon:     document.getElementById("AddressIcon"),
    ZoomButton:      document.getElementById("ZoomButton"),
    BookmarkButton:  document.getElementById("BookmarkButton"),
    SuggestList:     document.getElementById("SuggestList"),
    LoadingBar:      document.getElementById("LoadingBar"),
    FindBar:         document.getElementById("FindBar"),
    FindInput:       document.getElementById("FindInput"),
    FindStatus:      document.getElementById("FindStatus"),
    FindPrevButton:  document.getElementById("FindPrevButton"),
    FindNextButton:  document.getElementById("FindNextButton"),
    FindCloseButton: document.getElementById("FindCloseButton"),
    ImportInput:     document.getElementById("ImportInput"),
    Toast:           document.getElementById("Toast")
};

/* ============================================================
 *  2. 工具函式
 * ============================================================ */

/** HTML 跳脫，避免插入頁面時被解析成標籤 */
function EscapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** 解碼 HTML 實體（如 &amp;）；不含「&」時直接回傳以節省效能 */
function DecodeEntities(text) {
    const value = String(text);
    if (!value.includes("&")) return value;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
}

/** 顯示短暫提示 */
let ToastTimer = null;
function ShowToast(message) {
    Dom.Toast.textContent = message;
    Dom.Toast.classList.add("Show");
    clearTimeout(ToastTimer);
    ToastTimer = setTimeout(() => Dom.Toast.classList.remove("Show"), 2600);
}

/** 讀寫 localStorage（JSON） */
function LoadJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function SaveJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* 儲存空間滿或被停用時忽略 */
    }
}

/** 產生短識別碼 */
function CreateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 數值限制在範圍內 */
function Clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/** 取得目前分頁 */
function GetActiveTab() {
    return State.Tabs.find(tab => tab.Id === State.ActiveId) || null;
}

/** 依 Id 取得分頁 */
function GetTabById(id) {
    return State.Tabs.find(tab => tab.Id === id) || null;
}

/** 取得分頁目前網址 */
function GetTabUrl(tab) {
    return tab.History[tab.Index] || Config.HomeUrl;
}

/** 將內部實際網址轉為提供給使用者閱讀的網址 */
function GetDisplayUrl(url) {
    const value = String(url);
    const match = value.match(/^owob:\/\/([^/?#]+)/i);
    if (!match) return value;

    const pageNames = {
        start:     "Start",
        settings:  "Settings",
        history:   "History",
        bookmarks: "Bookmarks",
        cookies:   "Cookies"
    };
    const page = pageNames[match[1].toLowerCase()] || match[1];
    return `Browser://${page}`;
}

/** 將使用者輸入的 Browser:// 內部網址轉回實際路由 */
function NormalizeInternalInput(input) {
    const value = String(input).trim();
    const match = value.match(/^browser:\/\/([^/?#]+)/i);
    return match ? `owob://${match[1].toLowerCase()}` : value;
}

/** 是否為內部網址 */
function IsInternalUrl(url) {
    return String(url).toLowerCase().startsWith("owob://");
}

/** 是否為 http / https 網址 */
function IsWebUrl(url) {
    return /^https?:\/\//i.test(String(url));
}

/** 取得網址主機名稱；失敗回傳空字串 */
function GetHostname(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
}

/** 日期時間格式化 */
function FormatDateTime(time) {
    return new Date(time).toLocaleString("zh-TW", { hour12: false });
}

/** Base64 / Base64URL 解碼為 UTF-8 字串；失敗回傳空字串 */
function DecodeBase64Url(text) {
    try {
        let base64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
        while (base64.length % 4) base64 += "=";
        const binary = atob(base64);
        const bytes  = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch {
        return "";
    }
}

/**
 * 解除搜尋引擎的點擊追蹤轉址，直接取得真正的目的網址
 * 這些追蹤頁多半用 JavaScript（location.replace）跳轉，
 * 在沙箱 iframe 內會繞過代理直接連線，被目的網站拒絕嵌入而顯示破圖。
 *
 *   Bing       https://www.bing.com/ck/a?...&u=a1<Base64URL>
 *   DuckDuckGo https://duckduckgo.com/l/?uddg=<編碼網址>
 *   Google     https://www.google.com/url?q=<編碼網址>
 *   Yahoo      https://r.search.yahoo.com/.../RU=<編碼網址>/RK=...
 *
 * 無法解析時回傳原網址
 */
function UnwrapRedirectUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    let target = "";

    if (/(^|\.)bing\.com$/.test(host) && path.startsWith("/ck/a")) {
        const value = parsed.searchParams.get("u") || "";
        target = value.startsWith("a1") ? DecodeBase64Url(value.slice(2)) : value;
    } else if (/(^|\.)duckduckgo\.com$/.test(host) && path.startsWith("/l/")) {
        target = parsed.searchParams.get("uddg") || "";
    } else if (/(^|\.)google\.[a-z.]+$/.test(host) && path === "/url") {
        target = parsed.searchParams.get("q") || parsed.searchParams.get("url") || "";
    } else if (/(^|\.)search\.yahoo\.com$/.test(host)) {
        const match = path.match(/\/RU=([^/]+)\//);
        if (match) {
            try {
                target = decodeURIComponent(match[1]);
            } catch {
                target = "";
            }
        }
    }

    return IsWebUrl(target) ? target : url;
}


/** 解開 Worker 代理包裝及常見搜尋引擎追蹤網址。 */
function NormalizeNavigatedUrl(url) {
    let value = DecodeEntities(String(url || ""));
    try {
        let parsed = new URL(value);
        const workerOrigin = GetContentWorkerRoot() ? new URL(GetContentWorkerRoot()).origin : "";
        for (let depth = 0; depth < 8 && parsed.origin === workerOrigin && parsed.searchParams.has("url"); depth++) {
            parsed = new URL(DecodeEntities(parsed.searchParams.get("url")));
        }
        value = parsed.toString();
    } catch {}
    return UnwrapRedirectUrl(value);
}
/**
 * 將使用者輸入轉為可導覽的網址
 *   owob://xxx         → 內部頁面
 *   含協定的網址         → 原樣
 *   像網域的字串         → 補上 https://
 *   其他                → 使用 Bing 搜尋
 */
function ResolveInput(input) {
    const text = NormalizeInternalInput(input);

    if (!text) {
        return Config.HomeUrl;
    }
    if (IsInternalUrl(text)) {
        return text.toLowerCase();
    }
    if (IsWebUrl(text)) {
        return text;
    }

    const looksLikeDomain = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text) && !/\s/.test(text);
    if (looksLikeDomain) {
        return "https://" + text;
    }

    return Config.SearchUrl + encodeURIComponent(text);
}

/** 將使用者輸入的捷徑 / 書籤網址整理為可用網址；格式錯誤回傳 null */
function NormalizeUserUrl(input) {
    const text = String(input || "").trim();
    if (!text) return null;
    if (IsInternalUrl(text)) return text.toLowerCase();

    const candidate = IsWebUrl(text) ? text : "https://" + text;
    try {
        return new URL(candidate).toString();
    } catch {
        return null;
    }
}

/* ============================================================
 *  3. 偏好設定存取
 * ============================================================ */

/** 是否使用自訂代理 */
function IsCustomProxy() {
    return Boolean(localStorage.getItem(Config.StorageKeys.ProxyBase));
}

/** 取得目前使用的代理前綴（自訂優先，否則使用預設） */
function GetProxyBase() {
    return localStorage.getItem(Config.StorageKeys.ProxyBase) || Config.DefaultProxyBase;
}

/** 取得代理存取金鑰（未設定為空字串） */
function GetProxyKey() {
    return localStorage.getItem(Config.StorageKeys.ProxyKey) || "";
}

/** 取得代理逾時秒數 */
function GetTimeoutSec() {
    const value = Number(localStorage.getItem(Config.StorageKeys.TimeoutSec));
    return Number.isFinite(value) && value > 0
        ? Clamp(Math.round(value), Config.MinTimeoutSec, Config.MaxTimeoutSec)
        : Config.DefaultTimeoutSec;
}

/** 取得代理逾時毫秒數 */
function GetTimeoutMs() {
    return GetTimeoutSec() * 1000;
}

/** 讀取開關設定（名稱對應 Config.DefaultFlags） */
function GetFlag(name) {
    const raw = localStorage.getItem(Config.StorageKeys[name]);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return Boolean(Config.DefaultFlags[name]);
}

/** 寫入開關設定 */
function SetFlag(name, value) {
    localStorage.setItem(Config.StorageKeys[name], value ? "1" : "0");
}

/**
 * 整理使用者輸入的代理網址
 *   https://xxx.workers.dev/?url=   → 原樣
 *   https://xxx.workers.dev         → 自動補成 https://xxx.workers.dev/?url=
 *   https://xxx/api?x=1             → 補成 https://xxx/api?x=1&url=
 * @returns {string|null} 格式錯誤時回傳 null
 */
function NormalizeProxyBase(input) {
    const text = String(input || "").trim();
    if (!text) return null;

    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        return null;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
    }
    if (text.endsWith("=")) {
        return text;
    }
    if (!parsed.search) {
        return text.replace(/\/+$/, "") + "/?url=";
    }
    return text + "&url=";
}

/* ============================================================
 *  4. 代理網址工具
 *     RewriteSrcset 與 MakeProxyUrl 為「純函式」（不引用外部變數），
 *     除了主頁面使用外，也會以原始碼形式注入 iframe 內共用。
 * ============================================================ */

/**
 * 改寫 srcset 內每個網址（保留 1x / 2x / 300w 等描述）
 * 依 HTML 規格逐字解析，可正確處理網址內含逗號的情況（例如 w_100,h_100）
 */
function RewriteSrcset(value, mapper) {
    var text   = String(value);
    var output = [];
    var index  = 0;

    while (index < text.length) {
        // 略過前置空白與逗號
        while (index < text.length && /[\s,]/.test(text.charAt(index))) index++;
        if (index >= text.length) break;

        // 讀取網址（到空白為止）
        var end = index;
        while (end < text.length && !/\s/.test(text.charAt(end))) end++;

        var url        = text.slice(index, end);
        var descriptor = "";

        if (/,$/.test(url)) {
            // 網址後緊接逗號：沒有描述
            url   = url.replace(/,+$/, "");
            index = end;
        } else {
            // 讀取描述（到逗號為止）
            var next = end;
            while (next < text.length && text.charAt(next) !== ",") next++;
            descriptor = text.slice(end, next).trim();
            index      = next + 1;
        }

        output.push(mapper(url) + (descriptor ? " " + descriptor : ""));
    }

    return output.join(", ");
}

/** 組合代理網址（有金鑰時以 key 參數附上，讓 <img> 等無法帶標頭的請求也能通過驗證） */
function MakeProxyUrl(base, key, url) {
    return base + encodeURIComponent(url) + (key ? "&key=" + encodeURIComponent(key) : "");
}

/** 組合目前設定下的代理網址 */
function BuildProxyUrl(url) {
    return MakeProxyUrl(GetProxyBase(), GetProxyKey(), url);
}

/** 取得 Origin Mode Worker 根網址，兼容舊版儲存的 ?url= 代理格式。 */
function GetContentWorkerRoot() {
    try {
        const parsed = new URL(GetProxyBase());
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString().replace(/\/$/, "");
    } catch {
        return "";
    }
}

/** 組合 Origin Mode 內容頁網址。 */
function BuildContentPageUrl(url, tabId) {
    const root = GetContentWorkerRoot();
    const target = new URL(root + "/browse");
    target.searchParams.set("mode", "page");
    target.searchParams.set("url", url);
    target.searchParams.set("tab", String(tabId));
    const key = GetProxyKey();
    if (key) target.searchParams.set("key", key);
    return target.toString();
}

/** 取得代理伺服器來源（協定 + 主機） */
function GetProxyOrigin() {
    try {
        return new URL(GetProxyBase()).origin;
    } catch {
        return "";
    }
}

/** 絕對網址是否需要經代理（http / https，且不是代理本身） */
function ShouldProxyUrl(absoluteUrl) {
    if (!IsWebUrl(absoluteUrl)) return false;
    const proxyOrigin = GetProxyOrigin();
    return !proxyOrigin || !absoluteUrl.startsWith(proxyOrigin + "/");
}

/** 將頁面中的資源網址（可能為相對路徑）轉為代理網址；不需轉換時回傳原值 */
function MapResourceUrl(value, baseUrl) {
    const text = String(value).trim();
    if (!text || /^(data:|blob:|about:|javascript:|#)/i.test(text)) {
        return value;
    }

    let absolute;
    try {
        absolute = new URL(text, baseUrl).toString();
    } catch {
        return value;
    }

    return ShouldProxyUrl(absolute) ? BuildProxyUrl(absolute) : value;
}

/** 產生可安全嵌入 <script> 的 JSON */
function SafeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/* ============================================================
 *  5. Cookie 罐
 *     代理會移除 Set-Cookie，改以 X-Proxy-Set-Cookie 回傳。
 *     這裡把 Cookie 存進 localStorage，下次請求同站時
 *     以 X-Proxy-Cookie-Jar 送回代理，讓驗證 / 登入狀態可延續。
 *
 *     結構：{ "<網域>": { "<名稱>": { Value, Expires, HostOnly } } }
 *     （簡化實作：不比對 Path，同網域 Cookie 一律送出）
 * ============================================================ */

/** 讀取 Cookie 罐，並順便清除已過期項目 */
function LoadCookieJar() {
    const jar = LoadJson(Config.StorageKeys.Cookies, {});
    const now = Date.now();

    Object.keys(jar).forEach(domain => {
        Object.keys(jar[domain]).forEach(name => {
            const expires = jar[domain][name].Expires;
            if (expires !== null && expires <= now) {
                delete jar[domain][name];
            }
        });
        if (Object.keys(jar[domain]).length === 0) {
            delete jar[domain];
        }
    });

    return jar;
}

/**
 * 解析一筆 Set-Cookie 並寫入 Cookie 罐
 * @param {object} jar     Cookie 罐
 * @param {string} host    設定此 Cookie 的主機
 * @param {string} cookie  Set-Cookie 原始字串
 */
function ApplySetCookie(jar, host, cookie) {
    const parts = String(cookie).split(";");
    const pair  = parts.shift();
    const index = pair.indexOf("=");
    if (index <= 0) return;

    const name  = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();

    let domain   = host.toLowerCase();
    let hostOnly = true;
    let expires  = null;      // null = 工作階段 Cookie
    let rejected = false;

    parts.forEach(part => {
        const [rawKey, ...rest] = part.split("=");
        const key = rawKey.trim().toLowerCase();
        const val = rest.join("=").trim();

        if (key === "domain" && val) {
            const cleaned = val.replace(/^\./, "").toLowerCase();
            // 只接受主機本身或其上層網域；不符合時整筆捨棄，避免跨站寫入
            if (domain === cleaned || domain.endsWith("." + cleaned)) {
                domain   = cleaned;
                hostOnly = false;
            } else {
                rejected = true;
            }
        } else if (key === "max-age" && val) {
            expires = Date.now() + Number(val) * 1000;
        } else if (key === "expires" && val && expires === null) {
            const time = Date.parse(val);
            if (!Number.isNaN(time)) expires = time;
        }
    });

    if (rejected) return;

    jar[domain] = jar[domain] || {};
    if (expires !== null && expires <= Date.now()) {
        delete jar[domain][name];       // 目標網站要求刪除
    } else {
        jar[domain][name] = { Value: value, Expires: expires, HostOnly: hostOnly };
    }
}

/** 儲存代理回傳的 Cookie（X-Proxy-Set-Cookie） */
function StoreProxyCookies(headerValue) {
    if (!headerValue) return;

    let list;
    try {
        list = JSON.parse(decodeURIComponent(headerValue));
    } catch {
        return;
    }
    if (!Array.isArray(list)) return;

    const jar = LoadCookieJar();
    list.forEach(item => {
        if (item && typeof item.Host === "string" && typeof item.Cookie === "string") {
            ApplySetCookie(jar, item.Host, item.Cookie);
        }
    });
    SaveJson(Config.StorageKeys.Cookies, jar);
}

/**
 * 取得網站主網域（簡化版）
 *   tw.search.yahoo.com → yahoo.com
 *   www.ptt.cc          → ptt.cc
 *   news.yahoo.com.tw   → yahoo.com.tw（第二層為 com / net / org 等的國碼網域）
 */
function GetSiteDomain(host) {
    const labels = host.toLowerCase().split(".");
    if (labels.length <= 2) {
        return labels.join(".");
    }

    const secondLevel = labels[labels.length - 2];
    const topLevel    = labels[labels.length - 1];
    const isCcSecond  = topLevel.length === 2 && ["com", "net", "org", "edu", "gov", "co", "ac", "or", "ne", "idv"].includes(secondLevel);

    return labels.slice(isCcSecond ? -3 : -2).join(".");
}

/**
 * 取得同站 Cookie 罐（傳給代理）
 * 轉址可能跨子網域（例如 tw.search.yahoo.com → guce.yahoo.com），
 * 因此把同一主網域下的 Cookie 全部交給代理，由代理依每一跳的主機挑選
 */
function GetSiteCookieJar(url) {
    let site;
    try {
        site = GetSiteDomain(new URL(url).hostname);
    } catch {
        return [];
    }

    const jar     = LoadCookieJar();
    const entries = [];

    Object.keys(jar).forEach(domain => {
        if (domain !== site && !domain.endsWith("." + site)) return;
        Object.entries(jar[domain]).forEach(([name, item]) => {
            entries.push({ Domain: domain, Name: name, Value: item.Value, HostOnly: item.HostOnly });
        });
    });

    return entries;
}

/** 計算目前 Cookie 總數 */
function CountCookies() {
    const jar = LoadCookieJar();
    return Object.values(jar).reduce((sum, items) => sum + Object.keys(items).length, 0);
}

/** 刪除指定網域（或其中單一 Cookie） */
function DeleteCookie(domain, name = null) {
    const jar = LoadCookieJar();
    if (!jar[domain]) return;

    if (name === null) {
        delete jar[domain];
    } else {
        delete jar[domain][name];
        if (Object.keys(jar[domain]).length === 0) delete jar[domain];
    }
    SaveJson(Config.StorageKeys.Cookies, jar);
}

/* ============================================================
 *  6. 瀏覽紀錄 / 書籤 / 首頁捷徑
 * ============================================================ */

/* ---------- 瀏覽紀錄 ----------
 * 結構：[{ Id, Url, Title, Time }]（新到舊）
 */

/** 讀取瀏覽紀錄（舊版紀錄沒有 Id 時自動補上） */
function LoadHistory() {
    const records = LoadJson(Config.StorageKeys.History, []);
    if (!Array.isArray(records)) return [];

    let patched = false;
    records.forEach(record => {
        if (!record.Id) {
            record.Id = CreateId();
            patched   = true;
        }
    });
    if (patched) SaveJson(Config.StorageKeys.History, records);

    return records;
}

/** 新增瀏覽紀錄；與最新一筆相同時不重複新增（重新整理 / 上下頁） */
function AddHistoryRecord(url) {
    const records = LoadHistory();
    if (records[0] && records[0].Url === url) {
        records[0].Time = Date.now();
    } else {
        records.unshift({ Id: CreateId(), Url: url, Title: "", Time: Date.now() });
    }
    SaveJson(Config.StorageKeys.History, records.slice(0, Config.MaxHistory));
}

/** 轉址後把最新一筆紀錄的網址改為最終網址 */
function ReplaceHistoryUrl(oldUrl, newUrl) {
    const records = LoadHistory();
    const record  = records.find(item => item.Url === oldUrl);
    if (!record) return;

    record.Url = newUrl;
    // 轉址後若與下一筆相同，合併為一筆
    const index = records.indexOf(record);
    if (records[index + 1] && records[index + 1].Url === newUrl) {
        records.splice(index + 1, 1);
    }
    SaveJson(Config.StorageKeys.History, records);
}

/** 載入完成後補上標題 */
function UpdateHistoryTitle(url, title) {
    const records = LoadHistory();
    const record  = records.find(item => item.Url === url);
    if (record && title && record.Title !== title) {
        record.Title = title;
        SaveJson(Config.StorageKeys.History, records);
    }
}

/** 刪除單筆瀏覽紀錄 */
function DeleteHistoryRecord(id) {
    SaveJson(Config.StorageKeys.History, LoadHistory().filter(item => item.Id !== id));
}

/* ---------- 書籤 ----------
 * 結構：[{ Id, Url, Title, Time }]（新到舊）
 */

function LoadBookmarks() {
    const list = LoadJson(Config.StorageKeys.Bookmarks, []);
    return Array.isArray(list) ? list : [];
}

function SaveBookmarks(list) {
    SaveJson(Config.StorageKeys.Bookmarks, list);
}

function FindBookmark(url) {
    return LoadBookmarks().find(item => item.Url === url) || null;
}

/** 切換目前分頁的書籤狀態 */
function ToggleBookmark(tab = GetActiveTab()) {
    if (!tab) return;
    const url = GetTabUrl(tab);

    if (IsInternalUrl(url)) {
        ShowToast("內部頁面無法加入書籤");
        return;
    }

    const list   = LoadBookmarks();
    const exists = list.findIndex(item => item.Url === url);

    if (exists !== -1) {
        list.splice(exists, 1);
        ShowToast("已移除書籤");
    } else {
        list.unshift({ Id: CreateId(), Url: url, Title: tab.Title || GetHostname(url), Time: Date.now() });
        ShowToast("已加入書籤");
    }

    SaveBookmarks(list);
    RefreshToolbar();
}

/** 刪除書籤 */
function DeleteBookmark(id) {
    SaveBookmarks(LoadBookmarks().filter(item => item.Id !== id));
    RefreshToolbar();
}

/* ---------- 首頁捷徑 ----------
 * 結構：[{ Name, Url, Icon? }]
 */

function LoadShortcuts() {
    const list = LoadJson(Config.StorageKeys.Shortcuts, null);
    return Array.isArray(list) ? list : Config.DefaultShortcuts.map(item => ({ ...item }));
}

function SaveShortcuts(list) {
    SaveJson(Config.StorageKeys.Shortcuts, list);
}

/** 以對話框新增或編輯捷徑；index 為 -1 時表示新增 */
async function EditShortcut(index = -1, preset = null) {
    const list    = LoadShortcuts();
    const current = index >= 0 ? list[index] : (preset || { Name: "", Url: "" });

    const values = await ShowDialog({
        Title:       index >= 0 ? "編輯捷徑" : "新增捷徑",
        ConfirmText: "儲存",
        Fields: [
            { Name: "Name", Label: "名稱", Value: current.Name, Placeholder: "例如：維基百科" },
            { Name: "Url",  Label: "網址", Value: current.Url,  Placeholder: "https://example.com/" }
        ]
    });
    if (!values) return false;

    const url  = NormalizeUserUrl(values.Url);
    const name = values.Name.trim() || (url ? GetHostname(url) : "");

    if (!url) {
        ShowToast("網址格式錯誤");
        return false;
    }

    const item = { Name: name || url, Url: url };
    // 網址沒變時保留原本的圖示
    if (index >= 0 && current.Icon && current.Url === url) {
        item.Icon = current.Icon;
    }

    if (index >= 0) {
        list[index] = item;
    } else {
        list.push(item);
    }

    SaveShortcuts(list);
    ShowToast(index >= 0 ? "已更新捷徑" : "已新增捷徑");
    return true;
}

/** 刪除捷徑 */
function DeleteShortcut(index) {
    const list = LoadShortcuts();
    list.splice(index, 1);
    SaveShortcuts(list);
    ShowToast("已刪除捷徑");
}

/** 移動捷徑位置 */
function MoveShortcut(from, to) {
    const list = LoadShortcuts();
    if (from === to || !list[from]) return;

    const [item] = list.splice(from, 1);
    list.splice(Clamp(to, 0, list.length), 0, item);
    SaveShortcuts(list);
}

/* ============================================================
 *  7. 共用介面元件
 * ============================================================ */

/* ---------- 對話框 ---------- */

/**
 * 顯示輸入對話框
 * @param {{ Title: string, Fields: Array<{Name, Label, Value, Placeholder, Type}>, ConfirmText?: string }} options
 * @returns {Promise<object|null>} 確定時回傳 { 欄位名稱: 值 }，取消回傳 null
 */
function ShowDialog({ Title, Fields, ConfirmText = "確定" }) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "DialogOverlay";

        const fieldsHtml = Fields.map(field => `
            <label class="DialogField">
                <span>${EscapeHtml(field.Label)}</span>
                <input class="SettingInput" name="${EscapeHtml(field.Name)}"
                       type="${EscapeHtml(field.Type || "text")}" spellcheck="false"
                       placeholder="${EscapeHtml(field.Placeholder || "")}"
                       value="${EscapeHtml(field.Value || "")}">
            </label>`).join("");

        overlay.innerHTML = `
            <form class="Dialog" autocomplete="off">
                <h3>${EscapeHtml(Title)}</h3>
                ${fieldsHtml}
                <div class="ButtonRow DialogButtons">
                    <button type="button" class="ActionButton Secondary" data-role="cancel">取消</button>
                    <button type="submit" class="ActionButton">${EscapeHtml(ConfirmText)}</button>
                </div>
            </form>
        `;

        const form = overlay.querySelector("form");

        const close = result => {
            overlay.remove();
            document.removeEventListener("keydown", onKey, true);
            resolve(result);
        };

        const onKey = event => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close(null);
            }
        };

        form.addEventListener("submit", event => {
            event.preventDefault();
            const result = {};
            Fields.forEach(field => {
                result[field.Name] = form.elements[field.Name].value;
            });
            close(result);
        });

        overlay.querySelector('[data-role="cancel"]').addEventListener("click", () => close(null));
        overlay.addEventListener("mousedown", event => {
            if (event.target === overlay) close(null);
        });
        document.addEventListener("keydown", onKey, true);

        document.body.appendChild(overlay);
        const firstInput = form.querySelector("input");
        if (firstInput) {
            firstInput.focus();
            firstInput.select();
        }
    });
}

/* ---------- 右鍵選單 ---------- */

let ActiveContextMenu = null;

/**
 * 顯示右鍵選單
 * @param {number} x
 * @param {number} y
 * @param {Array<"-"|{Label, Icon, Hint, Disabled, Action}>} items  "-" 代表分隔線
 */
function ShowContextMenu(x, y, items) {
    HideContextMenu();

    const menu = document.createElement("div");
    menu.className = "ContextMenu";

    items.forEach(item => {
        if (item === "-") {
            const separator = document.createElement("div");
            separator.className = "MenuSeparator";
            menu.appendChild(separator);
            return;
        }

        const button = document.createElement("button");
        button.type      = "button";
        button.className = "MenuItem";
        button.disabled  = Boolean(item.Disabled);
        button.innerHTML = `
            <i class="${EscapeHtml(item.Icon || "fa-solid fa-circle-dot")}"></i>
            <span class="MenuLabel">${EscapeHtml(item.Label)}</span>
            ${item.Hint ? `<span class="MenuHint">${EscapeHtml(item.Hint)}</span>` : ""}
        `;
        button.addEventListener("click", () => {
            HideContextMenu();
            item.Action();
        });
        menu.appendChild(button);
    });

    document.body.appendChild(menu);

    // 避免超出視窗
    const rect = menu.getBoundingClientRect();
    menu.style.left = Clamp(x, 4, window.innerWidth  - rect.width  - 4) + "px";
    menu.style.top  = Clamp(y, 4, window.innerHeight - rect.height - 4) + "px";

    ActiveContextMenu = menu;
}

function HideContextMenu() {
    if (ActiveContextMenu) {
        ActiveContextMenu.remove();
        ActiveContextMenu = null;
    }
}

/* ============================================================
 *  8. 分頁管理
 * ============================================================ */

/**
 * 建立新分頁
 * @param {string|null} url       要開啟的網址（options.History 存在時忽略）
 * @param {boolean}     activate  是否切換到此分頁
 * @param {{ History?: string[], Index?: number, Zoom?: number, AfterId?: number }} options
 *        History / Index：還原完整上下頁紀錄（複製分頁、重新開啟已關閉分頁）
 *        AfterId        ：插入在指定分頁右側
 */
function CreateTab(url = Config.HomeUrl, activate = true, options = {}) {
    const id = State.NextId++;

    // 分頁按鈕
    const tabEl = document.createElement("div");
    tabEl.className  = "Tab";
    tabEl.dataset.id = id;
    tabEl.draggable  = true;
    tabEl.innerHTML  = `
        <span class="TabTitle">新分頁</span>
        <button class="TabClose" title="關閉分頁 (Alt+W)"><i class="fa-solid fa-xmark"></i></button>
    `;

    // 內容容器
    const viewEl = document.createElement("section");
    viewEl.className = "TabView";

    const tab = {
        Id:       id,
        History:  [],
        Index:    -1,
        Title:    "新分頁",
        Loading:  false,
        Zoom:     options.Zoom || 1,
        HasAgent: false,
        TabEl:    tabEl,
        ViewEl:   viewEl,
        Abort:    null
    };

    BindTabEvents(tab);

    // 插入位置
    const afterTab = options.AfterId ? GetTabById(options.AfterId) : null;
    if (afterTab) {
        afterTab.TabEl.after(tabEl);
        State.Tabs.splice(State.Tabs.indexOf(afterTab) + 1, 0, tab);
    } else {
        Dom.TabList.appendChild(tabEl);
        State.Tabs.push(tab);
    }
    Dom.ViewArea.appendChild(viewEl);

    if (activate) {
        ActivateTab(id);
    }

    if (Array.isArray(options.History) && options.History.length > 0) {
        tab.History = [...options.History];
        tab.Index   = Clamp(options.Index ?? tab.History.length - 1, 0, tab.History.length - 1);
        Navigate(tab, GetTabUrl(tab), false);
    } else {
        Navigate(tab, url || Config.HomeUrl);
    }

    tabEl.scrollIntoView({ inline: "nearest" });
    return tab;
}

/** 綁定分頁按鈕事件（切換、關閉、右鍵選單、拖曳排序） */
function BindTabEvents(tab) {
    const tabEl = tab.TabEl;

    tabEl.addEventListener("click", () => ActivateTab(tab.Id));
    tabEl.addEventListener("auxclick", event => {
        if (event.button === 1) CloseTab(tab.Id);   // 滑鼠中鍵關閉
    });
    tabEl.querySelector(".TabClose").addEventListener("click", event => {
        event.stopPropagation();
        CloseTab(tab.Id);
    });
    tabEl.addEventListener("contextmenu", event => {
        event.preventDefault();
        ShowTabMenu(tab, event.clientX, event.clientY);
    });

    /* ---------- 拖曳排序 ---------- */
    tabEl.addEventListener("dragstart", event => {
        State.DragTabId = tab.Id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", GetTabUrl(tab));
        tabEl.classList.add("Dragging");
    });

    tabEl.addEventListener("dragend", () => {
        State.DragTabId = null;
        document.querySelectorAll(".Tab").forEach(el => el.classList.remove("Dragging", "DropBefore", "DropAfter"));
    });

    tabEl.addEventListener("dragover", event => {
        if (!State.DragTabId || State.DragTabId === tab.Id) return;
        event.preventDefault();
        const rect  = tabEl.getBoundingClientRect();
        const after = event.clientX > rect.left + rect.width / 2;
        tabEl.classList.toggle("DropAfter",  after);
        tabEl.classList.toggle("DropBefore", !after);
    });

    tabEl.addEventListener("dragleave", () => {
        tabEl.classList.remove("DropBefore", "DropAfter");
    });

    tabEl.addEventListener("drop", event => {
        if (!State.DragTabId || State.DragTabId === tab.Id) return;
        event.preventDefault();
        const after = tabEl.classList.contains("DropAfter");
        tabEl.classList.remove("DropBefore", "DropAfter");
        MoveTab(State.DragTabId, tab.Id, after);
    });
}

/** 分頁右鍵選單 */
function ShowTabMenu(tab, x, y) {
    const index = State.Tabs.indexOf(tab);

    ShowContextMenu(x, y, [
        { Label: "新增分頁",           Icon: "fa-solid fa-plus",              Hint: "Alt+T",       Action: () => CreateTab() },
        { Label: "重新整理",           Icon: "fa-solid fa-rotate-right",      Hint: "F5",          Action: () => Navigate(tab, GetTabUrl(tab), false) },
        { Label: "複製分頁",           Icon: "fa-regular fa-clone",                                 Action: () => DuplicateTab(tab) },
        "-",
        { Label: "關閉分頁",           Icon: "fa-solid fa-xmark",             Hint: "Alt+W",       Action: () => CloseTab(tab.Id) },
        { Label: "關閉其他分頁",       Icon: "fa-solid fa-square-xmark",      Disabled: State.Tabs.length <= 1,
          Action: () => State.Tabs.filter(item => item !== tab).forEach(item => CloseTab(item.Id)) },
        { Label: "關閉右側分頁",       Icon: "fa-solid fa-angles-right",      Disabled: index >= State.Tabs.length - 1,
          Action: () => State.Tabs.slice(index + 1).forEach(item => CloseTab(item.Id)) },
        "-",
        { Label: "重新開啟已關閉的分頁", Icon: "fa-solid fa-clock-rotate-left", Hint: "Alt+Shift+T", Disabled: State.ClosedTabs.length === 0,
          Action: ReopenClosedTab }
    ]);
}

/** 移動分頁位置 */
function MoveTab(dragId, targetId, after) {
    const dragTab   = GetTabById(dragId);
    const targetTab = GetTabById(targetId);
    if (!dragTab || !targetTab) return;

    State.Tabs.splice(State.Tabs.indexOf(dragTab), 1);
    const targetIndex = State.Tabs.indexOf(targetTab);
    State.Tabs.splice(targetIndex + (after ? 1 : 0), 0, dragTab);

    // 依新順序重新排列 DOM（appendChild 會移動既有節點）
    State.Tabs.forEach(item => Dom.TabList.appendChild(item.TabEl));
    SaveOpenTabs();
}

/** 複製分頁（含上下頁紀錄與縮放） */
function DuplicateTab(tab) {
    CreateTab(null, true, {
        History: tab.History,
        Index:   tab.Index,
        Zoom:    tab.Zoom,
        AfterId: tab.Id
    });
}

/** 切換分頁 */
function ActivateTab(id) {
    State.ActiveId = id;

    State.Tabs.forEach(tab => {
        const isActive = tab.Id === id;
        tab.TabEl.classList.toggle("Active", isActive);
        tab.ViewEl.classList.toggle("Active", isActive);
    });

    HideSuggestions();
    ResetFindStatus();
    RefreshToolbar();
    SaveOpenTabs();
}

/** 關閉分頁（記錄到「最近關閉」以便重新開啟） */
function CloseTab(id) {
    const index = State.Tabs.findIndex(tab => tab.Id === id);
    if (index === -1) return;

    const tab = State.Tabs[index];
    if (tab.Abort) tab.Abort.abort();

    if (tab.History.length > 0) {
        State.ClosedTabs.push({ History: [...tab.History], Index: tab.Index, Zoom: tab.Zoom });
        State.ClosedTabs = State.ClosedTabs.slice(-Config.MaxClosedTabs);
    }

    tab.TabEl.remove();
    tab.ViewEl.remove();
    State.Tabs.splice(index, 1);

    // 最後一個分頁被關閉時，自動開一個新分頁
    if (State.Tabs.length === 0) {
        CreateTab();
        return;
    }

    if (State.ActiveId === id) {
        const next = State.Tabs[index] || State.Tabs[index - 1];
        ActivateTab(next.Id);
    }

    SaveOpenTabs();
}

/** 重新開啟最近關閉的分頁 */
function ReopenClosedTab() {
    const item = State.ClosedTabs.pop();
    if (!item) {
        ShowToast("沒有最近關閉的分頁");
        return;
    }
    CreateTab(null, true, item);
}

/** 更新分頁標題與載入狀態 */
function UpdateTabHeader(tab) {
    const titleEl = tab.TabEl.querySelector(".TabTitle");
    titleEl.textContent = tab.Title || "未命名";
    tab.TabEl.title = tab.Title;

    const existingSpinner = tab.TabEl.querySelector(".TabSpinner");
    if (tab.Loading && !existingSpinner) {
        const spinner = document.createElement("span");
        spinner.className = "TabSpinner";
        tab.TabEl.insertBefore(spinner, titleEl);
    } else if (!tab.Loading && existingSpinner) {
        existingSpinner.remove();
    }
}

/** 儲存開啟中的分頁，下次開啟時還原 */
function SaveOpenTabs() {
    SaveJson(Config.StorageKeys.OpenTabs, State.Tabs.map(GetTabUrl));
    const activeIndex = State.Tabs.findIndex(tab => tab.Id === State.ActiveId);
    localStorage.setItem(Config.StorageKeys.ActiveTab, String(Math.max(activeIndex, 0)));
}

/** 還原上次的分頁 */
function RestoreTabs() {
    const urls = LoadJson(Config.StorageKeys.OpenTabs, []);

    if (!Array.isArray(urls) || urls.length === 0) {
        CreateTab();
        return;
    }

    urls.forEach(url => CreateTab(url, false));

    const activeIndex = Number(localStorage.getItem(Config.StorageKeys.ActiveTab)) || 0;
    const target = State.Tabs[activeIndex] || State.Tabs[0];
    ActivateTab(target.Id);
}

/** 設定分頁內容；hasFrame 為 true 時內容區不捲動（交由 iframe 自行捲動） */
function SetTabContent(tab, content, hasFrame = false) {
    tab.ViewEl.innerHTML = "";
    if (typeof content === "string") {
        tab.ViewEl.innerHTML = content;
    } else {
        tab.ViewEl.appendChild(content);
    }
    tab.ViewEl.classList.toggle("HasFrame", hasFrame);
    if (!hasFrame) tab.HasAgent = false;
}

/* ============================================================
 *  9. 導覽與工具列
 * ============================================================ */

/**
 * 導覽至指定網址
 * @param {object}       tab       目標分頁
 * @param {string}       url       已解析的網址
 * @param {boolean}      pushState 是否寫入分頁歷史（上下頁時為 false）
 * @param {object|null}  postData  POST 表單資料 { Body, Referer }；GET 時為 null
 */
function Navigate(tab, url, pushState = true, postData = null) {
    // 搜尋結果的追蹤轉址 → 直接換成目的網址（POST 不處理）
    if (!postData && !IsInternalUrl(url)) {
        url = UnwrapRedirectUrl(url);
    }

    if (pushState) {
        tab.History = tab.History.slice(0, tab.Index + 1);
        tab.History.push(url);
        tab.Index = tab.History.length - 1;
    }

    if (tab.Abort) {
        tab.Abort.abort();
        tab.Abort = null;
    }

    if (tab.Id === State.ActiveId) {
        ResetFindStatus();
    }

    if (IsInternalUrl(url)) {
        RenderInternalPage(tab, url);
    } else {
        AddHistoryRecord(url);
        LoadExternalPage(tab, url, postData);
    }

    RefreshToolbar();
    SaveOpenTabs();
}

/** 從網址列或首頁搜尋框導覽 */
function NavigateFromInput(input) {
    const tab = GetActiveTab();
    if (!tab) return;
    Navigate(tab, ResolveInput(input));
}

function GoBack() {
    const tab = GetActiveTab();
    if (!tab || tab.Index <= 0) return;
    tab.Index--;
    Navigate(tab, GetTabUrl(tab), false);
}

function GoForward() {
    const tab = GetActiveTab();
    if (!tab || tab.Index >= tab.History.length - 1) return;
    tab.Index++;
    Navigate(tab, GetTabUrl(tab), false);
}

function Reload() {
    const tab = GetActiveTab();
    if (!tab) return;
    // 重新整理一律以 GET 重新載入（不重送 POST 表單）
    Navigate(tab, GetTabUrl(tab), false);
}

/** 依目前分頁狀態更新工具列 */
function RefreshToolbar() {
    const tab = GetActiveTab();
    if (!tab) return;

    const url        = GetTabUrl(tab);
    const isInternal = IsInternalUrl(url);

    // 使用者正在輸入時不覆蓋網址列
    if (document.activeElement !== Dom.AddressInput) {
        Dom.AddressInput.value = url === Config.HomeUrl ? "" : GetDisplayUrl(url);
    }

    Dom.BackButton.disabled    = tab.Index <= 0;
    Dom.ForwardButton.disabled = tab.Index >= tab.History.length - 1;

    // 網址列圖示
    Dom.AddressIcon.className = "AddressIcon fa-solid " + (
        isInternal               ? "fa-house"           :
        url.startsWith("https:") ? "fa-lock Secure"     :
        url.startsWith("http:")  ? "fa-lock-open"       :
                                   "fa-magnifying-glass"
    );

    // 書籤星號
    const bookmarked = !isInternal && Boolean(FindBookmark(url));
    Dom.BookmarkButton.hidden    = isInternal;
    Dom.BookmarkButton.innerHTML = `<i class="${bookmarked ? "fa-solid" : "fa-regular"} fa-star"></i>`;
    Dom.BookmarkButton.classList.toggle("Marked", bookmarked);
    Dom.BookmarkButton.title     = bookmarked ? "移除書籤 (Ctrl+D)" : "加入書籤 (Ctrl+D)";

    // 縮放指示（100% 時隱藏）
    const zoomPercent = Math.round(tab.Zoom * 100);
    Dom.ZoomButton.hidden      = isInternal || zoomPercent === 100;
    Dom.ZoomButton.textContent = zoomPercent + "%";

    // 載入進度條
    Dom.LoadingBar.className = "LoadingBar" + (tab.Loading ? " Running" : "");
}

/** 設定分頁載入狀態 */
function SetLoading(tab, loading) {
    tab.Loading = loading;
    UpdateTabHeader(tab);

    if (tab.Id === State.ActiveId) {
        if (loading) {
            Dom.LoadingBar.className = "LoadingBar";
            void Dom.LoadingBar.offsetWidth;          // 強制重排，重新觸發動畫
            Dom.LoadingBar.className = "LoadingBar Running";
        } else {
            Dom.LoadingBar.className = "LoadingBar Done";
        }
    }
}

/* ============================================================
 * 10. 網址列自動完成
 *     來源：書籤 + 瀏覽紀錄；依「書籤優先 → 網址開頭符合 → 造訪次數 → 最近時間」排序
 * ============================================================ */

/** 去除協定與 www.，方便比對開頭 */
function StripUrlPrefix(url) {
    return String(url).replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();
}

/** 依輸入內容取得建議清單 */
function GetSuggestions(query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const map = new Map();   // Url → { Url, Title, Bookmark, Count, Time }

    const add = (url, title, time, isBookmark) => {
        const item = map.get(url) || { Url: url, Title: "", Bookmark: false, Count: 0, Time: 0 };
        item.Title    = item.Title || title || "";
        item.Bookmark = item.Bookmark || isBookmark;
        item.Count   += isBookmark ? 0 : 1;
        item.Time     = Math.max(item.Time, time || 0);
        map.set(url, item);
    };

    LoadBookmarks().forEach(item => add(item.Url, item.Title, item.Time, true));
    LoadHistory().forEach(item => add(item.Url, item.Title, item.Time, false));

    return [...map.values()]
        .filter(item =>
            // 不建議 Bing 搜尋結果頁，避免清單被搜尋紀錄塞滿
            !item.Url.startsWith(Config.SearchUrl) &&
            (item.Url.toLowerCase().includes(needle) || item.Title.toLowerCase().includes(needle))
        )
        .map(item => ({
            ...item,
            Score: (item.Bookmark ? 1000 : 0) +
                   (StripUrlPrefix(item.Url).startsWith(needle) ? 500 : 0) +
                   Math.min(item.Count, 50) * 5
        }))
        .sort((a, b) => b.Score - a.Score || b.Time - a.Time)
        .slice(0, Config.MaxSuggestions);
}

/** 依輸入更新建議清單 */
function UpdateSuggestions() {
    State.Suggest.Items = GetSuggestions(Dom.AddressInput.value);
    State.Suggest.Index = -1;
    RenderSuggestions();
}

function RenderSuggestions() {
    const items = State.Suggest.Items;

    if (items.length === 0) {
        HideSuggestions();
        return;
    }

    Dom.SuggestList.innerHTML = items.map((item, index) => `
        <li class="SuggestItem${index === State.Suggest.Index ? " Selected" : ""}" data-index="${index}">
            <i class="${item.Bookmark ? "fa-solid fa-star" : "fa-solid fa-clock-rotate-left"}"></i>
            <span class="SuggestTitle">${EscapeHtml(item.Title || item.Url)}</span>
            <span class="SuggestUrl">${EscapeHtml(item.Url)}</span>
        </li>`).join("");

    Dom.SuggestList.hidden = false;
}

function HideSuggestions() {
    Dom.SuggestList.hidden = true;
    State.Suggest.Items = [];
    State.Suggest.Index = -1;
}

/** 以方向鍵移動選取 */
function MoveSuggestion(step) {
    const count = State.Suggest.Items.length;
    if (count === 0) return;

    // 索引範圍 -1（未選取）~ count-1，循環移動
    State.Suggest.Index = ((State.Suggest.Index + 1 + step + count + 1) % (count + 1)) - 1;
    RenderSuggestions();
}

/** 前往建議項目 */
function OpenSuggestion(index) {
    const item = State.Suggest.Items[index];
    if (!item) return;

    HideSuggestions();
    Dom.AddressInput.blur();
    const tab = GetActiveTab();
    if (tab) Navigate(tab, item.Url);
}

/* ============================================================
 * 11. 內部頁面
 * ============================================================ */

function RenderInternalPage(tab, url) {
    SetLoading(tab, false);

    switch (url) {
        case "owob://start":
            RenderStartPage(tab);
            break;
        case "owob://settings":
            RenderSettingsPage(tab);
            break;
        case "owob://history":
            RenderHistoryPage(tab);
            break;
        case "owob://bookmarks":
            RenderBookmarksPage(tab);
            break;
        case "owob://cookies":
            RenderCookiesPage(tab);
            break;
        default:
            RenderErrorPage(tab, "找不到內部頁面", `未知的內部網址：${url}`, url);
    }
}

/** 是否仍停留在指定內部頁面（避免非同步操作後重繪到別的頁面） */
function IsOnPage(tab, url) {
    return GetTabUrl(tab) === url && State.Tabs.includes(tab);
}

/* ---------- 首頁 ---------- */

function RenderStartPage(tab) {
    tab.Title = "新分頁";
    UpdateTabHeader(tab);

    const shortcuts = LoadShortcuts()
        .map((item, index) => {
            const icon = item.Icon
                ? `<i class="${EscapeHtml(item.Icon)}"></i>`
                : `<span class="ShortcutLetter">${EscapeHtml((item.Name || "?").trim().charAt(0).toUpperCase())}</span>`;

            return `
                <div class="Shortcut" draggable="true" data-index="${index}" title="${EscapeHtml(item.Url)}">
                    ${icon}
                    <span class="ShortcutName">${EscapeHtml(item.Name)}</span>
                    <div class="ShortcutTools">
                        <button class="MiniButton" data-tool="edit"   title="編輯"><i class="fa-solid fa-pen"></i></button>
                        <button class="MiniButton" data-tool="delete" title="刪除"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>`;
        })
        .join("");

    SetTabContent(tab, `
        <div class="StartPage">
            <h1 class="StartLogo">
                <span class="StartLogoMain">OwO</span>
                <span class="StartLogoSub">Simple Browser</span>
            </h1>
            <form class="StartSearch" autocomplete="off">
                <i class="fa-brands fa-microsoft"></i>
                <input type="text" placeholder="使用 Bing 搜尋或輸入網址（Ctrl+K）" spellcheck="false">
            </form>
            <div class="Shortcuts">
                ${shortcuts}
                <button class="Shortcut AddShortcut" data-role="add" title="新增捷徑">
                    <i class="fa-solid fa-plus"></i>
                    <span class="ShortcutName">新增捷徑</span>
                </button>
            </div>
        </div>
    `);

    const form  = tab.ViewEl.querySelector(".StartSearch");
    const input = form.querySelector("input");

    form.addEventListener("submit", event => {
        event.preventDefault();
        if (input.value.trim()) Navigate(tab, ResolveInput(input.value));
    });

    const rerender = () => {
        if (IsOnPage(tab, "owob://start")) RenderStartPage(tab);
    };

    // 新增捷徑
    tab.ViewEl.querySelector('[data-role="add"]').addEventListener("click", async () => {
        if (await EditShortcut(-1)) rerender();
    });

    // 各捷徑：開啟 / 編輯 / 刪除 / 拖曳排序
    let dragIndex = null;

    tab.ViewEl.querySelectorAll(".Shortcut[data-index]").forEach(tile => {
        const index = Number(tile.dataset.index);

        tile.addEventListener("click", async event => {
            const tool = event.target.closest("[data-tool]");
            if (tool) {
                event.stopPropagation();
                if (tool.dataset.tool === "edit") {
                    if (await EditShortcut(index)) rerender();
                } else if (confirm(`確定刪除捷徑「${LoadShortcuts()[index]?.Name || ""}」？`)) {
                    DeleteShortcut(index);
                    rerender();
                }
                return;
            }
            Navigate(tab, LoadShortcuts()[index].Url);
        });

        tile.addEventListener("dragstart", event => {
            dragIndex = index;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
            tile.classList.add("Dragging");
        });
        tile.addEventListener("dragend", () => {
            dragIndex = null;
            tab.ViewEl.querySelectorAll(".Shortcut").forEach(el => el.classList.remove("Dragging", "DropTarget"));
        });
        tile.addEventListener("dragover", event => {
            if (dragIndex === null || dragIndex === index) return;
            event.preventDefault();
            tile.classList.add("DropTarget");
        });
        tile.addEventListener("dragleave", () => tile.classList.remove("DropTarget"));
        tile.addEventListener("drop", event => {
            if (dragIndex === null || dragIndex === index) return;
            event.preventDefault();
            MoveShortcut(dragIndex, index);
            rerender();
        });
    });

    if (tab.Id === State.ActiveId) {
        setTimeout(() => input.focus(), 0);
    }
}

/* ---------- 設定頁 ---------- */

function RenderSettingsPage(tab) {
    tab.Title = "設定";
    UpdateTabHeader(tab);

    const isDark   = document.body.classList.contains("theme-dark");
    const proxyKey = GetProxyKey();

    const checkbox = (name, label, hint) => `
        <label class="ToggleRow">
            <input type="checkbox" data-flag="${name}" ${GetFlag(name) ? "checked" : ""}>
            <span>
                <strong>${label}</strong>
                <small>${hint}</small>
            </span>
        </label>`;

    SetTabContent(tab, `
        <div class="InternalPage">
            <header class="SettingsHeader">
                <div class="SettingsHeaderIcon"><i class="fa-solid fa-gear"></i></div>
                <div>
                    <h1>設定</h1>
                    <p>OwO Simple Browser</p>
                </div>
            </header>

            <div class="Card">
                <h2>外觀</h2>
                <p class="CardIntro">選擇瀏覽器的顯示主題。</p>
                <div class="ButtonRow">
                    <button class="ActionButton${isDark ? " Secondary" : ""}" data-action="light">亮色</button>
                    <button class="ActionButton${isDark ? "" : " Secondary"}" data-action="dark">深色</button>
                </div>
            </div>

            <div class="Card">
                <h2>代理伺服器</h2>
                <p class="CardIntro">設定載入外部網頁時使用的代理伺服器。</p>

                <div class="SettingStatus">
                    <span class="SettingStatusLabel">使用狀態</span>
                    <strong>${IsCustomProxy() ? "自訂代理伺服器" : "預設代理伺服器"}</strong>
                    ${proxyKey ? '<span class="StatusBadge">已設定金鑰</span>' : ""}
                </div>

                <label class="FieldLabel" for="ProxyInput">代理網址</label>
                <input id="ProxyInput" class="SettingInput" type="text" spellcheck="false"
                       placeholder="留空時，將使用預設代理伺服器。"
                       value="${IsCustomProxy() ? EscapeHtml(GetProxyBase()) : ""}">
                <p class="FieldHint">留空時，將使用預設代理伺服器。</p>

                <label class="FieldLabel" for="ProxyKeyInput">存取金鑰</label>
                <div class="InputRow">
                    <input id="ProxyKeyInput" class="SettingInput" type="password" spellcheck="false"
                           autocomplete="off" placeholder="未設定"
                           value="${EscapeHtml(proxyKey)}">
                    <button class="ToolButton" data-action="toggle-key" title="顯示或隱藏存取金鑰。">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </div>
                <p class="FieldHint">若代理伺服器已啟用存取驗證，請輸入相同的金鑰。</p>

                <div class="ButtonRow">
                    <button class="ActionButton" data-action="save-proxy">儲存設定</button>
                    <button class="ActionButton Secondary" data-action="reset-proxy">還原預設</button>
                    <button class="ActionButton Secondary" data-action="test-proxy">測試連線</button>
                </div>
            </div>

            <div class="Card">
                <h2>網頁載入</h2>
                <p class="CardIntro">調整網頁載入方式與連線等待時間。</p>

                <div class="TimeoutSetting">
                    <label class="TimeoutLabel" for="TimeoutInput">連線逾時</label>
                    <div class="TimeoutValueArea">
                        <div class="TimeoutControl">
                            <button class="TimeoutStep" type="button" data-timeout-step="-1" aria-label="減少一秒">−</button>
                            <input id="TimeoutInput" class="SettingInput ShortInput" type="number"
                                   min="${Config.MinTimeoutSec}" max="${Config.MaxTimeoutSec}" step="1"
                                   value="${GetTimeoutSec()}">
                            <button class="TimeoutStep" type="button" data-timeout-step="1" aria-label="增加一秒">＋</button>
                            <span class="TimeoutUnit">秒</span>
                        </div>
                        <p class="FieldHint">可設定 ${Config.MinTimeoutSec} 至 ${Config.MaxTimeoutSec} 秒。</p>
                    </div>
                </div>

                ${checkbox("ProxyResources", "圖片與影音使用代理", "可改善圖片或影音無法載入的情況，但會增加代理請求數量。")}
                ${checkbox("ProxyRequests",  "動態內容使用代理",   "可改善部分網頁的動態內容無法載入的情況。")}
                ${checkbox("ProxyScripts",   "網頁腳本使用代理",   "此功能仍在測試中，啟用後可能造成部分網站無法正常運作。")}
                <p class="CardNote">變更將於重新整理網頁後生效。</p>
            </div>

            <div class="Card">
                <h2>書籤與首頁捷徑</h2>
                <p class="CardIntro">管理已儲存的書籤與首頁捷徑。</p>
                <p class="CardSummary">目前有 ${LoadBookmarks().length} 個書籤，以及 ${LoadShortcuts().length} 個首頁捷徑。</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="bookmarks">管理書籤</button>
                    <button class="ActionButton Secondary" data-action="reset-shortcuts">還原預設捷徑</button>
                </div>
            </div>

            <div class="Card">
                <h2>網站資料</h2>
                <p class="CardIntro">管理網站儲存在瀏覽器中的 Cookie。</p>
                <p class="CardSummary">目前已儲存 ${CountCookies()} 筆 Cookie。</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="cookies">管理 Cookie</button>
                    <button class="ActionButton Danger" data-action="clear-cookies">清除全部 Cookie</button>
                </div>
            </div>

            <div class="Card">
                <h2>瀏覽紀錄</h2>
                <p class="CardIntro">查看或清除瀏覽紀錄。</p>
                <p class="CardSummary">目前共有 ${LoadHistory().length} 筆瀏覽紀錄。</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="history">查看瀏覽紀錄</button>
                    <button class="ActionButton Danger" data-action="clear">清除瀏覽資料</button>
                </div>
                <p class="CardNote">清除後，瀏覽紀錄、已開啟的分頁與 Cookie 將被移除；瀏覽器設定、書籤與首頁捷徑將會保留。</p>
            </div>

            <div class="Card">
                <h2>備份與還原</h2>
                <p class="CardIntro">匯出或匯入瀏覽器設定、書籤與首頁捷徑。</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="export">匯出設定</button>
                    <button class="ActionButton Secondary" data-action="import">匯入設定</button>
                </div>
                <p class="CardNote">匯出的設定檔可能包含代理伺服器的存取金鑰，請妥善保管。</p>
            </div>

            <div class="Card">
                <h2>隱藏視窗</h2>
                <p class="CardIntro">在空白瀏覽器標籤中開啟 OwO Simple Browser。</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="cloak">開啟隱藏視窗</button>
                </div>
                <p class="CardNote">開啟後，外層瀏覽器的標籤名稱將顯示為「新分頁」。</p>
            </div>

            <div class="Card">
                <h2>鍵盤快捷鍵</h2>
                <p class="CardIntro">使用鍵盤快速執行常用操作。</p>
                <div class="ShortcutGrid">
                    <div class="ShortcutColumn">
                        <div class="ShortcutRow"><kbd>Ctrl + K</kbd><span>聚焦首頁搜尋框。</span></div>
                        <div class="ShortcutRow"><kbd>Ctrl + L</kbd><span>聚焦網址列。</span></div>
                        <div class="ShortcutRow"><kbd>Ctrl + F</kbd><span>在頁面中尋找文字。</span></div>
                        <div class="ShortcutRow"><kbd>Ctrl + D</kbd><span>加入或移除書籤。</span></div>
                        <div class="ShortcutRow"><kbd>Alt + T</kbd><span>新增分頁。</span></div>
                        <div class="ShortcutRow"><kbd>Alt + W</kbd><span>關閉目前分頁。</span></div>
                        <div class="ShortcutRow"><kbd>Alt + Shift + T</kbd><span>重新開啟最近關閉的分頁。</span></div>
                    </div>
                    <div class="ShortcutColumn">
                        <div class="ShortcutRow"><kbd>Alt + ←</kbd><span>返回上一頁。</span></div>
                        <div class="ShortcutRow"><kbd>Alt + →</kbd><span>前往下一頁。</span></div>
                        <div class="ShortcutRow"><kbd>Ctrl + +</kbd><span>放大頁面。</span></div>
                        <div class="ShortcutRow"><kbd>Ctrl + -</kbd><span>縮小頁面。</span></div>
                        <div class="ShortcutRow"><kbd>Ctrl + 0</kbd><span>重設頁面縮放。</span></div>
                        <div class="ShortcutRow"><kbd>F5</kbd><span>重新整理目前頁面。</span></div>
                    </div>
                </div>
            </div>
        </div>
    `);

    const rerender = () => {
        if (IsOnPage(tab, "owob://settings")) RenderSettingsPage(tab);
    };

    const actions = {
        "light":           () => { ApplyTheme("light"); rerender(); },
        "dark":            () => { ApplyTheme("dark");  rerender(); },
        "toggle-key":      () => {
            const input = tab.ViewEl.querySelector("#ProxyKeyInput");
            input.type = input.type === "password" ? "text" : "password";
        },
        "save-proxy":      () => { if (SaveProxySetting(tab)) rerender(); },
        "reset-proxy":     () => { ResetProxySetting(); rerender(); },
        "test-proxy":      () => TestProxy(),
        "bookmarks":       () => Navigate(tab, "owob://bookmarks"),
        "reset-shortcuts": () => {
            if (!confirm("確定將首頁捷徑還原為預設？")) return;
            localStorage.removeItem(Config.StorageKeys.Shortcuts);
            ShowToast("已還原預設捷徑");
            rerender();
        },
        "cookies":         () => Navigate(tab, "owob://cookies"),
        "clear-cookies":   () => {
            localStorage.removeItem(Config.StorageKeys.Cookies);
            ShowToast("已清除 Cookie");
            rerender();
        },
        "history":         () => Navigate(tab, "owob://history"),
        "clear":           () => {
            if (!confirm("確定清除瀏覽紀錄、已開啟分頁與 Cookie？")) return;
            ClearBrowsingData();
            rerender();
        },
        "export":          () => ExportSettings(),
        "import":          () => {
            Dom.ImportInput.value = "";
            Dom.ImportInput.click();
        },
        "cloak":           () => OpenCloaked()
    };

    tab.ViewEl.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", () => actions[button.dataset.action]());
    });

    // 在代理網址 / 金鑰輸入框按 Enter 直接儲存
    ["#ProxyInput", "#ProxyKeyInput"].forEach(selector => {
        tab.ViewEl.querySelector(selector).addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                if (SaveProxySetting(tab)) rerender();
            }
        });
    });

    // 逾時：加減按鈕調整後立即觸發既有儲存流程
    const timeoutInput = tab.ViewEl.querySelector("#TimeoutInput");
    tab.ViewEl.querySelectorAll("[data-timeout-step]").forEach(button => {
        button.addEventListener("click", () => {
            const current = Number(timeoutInput.value) || GetTimeoutSec();
            const step = Number(button.dataset.timeoutStep);
            timeoutInput.value = Clamp(current + step, Config.MinTimeoutSec, Config.MaxTimeoutSec);
            timeoutInput.dispatchEvent(new Event("change", { bubbles: true }));
        });
    });

    // 逾時：變更即儲存
    timeoutInput.addEventListener("change", event => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value) || value <= 0) {
            event.target.value = GetTimeoutSec();
            ShowToast("請輸入有效秒數");
            return;
        }
        const seconds = Clamp(Math.round(value), Config.MinTimeoutSec, Config.MaxTimeoutSec);
        localStorage.setItem(Config.StorageKeys.TimeoutSec, String(seconds));
        event.target.value = seconds;
        ShowToast(`連線逾時已設為 ${seconds} 秒`);
    });

    // 載入選項：變更即儲存
    tab.ViewEl.querySelectorAll("[data-flag]").forEach(input => {
        input.addEventListener("change", () => {
            SetFlag(input.dataset.flag, input.checked);
            ShowToast("已儲存，重新整理網頁後生效");
        });
    });
}

/**
 * 儲存代理網址與金鑰（網址留空 = 使用預設）
 * @returns {boolean} 是否儲存成功
 */
function SaveProxySetting(tab) {
    const rawUrl = tab.ViewEl.querySelector("#ProxyInput").value.trim();
    const rawKey = tab.ViewEl.querySelector("#ProxyKeyInput").value.trim();

    if (rawUrl) {
        const normalized = NormalizeProxyBase(rawUrl);
        if (!normalized) {
            ShowToast("代理網址格式錯誤，需為 http:// 或 https:// 開頭");
            return false;
        }
        localStorage.setItem(Config.StorageKeys.ProxyBase, normalized);
    } else {
        localStorage.removeItem(Config.StorageKeys.ProxyBase);
    }

    if (rawKey) {
        localStorage.setItem(Config.StorageKeys.ProxyKey, rawKey);
    } else {
        localStorage.removeItem(Config.StorageKeys.ProxyKey);
    }

    ShowToast(rawUrl ? "已改用自訂代理伺服器" : "已儲存（使用預設代理伺服器）");
    return true;
}

/** 還原預設代理（同時清除金鑰） */
function ResetProxySetting() {
    localStorage.removeItem(Config.StorageKeys.ProxyBase);
    localStorage.removeItem(Config.StorageKeys.ProxyKey);
    ShowToast("已還原為預設代理伺服器");
}

/** 測試代理連線 */
async function TestProxy() {
    ShowToast("測試中…");
    const start = performance.now();

    try {
        const response = await fetch(BuildProxyUrl("https://example.com/"));
        const ms = Math.round(performance.now() - start);

        if (response.ok) {
            ShowToast(`代理正常（${ms} ms）`);
        } else if (response.status === 401) {
            ShowToast("代理需要金鑰，或金鑰錯誤（HTTP 401）");
        } else if (response.status === 403) {
            ShowToast("代理拒絕此來源（HTTP 403），請檢查 ALLOWED_ORIGINS");
        } else {
            ShowToast(`代理回應 HTTP ${response.status}`);
        }
    } catch (error) {
        ShowToast(`代理無法連線：${error.message}`);
    }
}

/* ---------- 瀏覽紀錄頁 ---------- */

function RenderHistoryPage(tab) {
    tab.Title = "瀏覽紀錄";
    UpdateTabHeader(tab);

    SetTabContent(tab, `
        <div class="InternalPage">
            <h1><i class="fa-solid fa-clock-rotate-left"></i> 瀏覽紀錄</h1>
            <div class="PageTools">
                <input class="SettingInput" data-role="filter" type="search" placeholder="搜尋紀錄（標題或網址）" spellcheck="false">
                <button class="ActionButton Danger" data-role="clear">清除全部紀錄</button>
            </div>
            <div data-role="list"></div>
        </div>
    `);

    const filterInput = tab.ViewEl.querySelector('[data-role="filter"]');
    const listEl      = tab.ViewEl.querySelector('[data-role="list"]');

    const renderList = () => {
        const needle  = filterInput.value.trim().toLowerCase();
        const records = LoadHistory().filter(record =>
            !needle ||
            record.Url.toLowerCase().includes(needle) ||
            (record.Title || "").toLowerCase().includes(needle)
        );

        if (records.length === 0) {
            listEl.innerHTML = `<div class="Card"><p class="Empty">${needle ? "找不到符合的紀錄" : "尚無紀錄"}</p></div>`;
            return;
        }

        // 依日期分組
        const groups = new Map();
        records.forEach(record => {
            const day = new Date(record.Time).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
            if (!groups.has(day)) groups.set(day, []);
            groups.get(day).push(record);
        });

        listEl.innerHTML = [...groups.entries()].map(([day, items]) => `
            <div class="Card">
                <h2 class="GroupTitle">${EscapeHtml(day)}</h2>
                <ul class="ItemList">
                    ${items.map(record => `
                        <li>
                            <time>${new Date(record.Time).toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit" })}</time>
                            <a href="#" data-url="${EscapeHtml(record.Url)}" title="${EscapeHtml(record.Url)}">
                                <span class="ItemTitle">${EscapeHtml(record.Title || record.Url)}</span>
                                <span class="ItemUrl">${EscapeHtml(GetHostname(record.Url))}</span>
                            </a>
                            <button class="MiniButton" data-delete="${EscapeHtml(record.Id)}" title="刪除此筆">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </li>`).join("")}
                </ul>
            </div>`).join("");
    };

    listEl.addEventListener("click", event => {
        const deleteButton = event.target.closest("[data-delete]");
        if (deleteButton) {
            DeleteHistoryRecord(deleteButton.dataset.delete);
            renderList();
            return;
        }
        const link = event.target.closest("[data-url]");
        if (link) {
            event.preventDefault();
            Navigate(tab, link.dataset.url);
        }
    });

    filterInput.addEventListener("input", renderList);

    tab.ViewEl.querySelector('[data-role="clear"]').addEventListener("click", () => {
        if (!confirm("確定清除全部瀏覽紀錄？")) return;
        localStorage.removeItem(Config.StorageKeys.History);
        ShowToast("已清除瀏覽紀錄");
        renderList();
    });

    renderList();
}

/* ---------- 書籤頁 ---------- */

function RenderBookmarksPage(tab) {
    tab.Title = "書籤";
    UpdateTabHeader(tab);

    SetTabContent(tab, `
        <div class="InternalPage">
            <h1><i class="fa-solid fa-star"></i> 書籤</h1>
            <div class="PageTools">
                <input class="SettingInput" data-role="filter" type="search" placeholder="搜尋書籤（標題或網址）" spellcheck="false">
                <button class="ActionButton" data-role="add">新增書籤</button>
            </div>
            <div class="Card"><ul class="ItemList" data-role="list"></ul></div>
        </div>
    `);

    const filterInput = tab.ViewEl.querySelector('[data-role="filter"]');
    const listEl      = tab.ViewEl.querySelector('[data-role="list"]');

    const renderList = () => {
        const needle = filterInput.value.trim().toLowerCase();
        const items  = LoadBookmarks().filter(item =>
            !needle ||
            item.Url.toLowerCase().includes(needle) ||
            (item.Title || "").toLowerCase().includes(needle)
        );

        listEl.innerHTML = items.length
            ? items.map(item => `
                <li>
                    <i class="fa-solid fa-star ItemIcon"></i>
                    <a href="#" data-url="${EscapeHtml(item.Url)}" title="${EscapeHtml(item.Url)}">
                        <span class="ItemTitle">${EscapeHtml(item.Title || item.Url)}</span>
                        <span class="ItemUrl">${EscapeHtml(item.Url)}</span>
                    </a>
                    <button class="MiniButton" data-op="edit"     data-id="${EscapeHtml(item.Id)}" title="編輯"><i class="fa-solid fa-pen"></i></button>
                    <button class="MiniButton" data-op="shortcut" data-id="${EscapeHtml(item.Id)}" title="加到首頁捷徑"><i class="fa-solid fa-thumbtack"></i></button>
                    <button class="MiniButton" data-op="delete"   data-id="${EscapeHtml(item.Id)}" title="刪除"><i class="fa-solid fa-xmark"></i></button>
                </li>`).join("")
            : `<li class="Empty">${needle ? "找不到符合的書籤" : "尚無書籤，瀏覽網頁時按網址列的星號或 Ctrl+D 即可加入。"}</li>`;
    };

    /** 新增或編輯書籤 */
    const editBookmark = async (id = null) => {
        const list    = LoadBookmarks();
        const current = id ? list.find(item => item.Id === id) : { Title: "", Url: "" };
        if (!current) return;

        const values = await ShowDialog({
            Title:       id ? "編輯書籤" : "新增書籤",
            ConfirmText: "儲存",
            Fields: [
                { Name: "Title", Label: "名稱", Value: current.Title },
                { Name: "Url",   Label: "網址", Value: current.Url, Placeholder: "https://example.com/" }
            ]
        });
        if (!values) return;

        const url = NormalizeUserUrl(values.Url);
        if (!url || IsInternalUrl(url)) {
            ShowToast("網址格式錯誤");
            return;
        }

        const title = values.Title.trim() || GetHostname(url);
        if (id) {
            Object.assign(current, { Title: title, Url: url });
        } else {
            list.unshift({ Id: CreateId(), Url: url, Title: title, Time: Date.now() });
        }
        SaveBookmarks(list);
        ShowToast(id ? "已更新書籤" : "已新增書籤");
        renderList();
    };

    listEl.addEventListener("click", async event => {
        const button = event.target.closest("[data-op]");
        if (button) {
            const id   = button.dataset.id;
            const item = LoadBookmarks().find(entry => entry.Id === id);
            if (!item) return;

            if (button.dataset.op === "edit") {
                await editBookmark(id);
            } else if (button.dataset.op === "shortcut") {
                await EditShortcut(-1, { Name: item.Title, Url: item.Url });
            } else if (button.dataset.op === "delete") {
                DeleteBookmark(id);
                ShowToast("已刪除書籤");
                renderList();
            }
            return;
        }

        const link = event.target.closest("[data-url]");
        if (link) {
            event.preventDefault();
            Navigate(tab, link.dataset.url);
        }
    });

    filterInput.addEventListener("input", renderList);
    tab.ViewEl.querySelector('[data-role="add"]').addEventListener("click", () => editBookmark());

    renderList();
}

/* ---------- Cookie 管理頁 ---------- */

function RenderCookiesPage(tab) {
    tab.Title = "Cookie 管理";
    UpdateTabHeader(tab);

    SetTabContent(tab, `
        <div class="InternalPage">
            <h1><i class="fa-solid fa-cookie-bite"></i> Cookie 管理</h1>
            <div class="PageTools">
                <input class="SettingInput" data-role="filter" type="search" placeholder="搜尋網域" spellcheck="false">
                <button class="ActionButton Danger" data-role="clear">清除全部 Cookie</button>
            </div>
            <div data-role="list"></div>
        </div>
    `);

    const filterInput = tab.ViewEl.querySelector('[data-role="filter"]');
    const listEl      = tab.ViewEl.querySelector('[data-role="list"]');
    const openDomains = new Set();   // 重繪時保留展開狀態

    const renderList = () => {
        const needle  = filterInput.value.trim().toLowerCase();
        const jar     = LoadCookieJar();
        const domains = Object.keys(jar)
            .filter(domain => !needle || domain.includes(needle))
            .sort();

        if (domains.length === 0) {
            listEl.innerHTML = `<div class="Card"><p class="Empty">${needle ? "找不到符合的網域" : "目前沒有保存任何 Cookie"}</p></div>`;
            return;
        }

        listEl.innerHTML = domains.map(domain => {
            const cookies = Object.entries(jar[domain]);
            const rows = cookies.map(([name, item]) => {
                const value = item.Value.length > 48 ? item.Value.slice(0, 48) + "…" : item.Value;
                return `
                    <li>
                        <span class="CookieName">${EscapeHtml(name)}</span>
                        <code class="CookieValue" title="${EscapeHtml(item.Value)}">${EscapeHtml(value)}</code>
                        <span class="CookieExpire">${item.Expires === null ? "工作階段" : FormatDateTime(item.Expires)}</span>
                        <button class="MiniButton" data-domain="${EscapeHtml(domain)}" data-name="${EscapeHtml(name)}" title="刪除此 Cookie">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </li>`;
            }).join("");

            return `
                <details class="Card CookieDomain" data-domain-card="${EscapeHtml(domain)}" ${openDomains.has(domain) ? "open" : ""}>
                    <summary>
                        <span class="CookieDomainName">${EscapeHtml(domain)}</span>
                        <span class="Badge">${cookies.length}</span>
                        <button class="ActionButton Danger Small" data-domain="${EscapeHtml(domain)}">刪除此網域</button>
                    </summary>
                    <ul class="CookieList">${rows}</ul>
                </details>`;
        }).join("");

        listEl.querySelectorAll("details").forEach(details => {
            details.addEventListener("toggle", () => {
                const domain = details.dataset.domainCard;
                if (details.open) openDomains.add(domain);
                else openDomains.delete(domain);
            });
        });
    };

    listEl.addEventListener("click", event => {
        const button = event.target.closest("[data-domain]");
        if (!button) return;
        event.preventDefault();   // 避免點擊 summary 內按鈕時切換展開狀態

        const domain = button.dataset.domain;
        const name   = button.dataset.name;
        DeleteCookie(domain, name === undefined ? null : name);
        ShowToast(name === undefined ? `已刪除 ${domain} 的 Cookie` : `已刪除 Cookie：${name}`);
        renderList();
    });

    filterInput.addEventListener("input", renderList);

    tab.ViewEl.querySelector('[data-role="clear"]').addEventListener("click", () => {
        if (!confirm("確定清除全部 Cookie？")) return;
        localStorage.removeItem(Config.StorageKeys.Cookies);
        ShowToast("已清除 Cookie");
        renderList();
    });

    renderList();
}

/* ---------- 錯誤頁 ---------- */

function RenderErrorPage(tab, title, detail, retryUrl) {
    tab.Title = "載入失敗";
    UpdateTabHeader(tab);

    SetTabContent(tab, `
        <div class="ErrorPage">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <h2>${EscapeHtml(title)}</h2>
            <pre>${EscapeHtml(detail)}</pre>
            <div class="ButtonRow">
                <button class="ActionButton" data-action="retry">重試</button>
                <button class="ActionButton Secondary" data-action="direct">直接開啟原網址</button>
            </div>
        </div>
    `);

    tab.ViewEl.querySelector('[data-action="retry"]')
        .addEventListener("click", () => Navigate(tab, retryUrl, false));
    tab.ViewEl.querySelector('[data-action="direct"]')
        .addEventListener("click", () => window.open(retryUrl, "_blank", "noopener"));
}

/* ============================================================
 * 12. 外部頁面（經由代理載入）
 * ============================================================ */

/**
 * 經由代理載入外部頁面
 * @param {object}      tab       目標分頁
 * @param {string}      url       目標網址
 * @param {object|null} postData  POST 資料 { Body, Referer }；null 表示 GET
 */
async function LoadExternalPage(tab, url, postData = null) {
    if (postData) {
        ShowToast("表單將由內容頁直接送出");
    }

    tab.Title = "載入中…";
    SetLoading(tab, true);

    try {
        const frame = CreateFrame(tab);
        frame.src = BuildContentPageUrl(url, tab.Id);
        frame.addEventListener("load", () => {
            if (GetTabUrl(tab) === url) SetLoading(tab, false);
        }, { once: true });
        frame.addEventListener("error", () => {
            if (GetTabUrl(tab) === url) {
                SetLoading(tab, false);
                RenderErrorPage(tab, "無法載入此網頁", url, url);
            }
        }, { once: true });
        SetTabContent(tab, frame, true);
        tab.HasAgent = true;
    } catch (error) {
        SetLoading(tab, false);
        RenderErrorPage(tab, "無法載入此網頁", `${url}\n\n${error.message}`, url);
    }
}

/* ---------- 外部樣式表內嵌 ----------
 * 沙箱 iframe 直接向原網站要 CSS 時，常被以下機制擋下而變成無樣式頁面：
 *   - 防盜連（檢查 Referer，而 iframe 設定了 no-referrer）
 *   - Cross-Origin-Resource-Policy（iframe 來源為 null）
 * 因此先經代理抓回 CSS，把其中 url() / @import 轉成絕對網址後，
 * 以 <style> 內嵌到 HTML，抓取失敗則保留原本的 <link>。
 */

/** 取得 HTML 標籤屬性值 */
function GetTagAttribute(tag, name) {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    return match ? DecodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/** 將 CSS 內的相對網址轉為絕對網址 */
function AbsolutizeCss(css, cssUrl) {
    const resolve = value => {
        const text = value.trim();
        if (!text || /^(data:|#|about:|blob:)/i.test(text)) return text;
        try {
            return new URL(text, cssUrl).toString();
        } catch {
            return text;
        }
    };

    return css
        // url(...)、url("...")、url('...')
        .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (match, quote, value) => `url("${resolve(value)}")`)
        // @import "..." / @import '...'
        .replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, value) => `@import "${resolve(value)}"`);
}

/** 將 CSS 內 url() 指向的圖片、字型改經代理（@import 不處理，避免其內相對路徑失效） */
function ProxyCssUrls(css, baseUrl) {
    return css.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (match, quote, value) => {
        const mapped = MapResourceUrl(value, baseUrl);
        return mapped === value ? match : `url("${mapped}")`;
    });
}

/** 經代理抓取單一樣式表；失敗回傳 null */
async function FetchStylesheet(cssUrl, pageUrl, pageSignal) {
    const controller  = new AbortController();
    const timer       = setTimeout(() => controller.abort(), Config.StylesheetTimeoutMs);
    const onPageAbort = () => controller.abort();
    pageSignal.addEventListener("abort", onPageAbort);

    try {
        const response = await fetch(BuildProxyUrl(cssUrl), {
            headers: { "X-Proxy-Referer": pageUrl },
            signal:  controller.signal
        });
        if (!response.ok) return null;

        const type = response.headers.get("Content-Type") || "";
        if (type && !/css|text\/plain|octet-stream/i.test(type)) return null;

        return AbsolutizeCss(await response.text(), cssUrl);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        pageSignal.removeEventListener("abort", onPageAbort);
    }
}

/** 將 HTML 內的 <link rel="stylesheet"> 換成內嵌 <style> */
async function InlineStylesheets(html, pageUrl, pageSignal) {
    const linkTags = (html.match(/<link\b[^>]*>/gi) || [])
        .filter(tag => /(^|\s)stylesheet(\s|$)/i.test(GetTagAttribute(tag, "rel") || ""))
        .slice(0, Config.MaxInlineStylesheets);

    if (linkTags.length === 0) return html;

    const results = await Promise.all(linkTags.map(async tag => {
        const href = GetTagAttribute(tag, "href");
        if (!href) return null;

        let cssUrl;
        try {
            cssUrl = new URL(href, pageUrl).toString();   // 支援 //images.ptt.cc/... 這類寫法
        } catch {
            return null;
        }
        if (!IsWebUrl(cssUrl)) return null;

        const css = await FetchStylesheet(cssUrl, pageUrl, pageSignal);
        if (css === null) return null;

        const media     = GetTagAttribute(tag, "media");
        const mediaAttr = media ? ` media="${EscapeHtml(media)}"` : "";
        // 避免 CSS 內容提前結束 <style> 標籤
        const safeCss   = css.replace(/<\/style/gi, "<\\/style");

        return `<style data-owob-href="${EscapeHtml(cssUrl)}"${mediaAttr}>\n${safeCss}\n</style>`;
    }));

    let output = html;
    linkTags.forEach((tag, index) => {
        if (results[index]) {
            output = output.replace(tag, () => results[index]);
        }
    });
    return output;
}

/* ---------- 資源網址改寫 ----------
 * 在 HTML 交給 iframe 前，先把資源網址改成代理網址。
 * 必須在字串階段處理：瀏覽器的預先載入掃描器會在任何腳本執行前就開始抓圖片。
 * 動態加入的資源則由 iframe 內的代理程式（第 13 節）處理。
 */

/** 改寫單一標籤內的 src / srcset / poster / data-src / data-srcset */
function RewriteTagAttributes(tagText, baseUrl) {
    return tagText.replace(
        /(\s(data-srcset|data-src|srcset|src|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
        (match, prefix, name, doubleQuoted, singleQuoted, bare) => {
            const raw    = DecodeEntities(doubleQuoted ?? singleQuoted ?? bare ?? "");
            const mapper = value => MapResourceUrl(value, baseUrl);
            const next   = /srcset$/i.test(name) ? RewriteSrcset(raw, mapper) : mapper(raw);
            return next === raw ? match : `${prefix}"${EscapeHtml(next)}"`;
        }
    );
}

/**
 * 改寫 HTML 中的資源網址
 *   - <img> <source> <video> <audio> <track> <embed> <input>：依「圖片、影音、字型經代理」設定
 *   - <style> 區塊內的 url()：同上
 *   - <script src>：依「外部腳本經代理」設定（type="module" 一律不改，避免相對 import 失效）
 *   - 註解、<textarea>、<noscript> 內容與內嵌腳本內容不改，避免破壞字串
 */
function RewriteHtmlResources(html, baseUrl) {
    const proxyMedia   = GetFlag("ProxyResources");
    const proxyScripts = GetFlag("ProxyScripts");
    if (!proxyMedia && !proxyScripts) return html;

    const pattern = /<!--[\s\S]*?-->|<(textarea|noscript)\b[\s\S]*?<\/\1\s*>|<style\b([^>]*)>([\s\S]*?)<\/style\s*>|<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<(?:img|source|video|audio|track|embed|input)\b[^>]*>/gi;

    return html.replace(pattern, (match, rawTag, styleAttrs, styleBody, scriptAttrs, scriptBody) => {
        // <style>：改寫 url()
        if (styleBody !== undefined) {
            return proxyMedia ? `<style${styleAttrs}>${ProxyCssUrls(styleBody, baseUrl)}</style>` : match;
        }

        // <script>：只改開始標籤的 src
        if (scriptAttrs !== undefined) {
            if (!proxyScripts || /\btype\s*=\s*["']?module/i.test(scriptAttrs)) return match;
            return `<script${RewriteTagAttributes(scriptAttrs, baseUrl)}>${scriptBody}</script>`;
        }

        // 註解、<textarea>、<noscript>：原樣保留
        if (rawTag !== undefined || match.startsWith("<!--")) {
            return match;
        }

        // 圖片 / 影音標籤
        return proxyMedia ? RewriteTagAttributes(match, baseUrl) : match;
    });
}

/**
 * 將抓回的 HTML 放進沙箱 iframe
 *  - <base> 讓相對路徑的圖片、CSS 正確指向原網站
 *  - 注入 iframe 代理程式（連結、表單、資源、請求、頁內搜尋、快捷鍵）
 *  - sandbox 不含 allow-same-origin，網頁腳本無法存取 OwOb 本身
 */
function RenderHtmlInFrame(tab, html, baseUrl) {
    // <meta http-equiv="refresh"> 會讓 iframe 繞過代理直接跳轉，
    // 因此從 HTML 移除，改由 OwOb 經代理導覽
    const refresh = ExtractMetaRefresh(html, baseUrl);
    if (refresh) {
        html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
    }

    const agentOptions = {
        TabId:          tab.Id,
        ProxyBase:      GetProxyBase(),
        ProxyKey:       GetProxyKey(),
        ProxyResources: GetFlag("ProxyResources"),
        ProxyScripts:   GetFlag("ProxyScripts"),
        ProxyRequests:  GetFlag("ProxyRequests")
    };

    const injected = `
<base href="${EscapeHtml(baseUrl)}">
<script>
${RewriteSrcset.toString()}
${MakeProxyUrl.toString()}
(${OwObFrameAgent.toString()})(${SafeJson(agentOptions)});
<\/script>`;

    // 插在 <head> 之後；沒有 <head> 時放最前面
    const finalHtml = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, match => match + injected)
        : injected + html;

    // 取得標題
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    tab.Title = titleMatch && titleMatch[1].trim()
        ? DecodeEntities(titleMatch[1].trim())
        : GetHostname(baseUrl);
    UpdateTabHeader(tab);

    const frame = CreateFrame(tab);
    frame.srcdoc = finalHtml;
    SetTabContent(tab, frame, true);
    tab.HasAgent = true;

    if (refresh) {
        const expectedUrl = GetTabUrl(tab);
        setTimeout(() => {
            // 期間使用者已切換頁面則不跳轉
            if (GetTabUrl(tab) === expectedUrl) {
                Navigate(tab, refresh.Url);
            }
        }, refresh.DelayMs);
    }
}

/**
 * 解析 <meta http-equiv="refresh" content="秒數; url=網址">
 * @returns {{ Url: string, DelayMs: number } | null}
 */
function ExtractMetaRefresh(html, baseUrl) {
    const tagMatch = html.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i);
    if (!tagMatch) return null;

    const contentMatch = tagMatch[0].match(/content\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!contentMatch) return null;

    const content  = DecodeEntities(contentMatch[2]);
    const urlMatch = content.match(/url\s*=\s*['"]?([^'"]+)['"]?/i);
    if (!urlMatch) return null;

    try {
        const target = new URL(urlMatch[1].trim(), baseUrl).toString();
        if (!IsWebUrl(target)) return null;
        const seconds = parseFloat(content) || 0;
        return { Url: target, DelayMs: Clamp(seconds, 0, 10) * 1000 };
    } catch {
        return null;
    }
}

/** 非 HTML 內容直接顯示 */
function RenderRawInFrame(tab, url) {
    let name = url.split("/").pop() || url;
    try {
        name = decodeURIComponent(name);
    } catch {
        /* 保留原字串 */
    }
    tab.Title = name || GetHostname(url);
    UpdateTabHeader(tab);

    const frame = CreateFrame(tab);
    frame.src = BuildProxyUrl(url);
    SetTabContent(tab, frame, true);
    tab.HasAgent = false;
}

/** 建立沙箱 iframe，並套用分頁縮放 */
function CreateFrame(tab) {
    const frame = document.createElement("iframe");
    // 內容頁位於獨立 Cloudflare Worker origin，可安全提供正常 Cookie / Storage origin。
    // 不授予 allow-popups：新視窗一律交回 OwO 內部分頁處理。
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-modals allow-downloads");
    frame.setAttribute("referrerpolicy", "unsafe-url");
    frame.dataset.tabId = String(tab.Id);
    ApplyFrameZoom(frame, tab.Zoom);
    return frame;
}

/* ============================================================
 * 13. iframe 代理程式
 *     此函式「不會」在主頁面執行，而是以原始碼形式注入每個外部頁面的
 *     沙箱 iframe 內（見 RenderHtmlInFrame），因此：
 *       - 不可引用外部變數，只能使用參數 Options 與同時注入的
 *         RewriteSrcset / MakeProxyUrl
 *       - 原始碼內不可出現結束 script 標籤的字串
 *
 *     功能：
 *       1. 連結點擊、表單送出 → 交回 OwOb 經代理導覽
 *       2. 動態加入 / 修改的圖片、影音（及選用的腳本）→ 改為代理網址
 *       3. fetch / XMLHttpRequest → 經代理送出
 *       4. 頁內搜尋（Ctrl+F）
 *       5. 快捷鍵轉送（焦點在 iframe 內時，OwOb 快捷鍵仍可使用）
 * ============================================================ */

function OwObFrameAgent(Options) {
    "use strict";

    /* ---------- 共用 ---------- */

    var ProxyOrigin = "";
    try {
        ProxyOrigin = new URL(Options.ProxyBase).origin;
    } catch (error) {
        ProxyOrigin = "";
    }

    /** 傳訊息給 OwOb */
    function Send(message) {
        message.OwOb  = true;
        message.TabId = Options.TabId;
        parent.postMessage(message, "*");
    }

    /** 轉為絕對網址；失敗回傳 null */
    function ToAbsolute(url) {
        try {
            return new URL(url, document.baseURI).href;
        } catch (error) {
            return null;
        }
    }

    /** 絕對網址是否需要經代理 */
    function ShouldProxy(absolute) {
        return Boolean(absolute) &&
            /^https?:\/\//i.test(absolute) &&
            (!ProxyOrigin || absolute.indexOf(ProxyOrigin + "/") !== 0);
    }

    /** 將網址轉為代理網址；不需轉換時回傳原值 */
    function ToProxy(url) {
        var text = String(url == null ? "" : url).trim();
        if (!text || /^(data:|blob:|about:|javascript:|#)/i.test(text)) return url;
        var absolute = ToAbsolute(text);
        return ShouldProxy(absolute) ? MakeProxyUrl(Options.ProxyBase, Options.ProxyKey, absolute) : url;
    }

    /* ---------- 1. 新視窗攔截 ---------- */

    /**
     * 攔截網頁腳本的 window.open()，避免跳到外層真實瀏覽器。
     * 有有效網址時，一律交回 OwO Simple Browser 建立內部分頁。
     * 回傳一個最小相容物件，避免網站因檢查回傳值而中斷後續流程。
     */
    window.open = function (url) {
        var absolute = ToAbsolute(url);
        if (absolute && /^https?:\/\//i.test(absolute)) {
            Send({ Type: "OpenTab", Url: absolute });
        }

        return {
            closed: false,
            opener: window,
            close: function () { this.closed = true; },
            focus: function () {},
            blur: function () {},
            postMessage: function () {}
        };
    };

    /* ---------- 1. 連結點擊 ---------- */

    document.addEventListener("click", function (event) {
        var link = event.target && event.target.closest && event.target.closest("a[href]");
        if (!link || event.defaultPrevented) return;

        var href = link.getAttribute("href") || "";
        if (href.charAt(0) === "#" || /^(javascript|mailto|tel|data|blob):/i.test(href)) return;

        event.preventDefault();
        event.stopPropagation();
        var absolute = ToAbsolute(link.getAttribute("href") || link.href);
        if (!absolute || !/^https?:\/\//i.test(absolute)) return;
        var newTab = link.target === "_blank" || event.ctrlKey || event.metaKey || event.button === 1;
        Send({ Type: newTab ? "OpenTab" : "Navigate", Url: absolute });
    }, true);

    /* ---------- 1. 表單送出（GET / POST） ---------- */

    document.addEventListener("submit", function (event) {
        var form = event.target;
        event.preventDefault();

        // 收集表單資料（含被按下的 submit 按鈕名稱與值）
        var submitter = event.submitter || null;
        var data;
        try {
            data = new FormData(form, submitter);
        } catch (error) {
            data = new FormData(form);
            if (submitter && submitter.name) data.append(submitter.name, submitter.value || "");
        }

        // 轉為 urlencoded；不支援檔案上傳
        var params  = new URLSearchParams();
        var hasFile = false;
        data.forEach(function (value, key) {
            if (typeof value === "string") {
                params.append(key, value);
            } else if (value && value.size > 0) {
                hasFile = true;
            }
        });

        if (hasFile) {
            Send({ Type: "Toast", Message: "含檔案上傳的表單無法經由代理送出" });
            return;
        }

        // srcdoc 的 location 是 about:srcdoc，因此以 <base> 網址為基準
        var actionAttr = (submitter && submitter.getAttribute("formaction")) || form.getAttribute("action");
        var action     = new URL(actionAttr || document.baseURI, document.baseURI);
        var methodAttr = (submitter && submitter.getAttribute("formmethod")) || form.getAttribute("method") || "get";

        if (methodAttr.toLowerCase() === "post") {
            Send({ Type: "Post", Url: action.href, Body: params.toString() });
        } else {
            action.search = params.toString();
            Send({ Type: "Navigate", Url: action.href });
        }
    }, true);

    /* ---------- 2. 動態資源改寫 ---------- */

    // 各標籤需要改寫的屬性
    var ResourceRules = {
        IMG:    ["src", "srcset"],
        SOURCE: ["src", "srcset"],
        VIDEO:  ["src", "poster"],
        AUDIO:  ["src"],
        TRACK:  ["src"],
        EMBED:  ["src"],
        INPUT:  ["src"],
        SCRIPT: ["src"]
    };

    var NativeSetAttribute = Element.prototype.setAttribute;

    /** 此元素是否需要改寫 */
    function IsRewritable(element) {
        if (!element || !ResourceRules[element.tagName]) return false;
        if (element.tagName === "SCRIPT") {
            var type = String(element.getAttribute("type") || "").toLowerCase();
            return Options.ProxyScripts && type !== "module";
        }
        return Options.ProxyResources;
    }

    /** 依屬性類型改寫值 */
    function MapAttribute(name, value) {
        return /srcset$/i.test(name) ? RewriteSrcset(value, ToProxy) : ToProxy(value);
    }

    /** 檢查並改寫元素現有屬性 */
    function FixElement(element) {
        if (!IsRewritable(element)) return;
        ResourceRules[element.tagName].forEach(function (name) {
            var value = element.getAttribute(name);
            if (!value) return;
            var next = MapAttribute(name, value);
            if (next !== value) NativeSetAttribute.call(element, name, next);
        });
    }

    /** 檢查節點及其子孫 */
    function FixTree(node) {
        if (!node || node.nodeType !== 1) return;
        FixElement(node);
        if (node.querySelectorAll) {
            var list = node.querySelectorAll("img,source,video,audio,track,embed,input,script");
            for (var i = 0; i < list.length; i++) FixElement(list[i]);
        }
    }

    /** 攔截屬性設定（例如 img.src = "..."） */
    function HookProperty(Ctor, property) {
        if (!Ctor || !Ctor.prototype) return;
        var descriptor = Object.getOwnPropertyDescriptor(Ctor.prototype, property);
        if (!descriptor || !descriptor.set || !descriptor.configurable) return;

        Object.defineProperty(Ctor.prototype, property, {
            configurable: true,
            enumerable:   descriptor.enumerable,
            get:          descriptor.get,
            set: function (value) {
                if (IsRewritable(this) && value != null) {
                    value = MapAttribute(property, String(value));
                }
                descriptor.set.call(this, value);
            }
        });
    }

    if (Options.ProxyResources || Options.ProxyScripts) {
        HookProperty(window.HTMLImageElement,  "src");
        HookProperty(window.HTMLImageElement,  "srcset");
        HookProperty(window.HTMLSourceElement, "src");
        HookProperty(window.HTMLSourceElement, "srcset");
        HookProperty(window.HTMLMediaElement,  "src");
        HookProperty(window.HTMLVideoElement,  "poster");
        HookProperty(window.HTMLTrackElement,  "src");
        HookProperty(window.HTMLEmbedElement,  "src");
        HookProperty(window.HTMLInputElement,  "src");
        HookProperty(window.HTMLScriptElement, "src");

        // 攔截 setAttribute("src", ...)
        Element.prototype.setAttribute = function (name, value) {
            var lower = String(name).toLowerCase();
            if (IsRewritable(this) && ResourceRules[this.tagName].indexOf(lower) !== -1 && value != null) {
                value = MapAttribute(lower, String(value));
            }
            return NativeSetAttribute.call(this, name, value);
        };

        // 後備：監看新加入的節點與屬性變更（例如延遲載入把 data-src 搬到 src）
        new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === "attributes") {
                    FixElement(mutation.target);
                } else {
                    for (var i = 0; i < mutation.addedNodes.length; i++) FixTree(mutation.addedNodes[i]);
                }
            });
        }).observe(document.documentElement, {
            childList:       true,
            subtree:         true,
            attributes:      true,
            attributeFilter: ["src", "srcset", "poster"]
        });
    }

    /* ---------- 3. fetch / XMLHttpRequest 經代理 ---------- */

    if (Options.ProxyRequests) {
        var NativeFetch = window.fetch;
        if (typeof NativeFetch === "function") {
            window.fetch = function (input, init) {
                try {
                    if (typeof input === "string" || input instanceof URL) {
                        input = ToProxy(String(input));
                    } else if (input && typeof input.url === "string") {
                        var proxied = ToProxy(input.url);
                        if (proxied !== input.url) input = new Request(proxied, input);
                    }
                } catch (error) {
                    /* 改寫失敗時以原請求送出 */
                }
                return NativeFetch.call(this, input, init);
            };
        }

        var NativeOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            var args = Array.prototype.slice.call(arguments);
            try {
                args[1] = ToProxy(String(url));
            } catch (error) {
                /* 改寫失敗時以原網址送出 */
            }
            return NativeOpen.apply(this, args);
        };
    }

    /* ---------- 4. 頁內搜尋 ---------- */

    var FindText  = "";
    var FindIndex = 0;

    /** 計算符合數量（不分大小寫） */
    function CountMatches(text) {
        var body   = String((document.body && document.body.innerText) || "").toLowerCase();
        var needle = text.toLowerCase();
        if (!needle) return 0;

        var count = 0;
        var index = body.indexOf(needle);
        while (index !== -1) {
            count++;
            index = body.indexOf(needle, index + needle.length);
        }
        return count;
    }

    function ClearSelection() {
        var selection = window.getSelection && window.getSelection();
        if (selection) selection.removeAllRanges();
    }

    function HandleFind(command) {
        var text = String(command.Text || "");

        if (!text) {
            FindText  = "";
            FindIndex = 0;
            ClearSelection();
            Send({ Type: "FindResult", Count: 0, Index: 0, Empty: true });
            return;
        }

        var count = CountMatches(text);
        var found = false;

        if (typeof window.find === "function") {
            if (command.Restart || text !== FindText) {
                // 新關鍵字：從頁首開始
                FindText = text;
                ClearSelection();
                found     = window.find(text, false, false, true, false, false, false);
                FindIndex = found ? 1 : 0;
            } else {
                found = window.find(text, false, Boolean(command.Backwards), true, false, false, false);
                if (found && count > 0) {
                    FindIndex = command.Backwards
                        ? (FindIndex <= 1 ? count : FindIndex - 1)
                        : (FindIndex >= count ? 1 : FindIndex + 1);
                }
            }
        }

        Send({ Type: "FindResult", Count: count, Index: found ? Math.min(FindIndex, count) : 0 });
    }

    window.addEventListener("message", function (event) {
        if (event.source !== parent) return;
        var data = event.data;
        if (!data || data.OwObCommand !== true) return;

        if (data.Type === "Find") {
            HandleFind(data);
        } else if (data.Type === "ClearFind") {
            FindText  = "";
            FindIndex = 0;
            ClearSelection();
        }
    });

    /* ---------- 5. 快捷鍵轉送 ---------- */

    document.addEventListener("keydown", function (event) {
        var key  = String(event.key || "").toLowerCase();
        var ctrl = event.ctrlKey || event.metaKey;
        var alt  = event.altKey;

        var isShortcut =
            (ctrl && !alt && ["f", "k", "l", "d", "=", "+", "-", "0"].indexOf(key) !== -1) ||
            (alt && !ctrl && ["t", "w", "arrowleft", "arrowright"].indexOf(key) !== -1) ||
            (key === "f5" && !ctrl);

        if (!isShortcut) return;

        event.preventDefault();
        event.stopPropagation();
        Send({ Type: "Key", Key: key, Ctrl: ctrl, Alt: alt, Shift: event.shiftKey });
    }, true);
}

/* ============================================================
 * 14. iframe 訊息接收
 * ============================================================ */

window.addEventListener("message", event => {
    const data = event.data;
    if (!data || (data.OwOb !== true && data.OwOContent !== true)) return;

    const tab = GetTabById(data.TabId) || State.Tabs.find(item => {
        const candidate = item.ViewEl.querySelector("iframe");
        return candidate && event.source === candidate.contentWindow;
    });
    if (!tab) return;

    // 確認訊息確實來自該分頁的 iframe
    const frame = tab.ViewEl.querySelector("iframe");
    if (!frame || event.source !== frame.contentWindow) return;

    switch (data.Type) {
        case "Title":
            if (typeof data.Title === "string" && data.Title.trim()) {
                tab.Title = data.Title.trim();
                UpdateTabHeader(tab);
                UpdateHistoryTitle(GetTabUrl(tab), tab.Title);
            }
            break;

        case "Loaded":
            SetLoading(tab, false);
            break;

        case "Navigate":
            if (IsWebUrl(data.Url)) Navigate(tab, NormalizeNavigatedUrl(data.Url));
            break;

        case "OpenTab":
            if (IsWebUrl(data.Url)) CreateTab(NormalizeNavigatedUrl(data.Url), true, { AfterId: tab.Id });
            break;

        case "Post":
            if (IsWebUrl(data.Url) && typeof data.Body === "string") {
                Navigate(tab, data.Url, true, {
                    Body:    data.Body,
                    Referer: GetTabUrl(tab)
                });
            }
            break;

        case "Toast":
            if (typeof data.Message === "string") ShowToast(data.Message);
            break;

        case "Key":
            if (tab.Id === State.ActiveId) {
                HandleShortcut({
                    Key:   String(data.Key || ""),
                    Ctrl:  Boolean(data.Ctrl),
                    Alt:   Boolean(data.Alt),
                    Shift: Boolean(data.Shift)
                });
            }
            break;

        case "FindResult":
            if (tab.Id === State.ActiveId) {
                UpdateFindStatus(Number(data.Count) || 0, Number(data.Index) || 0, Boolean(data.Empty));
            }
            break;
    }
});

/* ============================================================
 * 15. 頁內搜尋 / 縮放
 * ============================================================ */

/* ---------- 頁內搜尋 ---------- */

/** 開啟搜尋列 */
function OpenFindBar() {
    const tab = GetActiveTab();
    if (!tab) return;

    if (!tab.HasAgent) {
        ShowToast(IsInternalUrl(GetTabUrl(tab)) ? "內部頁面不支援頁內搜尋" : "此頁面類型不支援頁內搜尋");
        return;
    }

    State.Find.Open    = true;
    Dom.FindBar.hidden = false;
    Dom.FindInput.focus();
    Dom.FindInput.select();

    if (Dom.FindInput.value) SendFind({ Restart: true });
}

/** 關閉搜尋列並清除選取 */
function CloseFindBar() {
    if (!State.Find.Open) return;

    State.Find.Open    = false;
    Dom.FindBar.hidden = true;
    PostToFrame(GetActiveTab(), { Type: "ClearFind" });
}

/** 傳送指令給分頁的 iframe 代理程式 */
function PostToFrame(tab, message) {
    if (!tab || !tab.HasAgent) return false;
    const frame = tab.ViewEl.querySelector("iframe");
    if (!frame || !frame.contentWindow) return false;

    frame.contentWindow.postMessage({ OwObCommand: true, OwOContent: true, ...message }, "*");
    return true;
}

/** 送出搜尋 */
function SendFind({ Backwards = false, Restart = false } = {}) {
    const sent = PostToFrame(GetActiveTab(), {
        Type:      "Find",
        Text:      Dom.FindInput.value,
        Backwards,
        Restart
    });
    if (!sent) UpdateFindStatus(0, 0, !Dom.FindInput.value);
}

/** 更新搜尋結果顯示 */
function UpdateFindStatus(count, index, empty = false) {
    if (empty) {
        Dom.FindStatus.textContent = "";
        Dom.FindBar.classList.remove("NoMatch");
        return;
    }
    Dom.FindStatus.textContent = count > 0 ? `${index}/${count}` : "無符合";
    Dom.FindBar.classList.toggle("NoMatch", count === 0);
}

/** 切換分頁或導覽時重設搜尋狀態 */
function ResetFindStatus() {
    if (!Dom.FindStatus) return;
    UpdateFindStatus(0, 0, true);
    if (State.Find.Open) {
        CloseFindBar();
    }
}

/* ---------- 縮放 ----------
 * 沙箱 iframe 無法從外部調整內容縮放，因此以 CSS transform 縮放整個 iframe：
 * 寬高設為 (100 / 倍率)%，再 scale(倍率)，視覺上剛好填滿內容區。
 */

function ApplyFrameZoom(frame, zoom) {
    if (!frame) return;

    if (zoom === 1) {
        frame.style.width     = "";
        frame.style.height    = "";
        frame.style.transform = "";
        return;
    }

    frame.style.width           = `${100 / zoom}%`;
    frame.style.height          = `${100 / zoom}%`;
    frame.style.transform       = `scale(${zoom})`;
    frame.style.transformOrigin = "0 0";
}

/**
 * 調整目前分頁縮放
 * @param {number} step  +1 放大、-1 縮小、0 重設
 * @returns {boolean} 是否有處理（內部頁面不處理，交由瀏覽器）
 */
function ChangeZoom(step) {
    const tab = GetActiveTab();
    if (!tab || IsInternalUrl(GetTabUrl(tab))) return false;

    const levels = Config.ZoomLevels;
    if (step === 0) {
        tab.Zoom = 1;
    } else {
        // 找出目前最接近的級距再移動
        let index = levels.findIndex(level => level >= tab.Zoom - 0.001);
        if (index === -1) index = levels.length - 1;
        tab.Zoom = levels[Clamp(index + step, 0, levels.length - 1)];
    }

    ApplyFrameZoom(tab.ViewEl.querySelector("iframe"), tab.Zoom);
    RefreshToolbar();
    ShowToast(`縮放 ${Math.round(tab.Zoom * 100)}%`);
    return true;
}

/* ============================================================
 * 16. 主題 / 備份 / 隱藏分頁
 * ============================================================ */

/** 套用主題（預設亮色） */
function ApplyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("theme-dark",  isDark);
    document.body.classList.toggle("theme-light", !isDark);

    Dom.ThemeButton.innerHTML = isDark
        ? '<i class="fa-solid fa-sun"></i>'
        : '<i class="fa-solid fa-moon"></i>';
    Dom.ThemeButton.title = isDark ? "切換為亮色" : "切換為深色";

    localStorage.setItem(Config.StorageKeys.Theme, isDark ? "dark" : "light");
}

function ToggleTheme() {
    ApplyTheme(document.body.classList.contains("theme-dark") ? "light" : "dark");
}

/** 清除瀏覽資料（紀錄、已開啟分頁、Cookie）；保留設定、書籤與捷徑 */
function ClearBrowsingData() {
    [
        Config.StorageKeys.History,
        Config.StorageKeys.OpenTabs,
        Config.StorageKeys.ActiveTab,
        Config.StorageKeys.Cookies
    ].forEach(key => localStorage.removeItem(key));

    sessionStorage.clear();
    State.ClosedTabs = [];
    ShowToast("已清除瀏覽紀錄、分頁與 Cookie");
}

/* ---------- 匯出 / 匯入設定 ---------- */

// 可匯出的字串設定
const ExportStringKeys = ["Theme", "ProxyBase", "ProxyKey", "TimeoutSec"];
// 可匯出的開關設定
const ExportFlagKeys   = Object.keys(Config.DefaultFlags);

/** 匯出設定為 JSON 檔 */
function ExportSettings() {
    const data = {};

    ExportStringKeys.forEach(name => {
        const value = localStorage.getItem(Config.StorageKeys[name]);
        if (value !== null) data[name] = value;
    });
    ExportFlagKeys.forEach(name => {
        data[name] = GetFlag(name);
    });
    data.Bookmarks = LoadBookmarks();
    data.Shortcuts = LoadShortcuts();

    const payload = {
        App:        "OwOb",              // 格式識別碼維持不變，與舊版匯出檔相容
        Version:    1,
        ExportedAt: new Date().toISOString(),
        Data:       data
    };

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const blob  = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link  = document.createElement("a");
    link.href     = URL.createObjectURL(blob);
    link.download = `OwO-Simple-Browser-Settings-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);

    ShowToast("已匯出設定");
}

/** 由檔案匯入設定 */
async function ImportSettings(file) {
    let payload;
    try {
        payload = JSON.parse(await file.text());
    } catch {
        ShowToast("匯入失敗：檔案不是有效的 JSON");
        return;
    }

    if (!payload || payload.App !== "OwOb" || typeof payload.Data !== "object" || payload.Data === null) {
        ShowToast("匯入失敗：不是 OwO Simple Browser 設定檔");
        return;
    }

    const data = payload.Data;

    ExportStringKeys.forEach(name => {
        if (typeof data[name] === "string") {
            localStorage.setItem(Config.StorageKeys[name], data[name]);
        }
    });

    // 代理網址需通過格式檢查
    if (typeof data.ProxyBase === "string" && !NormalizeProxyBase(data.ProxyBase)) {
        localStorage.removeItem(Config.StorageKeys.ProxyBase);
    }

    ExportFlagKeys.forEach(name => {
        if (typeof data[name] === "boolean") SetFlag(name, data[name]);
    });

    if (Array.isArray(data.Bookmarks)) {
        SaveBookmarks(data.Bookmarks
            .filter(item => item && typeof item.Url === "string" && IsWebUrl(item.Url))
            .map(item => ({
                Id:    typeof item.Id === "string" ? item.Id : CreateId(),
                Url:   item.Url,
                Title: typeof item.Title === "string" ? item.Title : "",
                Time:  Number(item.Time) || Date.now()
            })));
    }

    if (Array.isArray(data.Shortcuts)) {
        SaveShortcuts(data.Shortcuts
            .filter(item => item && typeof item.Url === "string" && (IsWebUrl(item.Url) || IsInternalUrl(item.Url)))
            .map(item => {
                const entry = { Name: typeof item.Name === "string" ? item.Name : item.Url, Url: item.Url };
                if (typeof item.Icon === "string" && /^fa-[\w\s-]+$/.test(item.Icon)) entry.Icon = item.Icon;
                return entry;
            }));
    }

    ApplyTheme(localStorage.getItem(Config.StorageKeys.Theme) || "light");
    ShowToast("已匯入設定");

    // 重新整理目前的內部頁面以反映新設定
    const tab = GetActiveTab();
    if (tab && IsInternalUrl(GetTabUrl(tab))) {
        RenderInternalPage(tab, GetTabUrl(tab));
    }
    RefreshToolbar();
}

/** 在 about:blank 視窗中開啟 OwO Simple Browser */
function OpenCloaked() {
    const win = window.open("about:blank", "_blank");
    if (!win) {
        ShowToast("彈出視窗被封鎖，請允許後再試");
        return;
    }

    win.document.title = "新分頁";
    win.document.body.style.margin = "0";

    const frame = win.document.createElement("iframe");
    frame.src = location.href;
    frame.style.cssText = "border:none;width:100vw;height:100vh;display:block";
    win.document.body.appendChild(frame);
}

/* ============================================================
 * 17. 快捷鍵、事件綁定與初始化
 * ============================================================ */

/**
 * 處理快捷鍵（主頁面與 iframe 轉送共用）
 * Ctrl+T / Ctrl+W 會被瀏覽器保留，故分頁操作改用 Alt
 * @param {{ Key: string, Ctrl: boolean, Alt: boolean, Shift: boolean }} info  Key 為小寫
 * @returns {boolean} 是否已處理
 */
function HandleShortcut({ Key, Ctrl, Alt, Shift }) {
    if (Ctrl && !Alt) {
        switch (Key) {
            case "k": {
                const input = GetActiveTab()?.ViewEl.querySelector(".StartSearch input");
                (input || Dom.AddressInput).focus();
                return true;
            }
            case "l":
                Dom.AddressInput.focus();
                return true;
            case "f":
                OpenFindBar();
                return true;
            case "d":
                ToggleBookmark();
                return true;
            case "=":
            case "+":
                return ChangeZoom(1);
            case "-":
                return ChangeZoom(-1);
            case "0":
                return ChangeZoom(0);
        }
    }

    if (Alt && !Ctrl) {
        switch (Key) {
            case "t":
                if (Shift) ReopenClosedTab();
                else CreateTab();
                return true;
            case "w":
                if (State.ActiveId) CloseTab(State.ActiveId);
                return true;
            case "arrowleft":
                GoBack();
                return true;
            case "arrowright":
                GoForward();
                return true;
        }
    }

    if (Key === "f5" && !Ctrl) {
        Reload();
        return true;
    }

    return false;
}

function BindEvents() {
    /* ---------- 工具列 ---------- */
    Dom.AddTabButton.addEventListener("click", () => CreateTab());
    Dom.BackButton.addEventListener("click", GoBack);
    Dom.ForwardButton.addEventListener("click", GoForward);
    Dom.ReloadButton.addEventListener("click", Reload);
    Dom.ThemeButton.addEventListener("click", ToggleTheme);
    Dom.BookmarkButton.addEventListener("click", () => ToggleBookmark());
    Dom.ZoomButton.addEventListener("click", () => ChangeZoom(0));

    Dom.HomeButton.addEventListener("click", () => {
        const tab = GetActiveTab();
        if (tab) Navigate(tab, Config.HomeUrl);
    });

    Dom.SettingsButton.addEventListener("click", () => {
        const tab = GetActiveTab();
        if (tab) Navigate(tab, "owob://settings");
    });

    /* ---------- 網址列與自動完成 ---------- */
    Dom.AddressForm.addEventListener("submit", event => {
        event.preventDefault();
        if (State.Suggest.Index >= 0) {
            OpenSuggestion(State.Suggest.Index);
            return;
        }
        HideSuggestions();
        NavigateFromInput(Dom.AddressInput.value);
        Dom.AddressInput.blur();
    });

    Dom.AddressInput.addEventListener("focus", () => Dom.AddressInput.select());
    Dom.AddressInput.addEventListener("input", UpdateSuggestions);
    Dom.AddressInput.addEventListener("blur", () => {
        HideSuggestions();
        RefreshToolbar();
    });

    Dom.AddressInput.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            MoveSuggestion(1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            MoveSuggestion(-1);
        } else if (event.key === "Escape") {
            if (!Dom.SuggestList.hidden) {
                HideSuggestions();
            } else {
                Dom.AddressInput.blur();
            }
        }
    });

    // 使用 mousedown：在輸入框 blur（隱藏清單）之前觸發
    Dom.SuggestList.addEventListener("mousedown", event => {
        const item = event.target.closest("[data-index]");
        if (!item) return;
        event.preventDefault();
        OpenSuggestion(Number(item.dataset.index));
    });

    /* ---------- 頁內搜尋列 ---------- */
    Dom.FindInput.addEventListener("input", () => SendFind({ Restart: true }));
    Dom.FindInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            SendFind({ Backwards: event.shiftKey });
        } else if (event.key === "Escape") {
            event.preventDefault();
            CloseFindBar();
        }
    });
    Dom.FindPrevButton.addEventListener("click", () => SendFind({ Backwards: true }));
    Dom.FindNextButton.addEventListener("click", () => SendFind());
    Dom.FindCloseButton.addEventListener("click", CloseFindBar);

    /* ---------- 匯入設定 ---------- */
    Dom.ImportInput.addEventListener("change", () => {
        const file = Dom.ImportInput.files && Dom.ImportInput.files[0];
        if (file) ImportSettings(file);
    });

    /* ---------- 右鍵選單關閉 ---------- */
    document.addEventListener("mousedown", event => {
        if (ActiveContextMenu && !ActiveContextMenu.contains(event.target)) HideContextMenu();
    });
    window.addEventListener("blur", HideContextMenu);
    window.addEventListener("resize", HideContextMenu);

    /* ---------- 全域快捷鍵 ---------- */
    document.addEventListener("keydown", event => {
        // 對話框開啟時不處理
        if (document.querySelector(".DialogOverlay")) return;

        if (event.key === "Escape") {
            if (ActiveContextMenu) {
                HideContextMenu();
                return;
            }
            if (State.Find.Open) {
                CloseFindBar();
                return;
            }
        }

        const handled = HandleShortcut({
            Key:   String(event.key || "").toLowerCase(),
            Ctrl:  event.ctrlKey || event.metaKey,
            Alt:   event.altKey,
            Shift: event.shiftKey
        });
        if (handled) event.preventDefault();
    });
}

/** 初始化（只使用 DOMContentLoaded，不覆寫 window.onload） */
document.addEventListener("DOMContentLoaded", () => {
    localStorage.removeItem("OwOb.SearchEngine");   // 移除舊版搜尋引擎選擇
    ApplyTheme(localStorage.getItem(Config.StorageKeys.Theme) || "light");
    BindEvents();
    RestoreTabs();
});
