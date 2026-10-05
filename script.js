/* ============================================================
 *  OwOb Browser - 主程式
 *  架構：
 *    1. 設定與狀態
 *    2. 工具函式
 *    3. Cookie 罐（保存目標網站 Cookie，讓驗證 / 登入狀態可延續）
 *    4. 分頁管理（建立 / 切換 / 關閉 / 還原）
 *    5. 導覽（網址解析 / 上下頁 / 重新整理）
 *    6. 內部頁面（owob://start、settings、history）
 *    7. 外部頁面（經由自架 CORS 代理載入，支援 GET / POST）
 *    8. iframe 內連結 / 表單攔截（postMessage）
 *    9. 主題 / 歷史紀錄 / 隱藏分頁
 *   10. 事件綁定與初始化
 * ============================================================ */

"use strict";


/* ============================================================
 *  1. 設定與狀態
 * ============================================================ */

const Config = {
    // 自架 Cloudflare Worker 代理
    ProxyBase: "https://owob-proxy.kkwan812.workers.dev/?url=",

    // 代理請求逾時（毫秒）
    FetchTimeoutMs: 15000,

    // 首頁網址
    HomeUrl: "owob://start",

    // 歷史紀錄最大筆數
    MaxHistory: 200,

    // 搜尋引擎（DuckDuckGo HTML 版不需要 JavaScript，最適合代理顯示）
    SearchEngines: {
        DuckDuckGo: "https://html.duckduckgo.com/html/?q=",
        Bing:       "https://www.bing.com/search?q=",
        Google:     "https://www.google.com/search?q="
    },

    // localStorage 鍵名
    StorageKeys: {
        Theme:        "OwOb.Theme",
        Engine:       "OwOb.SearchEngine",
        History:      "OwOb.History",
        OpenTabs:     "OwOb.OpenTabs",
        ActiveTab:    "OwOb.ActiveTab",
        Cookies:      "OwOb.Cookies"
    },

    // 首頁捷徑
    Shortcuts: [
        { Name: "Wikipedia",  Icon: "fa-brands fa-wikipedia-w", Url: "https://zh.wikipedia.org/" },
        { Name: "GitHub",     Icon: "fa-brands fa-github",      Url: "https://github.com/" },
        { Name: "Hacker News",Icon: "fa-brands fa-hacker-news", Url: "https://news.ycombinator.com/" },
        { Name: "Example",    Icon: "fa-solid fa-globe",        Url: "https://example.com/" },
        { Name: "設定",        Icon: "fa-solid fa-gear",         Url: "owob://settings" }
    ]
};

const State = {
    Tabs: [],          // { Id, History: [url], Index, Title, Loading, TabEl, ViewEl, Abort }
    ActiveId: null,
    NextId: 1
};

// DOM 參照
const Dom = {
    TabList:        document.getElementById("TabList"),
    ViewArea:       document.getElementById("ViewArea"),
    AddTabButton:   document.getElementById("AddTabButton"),
    BackButton:     document.getElementById("BackButton"),
    ForwardButton:  document.getElementById("ForwardButton"),
    ReloadButton:   document.getElementById("ReloadButton"),
    HomeButton:     document.getElementById("HomeButton"),
    ThemeButton:    document.getElementById("ThemeButton"),
    SettingsButton: document.getElementById("SettingsButton"),
    AddressForm:    document.getElementById("AddressForm"),
    AddressInput:   document.getElementById("AddressInput"),
    AddressIcon:    document.getElementById("AddressIcon"),
    LoadingBar:     document.getElementById("LoadingBar"),
    Toast:          document.getElementById("Toast")
};


/* ============================================================
 *  2. 工具函式
 * ============================================================ */

/** HTML 跳脫，避免插入內部頁面時被解析成標籤 */
function EscapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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

/** 取得目前分頁 */
function GetActiveTab() {
    return State.Tabs.find(tab => tab.Id === State.ActiveId) || null;
}

/** 取得分頁目前網址 */
function GetTabUrl(tab) {
    return tab.History[tab.Index] || Config.HomeUrl;
}

/** 是否為內部網址 */
function IsInternalUrl(url) {
    return url.toLowerCase().startsWith("owob://");
}

/**
 * 將使用者輸入轉為可導覽的網址
 *   owob://xxx         → 內部頁面
 *   含協定的網址         → 原樣
 *   像網域的字串         → 補上 https://
 *   其他                → 使用搜尋引擎
 */
