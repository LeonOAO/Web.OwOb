/* ============================================================
 *  OwOb Browser - 主程式
 *  架構：
 *    1. 設定與狀態
 *    2. 工具函式
 *    3. 分頁管理（建立 / 切換 / 關閉 / 還原）
 *    4. 導覽（網址解析 / 上下頁 / 重新整理）
 *    5. 內部頁面（owob://start、settings、history）
 *    6. 外部頁面（經由自架 CORS 代理載入）
 *    7. iframe 內連結 / 表單攔截（postMessage）
 *    8. 主題 / 歷史紀錄 / 隱藏分頁
 *    9. 事件綁定與初始化
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
        ActiveTab:    "OwOb.ActiveTab"
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
 *  3. 分頁管理
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
 *  4. 導覽
 * ============================================================ */

/**
 * 導覽至指定網址
 * @param {object}  tab       目標分頁
 * @param {string}  url       已解析的網址
 * @param {boolean} pushState 是否寫入分頁歷史（上下頁時為 false）
 */
function Navigate(tab, url, pushState = true) {
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
        LoadExternalPage(tab, url);
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
 *  5. 內部頁面
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
        "light":      () => { ApplyTheme("light"); RenderSettingsPage(tab); },
        "dark":       () => { ApplyTheme("dark");  RenderSettingsPage(tab); },
        "test-proxy": () => TestProxy(),
        "history":    () => Navigate(tab, "owob://history"),
        "clear":      () => { ClearAllData(); RenderSettingsPage(tab); },
        "cloak":      () => OpenCloaked()
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
 *  6. 外部頁面（經由代理載入）
 * ============================================================ */

async function LoadExternalPage(tab, url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), Config.FetchTimeoutMs);

    tab.Abort = controller;
    tab.Title = "載入中…";
    SetLoading(tab, true);

    try {
        const response = await fetch(Config.ProxyBase + encodeURIComponent(url), {
            signal: controller.signal
        });

        const contentType = response.headers.get("Content-Type") || "";
        const finalUrl = response.headers.get("X-Final-URL") || url;

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

        const detail = controller.signal.reason === "timeout"
            ? `連線逾時（超過 ${Config.FetchTimeoutMs / 1000} 秒）。`
            : `${error.message}\n\n可能原因：\n• 代理的 ALLOWED_ORIGINS 未包含目前網站來源（${location.origin}）\n• 目標網站封鎖了代理伺服器\n• 網路連線異常`;

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
 *  7. iframe 內連結 / 表單攔截
 * ============================================================ */

/**
 * 產生注入 iframe 的腳本
 * 點擊連結或送出 GET 表單時，以 postMessage 通知 OwOb 導覽
 */
function BuildInterceptorScript(tabId) {
    return `
(function () {
    var TabId = ${tabId};

    function Send(type, url) {
        parent.postMessage({ OwOb: true, Type: type, TabId: TabId, Url: url }, "*");
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

    // 表單送出（僅支援 GET）
    document.addEventListener("submit", function (event) {
        var form = event.target;
        event.preventDefault();

        if ((form.method || "get").toLowerCase() !== "get") {
            Send("Unsupported", "POST 表單無法經由代理送出");
            return;
        }

        var action = new URL(form.getAttribute("action") || location.href, document.baseURI);
        var params = new URLSearchParams(new FormData(form));
        action.search = params.toString();
        Send("Navigate", action.href);
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
        case "Unsupported":
            ShowToast(data.Url);
            break;
    }
});


/* ============================================================
 *  8. 主題 / 歷史紀錄 / 隱藏分頁
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

/** 清除所有本機資料（保留主題設定） */
function ClearAllData() {
    const theme = localStorage.getItem(Config.StorageKeys.Theme);

    localStorage.clear();
    sessionStorage.clear();

    if (theme) localStorage.setItem(Config.StorageKeys.Theme, theme);

    ShowToast("已清除瀏覽紀錄與分頁資料");
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
 *  9. 事件綁定與初始化
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