function ResolveInput(input) {
    const text = input.trim();

    if (!text) {
        return Config.HomeUrl;
    }

    if (IsInternalUrl(text)) {
        return text.toLowerCase();
    }

    if (/^https?:\/\//i.test(text)) {
        return text;
    }

    const looksLikeDomain = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text) && !/\s/.test(text);
    if (looksLikeDomain) {
        return "https://" + text;
    }

    const engine = localStorage.getItem(Config.StorageKeys.Engine) || "DuckDuckGo";
    const base = Config.SearchEngines[engine] || Config.SearchEngines.DuckDuckGo;
    return base + encodeURIComponent(text);
}


/* ============================================================
 *  3. Cookie 罐
 *     代理會移除 Set-Cookie，改以 X-Proxy-Set-Cookie 回傳。
 *     這裡把 Cookie 存進 localStorage，下次請求同網域時
 *     以 X-Proxy-Cookie 送回代理，讓 DuckDuckGo 驗證結果可延續。
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

/** 取得要送給指定網址的 Cookie 字串 */
function GetCookieHeader(url) {
    let host;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }

    const jar   = LoadCookieJar();
    const pairs = [];

    Object.keys(jar).forEach(domain => {
        const isExact  = host === domain;
        const isParent = host.endsWith("." + domain);

        if (!isExact && !isParent) return;

        Object.entries(jar[domain]).forEach(([name, item]) => {
            if (isExact || !item.HostOnly) {
                pairs.push(`${name}=${item.Value}`);
            }
        });
    });

    return pairs.join("; ");
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

/** 計算目前 Cookie 總數（設定頁顯示用） */
function CountCookies() {
    const jar = LoadCookieJar();
    return Object.values(jar).reduce((sum, items) => sum + Object.keys(items).length, 0);
}


/* ============================================================
 *  4. 分頁管理
 * ============================================================ */

/** 建立新分頁 */
function CreateTab(url = Config.HomeUrl, activate = true) {
    const id = State.NextId++;

    // 分頁按鈕
    const tabEl = document.createElement("div");
    tabEl.className = "Tab";
    tabEl.dataset.id = id;
    tabEl.innerHTML = `
        <span class="TabTitle">新分頁</span>
        <button class="TabClose" title="關閉分頁"><i class="fa-solid fa-xmark"></i></button>
    `;

    tabEl.addEventListener("click", () => ActivateTab(id));
    tabEl.addEventListener("auxclick", event => {
        if (event.button === 1) CloseTab(id);   // 滑鼠中鍵關閉
    });
    tabEl.querySelector(".TabClose").addEventListener("click", event => {
        event.stopPropagation();
        CloseTab(id);
    });

    // 內容容器
    const viewEl = document.createElement("section");
    viewEl.className = "TabView";

    Dom.TabList.appendChild(tabEl);
    Dom.ViewArea.appendChild(viewEl);

    const tab = {
        Id: id,
        History: [],
        Index: -1,
        Title: "新分頁",
        Loading: false,
        TabEl: tabEl,
        ViewEl: viewEl,
        Abort: null
    };

    State.Tabs.push(tab);

    if (activate) {
        ActivateTab(id);
    }

    Navigate(tab, url);
    tabEl.scrollIntoView({ inline: "nearest" });

    return tab;
}

/** 切換分頁 */
function ActivateTab(id) {
    State.ActiveId = id;

    State.Tabs.forEach(tab => {
        const isActive = tab.Id === id;
        tab.TabEl.classList.toggle("Active", isActive);
        tab.ViewEl.classList.toggle("Active", isActive);
    });

    RefreshToolbar();
    SaveOpenTabs();
}

/** 關閉分頁 */
function CloseTab(id) {
    const index = State.Tabs.findIndex(tab => tab.Id === id);
    if (index === -1) return;

    const tab = State.Tabs[index];
    if (tab.Abort) tab.Abort.abort();

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


/* ============================================================
 *  5. 導覽
 * ============================================================ */

/**
 * 導覽至指定網址
 * @param {object}       tab       目標分頁
 * @param {string}       url       已解析的網址
 * @param {boolean}      pushState 是否寫入分頁歷史（上下頁時為 false）
 * @param {object|null}  postData  POST 表單資料 { Body, Referer }；GET 時為 null
 */
function Navigate(tab, url, pushState = true, postData = null) {
    if (pushState) {
        tab.History = tab.History.slice(0, tab.Index + 1);
        tab.History.push(url);
        tab.Index = tab.History.length - 1;
    }

    if (tab.Abort) {
        tab.Abort.abort();
        tab.Abort = null;
    }

    if (IsInternalUrl(url)) {
        RenderInternalPage(tab, url);
    } else {
        LoadExternalPage(tab, url, postData);
        AddHistoryRecord(url);
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

    const url = GetTabUrl(tab);

    // 使用者正在輸入時不覆蓋網址列
    if (document.activeElement !== Dom.AddressInput) {
        Dom.AddressInput.value = url === Config.HomeUrl ? "" : url;
    }

    Dom.BackButton.disabled = tab.Index <= 0;
    Dom.ForwardButton.disabled = tab.Index >= tab.History.length - 1;

    // 網址列圖示
    Dom.AddressIcon.className = "AddressIcon fa-solid " + (
        IsInternalUrl(url)       ? "fa-house"           :
        url.startsWith("https:") ? "fa-lock Secure"     :
        url.startsWith("http:")  ? "fa-lock-open"       :
                                   "fa-magnifying-glass"
    );

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
 *  6. 內部頁面
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
        default:
            RenderErrorPage(tab, "找不到內部頁面", `未知的內部網址：${url}`, url);
    }
}

/** 首頁 */
function RenderStartPage(tab) {
    tab.Title = "新分頁";
    UpdateTabHeader(tab);

    const currentEngine = localStorage.getItem(Config.StorageKeys.Engine) || "DuckDuckGo";

    const engineOptions = Object.keys(Config.SearchEngines)
        .map(name => `<option value="${name}" ${name === currentEngine ? "selected" : ""}>${name}</option>`)
        .join("");

    const shortcuts = Config.Shortcuts
        .map(item => `
            <button class="Shortcut" data-url="${EscapeHtml(item.Url)}">
                <i class="${item.Icon}"></i>
                <span>${EscapeHtml(item.Name)}</span>
            </button>`)
        .join("");

    tab.ViewEl.innerHTML = `
        <div class="StartPage">
            <h1 class="StartLogo">OwOb</h1>
            <form class="StartSearch" autocomplete="off">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="搜尋或輸入網址（Ctrl+K）" spellcheck="false">
                <select title="搜尋引擎">${engineOptions}</select>
            </form>
            <div class="Shortcuts">${shortcuts}</div>
        </div>
    `;

    const form = tab.ViewEl.querySelector(".StartSearch");
    const input = form.querySelector("input");
    const select = form.querySelector("select");

    form.addEventListener("submit", event => {
        event.preventDefault();
        if (input.value.trim()) Navigate(tab, ResolveInput(input.value));
    });

    select.addEventListener("change", () => {
        localStorage.setItem(Config.StorageKeys.Engine, select.value);
        ShowToast(`搜尋引擎已切換為 ${select.value}`);
    });

    tab.ViewEl.querySelectorAll(".Shortcut").forEach(button => {
        button.addEventListener("click", () => Navigate(tab, button.dataset.url));
    });

    if (tab.Id === State.ActiveId) {
        setTimeout(() => input.focus(), 0);
    }
}

/** 設定頁 */
function RenderSettingsPage(tab) {
    tab.Title = "OwOb 設定";
    UpdateTabHeader(tab);

    const isDark = document.body.classList.contains("theme-dark");

    tab.ViewEl.innerHTML = `
        <div class="InternalPage">
            <h1><i class="fa-solid fa-gear"></i> OwOb 設定</h1>

            <div class="Card">
                <h2>外觀</h2>
                <p>目前主題：${isDark ? "深色（Dark Ember）" : "亮色（預設）"}</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="light">亮色</button>
                    <button class="ActionButton" data-action="dark">深色</button>
                </div>
            </div>

            <div class="Card">
                <h2>代理伺服器</h2>
                <p>所有外部網頁都經由 <code>${EscapeHtml(Config.ProxyBase)}</code> 載入。</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="test-proxy">測試連線</button>
                </div>
            </div>

            <div class="Card">
                <h2>Cookie</h2>
                <p>目前保存 ${CountCookies()} 筆網站 Cookie（例如 DuckDuckGo 驗證通過的紀錄）。</p>
                <div class="ButtonRow">
                    <button class="ActionButton Danger" data-action="clear-cookies">清除 Cookie</button>
                </div>
            </div>

            <div class="Card">
                <h2>瀏覽紀錄</h2>
                <p>目前共 ${LoadJson(Config.StorageKeys.History, []).length} 筆紀錄。</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="history">查看紀錄</button>
                    <button class="ActionButton Danger" data-action="clear">清除所有資料</button>
                </div>
            </div>

            <div class="Card">
                <h2>隱藏分頁</h2>
                <p>在 about:blank 視窗中開啟本瀏覽器，瀏覽器分頁列只會顯示空白頁。</p>
                <div class="ButtonRow">
                    <button class="ActionButton" data-action="cloak">以 about:blank 開啟</button>
                </div>
            </div>

            <div class="Card">
                <h2>快捷鍵</h2>
                <p>
                    Ctrl+K 聚焦搜尋 ／ Ctrl+L 聚焦網址列 ／ Alt+T 新分頁 ／
                    Alt+W 關閉分頁 ／ Alt+← / Alt+→ 上一頁 / 下一頁 ／ F5 重新整理
                </p>
            </div>
        </div>
    `;

    const actions = {
        "light":         () => { ApplyTheme("light"); RenderSettingsPage(tab); },
        "dark":          () => { ApplyTheme("dark");  RenderSettingsPage(tab); },
        "test-proxy":    () => TestProxy(),
        "clear-cookies": () => { localStorage.removeItem(Config.StorageKeys.Cookies); ShowToast("已清除 Cookie"); RenderSettingsPage(tab); },
        "history":       () => Navigate(tab, "owob://history"),
        "clear":         () => { ClearAllData(); RenderSettingsPage(tab); },
        "cloak":         () => OpenCloaked()
    };

    tab.ViewEl.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", () => actions[button.dataset.action]());
    });
}

/** 歷史紀錄頁 */
function RenderHistoryPage(tab) {
    tab.Title = "瀏覽紀錄";
    UpdateTabHeader(tab);

    const records = LoadJson(Config.StorageKeys.History, []);

    const items = records.length
        ? records.map(record => `
            <li>
                <time>${new Date(record.Time).toLocaleString()}</time>
                <a href="#" data-url="${EscapeHtml(record.Url)}" title="${EscapeHtml(record.Url)}">
                    ${EscapeHtml(record.Title || record.Url)}
                </a>
            </li>`).join("")
        : "<li>尚無紀錄</li>";

    tab.ViewEl.innerHTML = `
        <div class="InternalPage">
            <h1><i class="fa-solid fa-clock-rotate-left"></i> 瀏覽紀錄</h1>
            <div class="Card">
                <ul class="HistoryList">${items}</ul>
            </div>
        </div>
    `;

    tab.ViewEl.querySelectorAll("[data-url]").forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            Navigate(tab, link.dataset.url);
        });
    });
}

/** 錯誤頁 */
function RenderErrorPage(tab, title, detail, retryUrl) {
    tab.Title = "載入失敗";
    UpdateTabHeader(tab);

    tab.ViewEl.innerHTML = `
        <div class="ErrorPage">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <h2>${EscapeHtml(title)}</h2>
            <pre>${EscapeHtml(detail)}</pre>
            <div class="ButtonRow">
                <button class="ActionButton" data-action="retry">重試</button>
                <button class="ActionButton" data-action="direct">直接開啟原網址</button>
            </div>
        </div>
    `;

    tab.ViewEl.querySelector('[data-action="retry"]')
        .addEventListener("click", () => Navigate(tab, retryUrl, false));

    tab.ViewEl.querySelector('[data-action="direct"]')
        .addEventListener("click", () => window.open(retryUrl, "_blank", "noopener"));
}


/* ============================================================
 *  7. 外部頁面（經由代理載入）
 * ============================================================ */

/**
 * 經由代理載入外部頁面
 * @param {object}      tab       目標分頁
 * @param {string}      url       目標網址
 * @param {object|null} postData  POST 資料 { Body, Referer }；null 表示 GET
 */
async function LoadExternalPage(tab, url, postData = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), Config.FetchTimeoutMs);

    tab.Abort = controller;
    tab.Title = "載入中…";
    SetLoading(tab, true);

    try {
        /* ---------- 組合代理請求 ---------- */
        const headers = {};

        const siteJar = GetSiteCookieJar(url);
        if (siteJar.length > 0) {
            headers["X-Proxy-Cookie-Jar"] = encodeURIComponent(JSON.stringify(siteJar));
        }

        const requestOptions = {
            method: "GET",
            headers,
            signal: controller.signal
        };

        if (postData) {
            requestOptions.method = "POST";
            requestOptions.body = postData.Body;
            headers["Content-Type"] = "application/x-www-form-urlencoded";

            if (postData.Referer && /^https?:\/\//i.test(postData.Referer)) {
                headers["X-Proxy-Referer"] = postData.Referer;
            }
        }

        const response = await fetch(Config.ProxyBase + encodeURIComponent(url), requestOptions);

        const contentType = response.headers.get("Content-Type") || "";
        const finalUrl = response.headers.get("X-Final-URL") || url;

        // 先保存目標網站設定的 Cookie（驗證頁的通過紀錄就在這裡）
        StoreProxyCookies(response.headers.get("X-Proxy-Set-Cookie"));

        // 代理回傳的錯誤（JSON 格式）
        if (!response.ok && contentType.includes("application/json")) {
            const data = await response.json().catch(() => ({}));
            throw new Error(`代理錯誤 ${response.status}：${data.message || response.statusText}`);
        }

        // 已被切到其他網址，捨棄結果
        if (GetTabUrl(tab) !== url) return;

        // 轉址後更新分頁網址（不新增歷史）
        if (finalUrl !== url) {
            tab.History[tab.Index] = finalUrl;
        }

        if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
            const html = await response.text();
            RenderHtmlInFrame(tab, html, finalUrl);
        } else {
            // 圖片、PDF、純文字等非 HTML 內容：直接以代理網址顯示
            RenderRawInFrame(tab, finalUrl);
        }

        if (!response.ok) {
            ShowToast(`網站回應 HTTP ${response.status}`);
        }
    } catch (error) {
        if (controller.signal.aborted && controller.signal.reason !== "timeout") {
            return;   // 使用者主動切換頁面，不顯示錯誤
        }

        // 依錯誤類型顯示對應說明：
        //   逾時          → 連線逾時
        //   代理回傳錯誤   → 直接顯示代理訊息（代理本身可連線，不是 CORS 問題）
        //   其他（TypeError: Failed to fetch）→ 代理無法連線或 CORS 被擋
        let detail;

        if (controller.signal.reason === "timeout") {
            detail = `連線逾時（超過 ${Config.FetchTimeoutMs / 1000} 秒）。`;
        } else if (error.message.startsWith("代理錯誤")) {
            detail = `${error.message}\n\n可改用「直接開啟原網址」，或在首頁切換其他搜尋引擎。`;
        } else {
            detail = `${error.message}\n\n可能原因：\n• 代理的 ALLOWED_ORIGINS 未包含目前網站來源（${location.origin}）\n• 代理尚未更新為最新版本\n• 網路連線異常`;
        }

        RenderErrorPage(tab, "無法載入此網頁", `${url}\n\n${detail}`, url);
    } finally {
        clearTimeout(timer);
        if (tab.Abort === controller) tab.Abort = null;
        SetLoading(tab, false);
        RefreshToolbar();
        SaveOpenTabs();
    }
}

/**
 * 將抓回的 HTML 放進沙箱 iframe
 *  - <base> 讓相對路徑的圖片、CSS 正確指向原網站
 *  - 注入攔截腳本，讓連結與表單回到 OwOb 處理
 *  - sandbox 不含 allow-same-origin，網頁腳本無法存取 OwOb 本身
 */
function RenderHtmlInFrame(tab, html, baseUrl) {
    const injected = `
<base href="${EscapeHtml(baseUrl)}">
<script>${BuildInterceptorScript(tab.Id)}<\/script>`;

    // 插在 <head> 之後；沒有 <head> 時放最前面
    const finalHtml = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, match => match + injected)
        : injected + html;

    // 取得標題
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    tab.Title = titleMatch ? DecodeEntities(titleMatch[1].trim()) : new URL(baseUrl).hostname;
    UpdateTabHeader(tab);

    const frame = CreateFrame();
    frame.srcdoc = finalHtml;

    tab.ViewEl.innerHTML = "";
    tab.ViewEl.appendChild(frame);
}

/** 非 HTML 內容直接顯示 */
function RenderRawInFrame(tab, url) {
    tab.Title = decodeURIComponent(url.split("/").pop() || url);
    UpdateTabHeader(tab);

    const frame = CreateFrame();
    frame.src = Config.ProxyBase + encodeURIComponent(url);

    tab.ViewEl.innerHTML = "";
    tab.ViewEl.appendChild(frame);
}

function CreateFrame() {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals allow-downloads");
    frame.setAttribute("referrerpolicy", "no-referrer");
    return frame;
}

/** 解碼標題中的 HTML 實體（如 &amp;） */
function DecodeEntities(text) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = text;
    return textarea.value;
}

/** 測試代理連線 */
async function TestProxy() {
    ShowToast("測試中…");
    const start = performance.now();

    try {
        const response = await fetch(Config.ProxyBase + encodeURIComponent("https://example.com/"));
        const ms = Math.round(performance.now() - start);
        ShowToast(response.ok ? `代理正常（${ms} ms）` : `代理回應 HTTP ${response.status}`);
    } catch (error) {
        ShowToast(`代理無法連線：${error.message}`);
    }
}


/* ============================================================
 *  8. iframe 內連結 / 表單攔截
 * ============================================================ */

/**
 * 產生注入 iframe 的腳本
 *  - 點擊連結：通知 OwOb 導覽（或開新分頁）
 *  - GET 表單：組成查詢字串後導覽
 *  - POST 表單：序列化為 urlencoded 後交給 OwOb 經代理送出
 *    （DuckDuckGo 驗證頁與 HTML 版搜尋框都是 POST 表單）
 */
function BuildInterceptorScript(tabId) {
    return `
(function () {
    var TabId = ${tabId};

    function Send(type, url, body) {
        parent.postMessage({ OwOb: true, Type: type, TabId: TabId, Url: url, Body: body || "" }, "*");
    }

    // 連結點擊
    document.addEventListener("click", function (event) {
        var link = event.target.closest && event.target.closest("a[href]");
        if (!link || event.defaultPrevented) return;

        var href = link.getAttribute("href") || "";
        if (href.charAt(0) === "#" || /^(javascript|mailto|tel):/i.test(href)) return;

        event.preventDefault();
        var newTab = link.target === "_blank" || event.ctrlKey || event.metaKey || event.button === 1;
        Send(newTab ? "OpenTab" : "Navigate", link.href);
    }, true);

    // 表單送出（GET / POST）
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
        var params = new URLSearchParams();
        var hasFile = false;
        data.forEach(function (value, key) {
            if (typeof value === "string") {
                params.append(key, value);
            } else if (value && value.size > 0) {
                hasFile = true;
            }
        });

        if (hasFile) {
            Send("Unsupported", "含檔案上傳的表單無法經由代理送出");
            return;
        }

        // srcdoc 的 location 是 about:srcdoc，因此以 <base> 網址為基準
        var actionAttr = (submitter && submitter.getAttribute("formaction")) || form.getAttribute("action");
        var action = new URL(actionAttr || document.baseURI, document.baseURI);

        var methodAttr = (submitter && submitter.getAttribute("formmethod")) || form.getAttribute("method") || "get";

        if (methodAttr.toLowerCase() === "post") {
            Send("Post", action.href, params.toString());
        } else {
            action.search = params.toString();
            Send("Navigate", action.href);
        }
    }, true);
})();`;
}

/** 接收 iframe 的導覽請求 */
window.addEventListener("message", event => {
    const data = event.data;
    if (!data || data.OwOb !== true) return;

    const tab = State.Tabs.find(item => item.Id === data.TabId);
    if (!tab) return;

    // 確認訊息確實來自該分頁的 iframe
    const frame = tab.ViewEl.querySelector("iframe");
    if (!frame || event.source !== frame.contentWindow) return;

    if (typeof data.Url !== "string") return;

    switch (data.Type) {
        case "Navigate":
            if (/^https?:\/\//i.test(data.Url)) Navigate(tab, data.Url);
            break;

        case "OpenTab":
            if (/^https?:\/\//i.test(data.Url)) CreateTab(data.Url, true);
            break;

        case "Post":
            if (/^https?:\/\//i.test(data.Url) && typeof data.Body === "string") {
                Navigate(tab, data.Url, true, {
                    Body:    data.Body,
                    Referer: GetTabUrl(tab)
                });
            }
            break;

        case "Unsupported":
            ShowToast(data.Url);
            break;
    }
});


/* ============================================================
 *  9. 主題 / 歷史紀錄 / 隱藏分頁
 * ============================================================ */

/** 套用主題（預設亮色） */
function ApplyTheme(theme) {
    const isDark = theme === "dark";

    document.body.classList.toggle("theme-dark", isDark);
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

/** 新增瀏覽紀錄（標題於載入完成後補上） */
function AddHistoryRecord(url) {
    const records = LoadJson(Config.StorageKeys.History, []);
    records.unshift({ Url: url, Title: "", Time: Date.now() });
    SaveJson(Config.StorageKeys.History, records.slice(0, Config.MaxHistory));
}

/** 清除所有本機資料（保留主題設定；Cookie 一併清除） */
function ClearAllData() {
    const theme = localStorage.getItem(Config.StorageKeys.Theme);

    localStorage.clear();
    sessionStorage.clear();

    if (theme) localStorage.setItem(Config.StorageKeys.Theme, theme);
    ShowToast("已清除瀏覽紀錄、分頁與 Cookie");
}

/** 在 about:blank 視窗中開啟 OwOb */
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
 * 10. 事件綁定與初始化
 * ============================================================ */

function BindEvents() {
    Dom.AddTabButton.addEventListener("click", () => CreateTab());
    Dom.BackButton.addEventListener("click", GoBack);
    Dom.ForwardButton.addEventListener("click", GoForward);
    Dom.ReloadButton.addEventListener("click", Reload);
    Dom.ThemeButton.addEventListener("click", ToggleTheme);

    Dom.HomeButton.addEventListener("click", () => {
        const tab = GetActiveTab();
        if (tab) Navigate(tab, Config.HomeUrl);
    });

    Dom.SettingsButton.addEventListener("click", () => {
        const tab = GetActiveTab();
        if (tab) Navigate(tab, "owob://settings");
    });

    Dom.AddressForm.addEventListener("submit", event => {
        event.preventDefault();
        NavigateFromInput(Dom.AddressInput.value);
        Dom.AddressInput.blur();
    });

    Dom.AddressInput.addEventListener("focus", () => Dom.AddressInput.select());
    Dom.AddressInput.addEventListener("blur", RefreshToolbar);

    // 快捷鍵（Ctrl+T / Ctrl+W 會被瀏覽器保留，故改用 Alt）
    document.addEventListener("keydown", event => {
        const key = event.key.toLowerCase();

        if (event.ctrlKey && key === "k") {
            event.preventDefault();
            const input = GetActiveTab()?.ViewEl.querySelector(".StartSearch input");
            (input || Dom.AddressInput).focus();
        } else if (event.ctrlKey && key === "l") {
            event.preventDefault();
            Dom.AddressInput.focus();
        } else if (event.altKey && key === "t") {
            event.preventDefault();
            CreateTab();
        } else if (event.altKey && key === "w") {
            event.preventDefault();
            if (State.ActiveId) CloseTab(State.ActiveId);
        } else if (event.altKey && key === "arrowleft") {
            event.preventDefault();
            GoBack();
        } else if (event.altKey && key === "arrowright") {
            event.preventDefault();
            GoForward();
        } else if (key === "f5" && !event.ctrlKey) {
            event.preventDefault();
            Reload();
        }
    });
}

/** 載入完成後，把頁面標題補進歷史紀錄 */
function PatchHistoryTitle(tab) {
    const records = LoadJson(Config.StorageKeys.History, []);
    const url = GetTabUrl(tab);
    const record = records.find(item => item.Url === url && !item.Title);

    if (record) {
        record.Title = tab.Title;
        SaveJson(Config.StorageKeys.History, records);
    }
}

// 在 UpdateTabHeader 之後同步歷史標題
const OriginalUpdateTabHeader = UpdateTabHeader;
UpdateTabHeader = function (tab) {           // eslint-disable-line no-func-assign
    OriginalUpdateTabHeader(tab);
    if (!tab.Loading && !IsInternalUrl(GetTabUrl(tab))) PatchHistoryTitle(tab);
};

/** 初始化（只使用 DOMContentLoaded，不覆寫 window.onload） */
document.addEventListener("DOMContentLoaded", () => {
    ApplyTheme(localStorage.getItem(Config.StorageKeys.Theme) || "light");
    BindEvents();
    RestoreTabs();
});