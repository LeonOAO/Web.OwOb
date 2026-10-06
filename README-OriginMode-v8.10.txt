OwO Simple Browser v8.10 Exact Original Origin Mode

本版以 Web.OwO_20261006 原始專案為主體，保留原始 index.html、Login.html、styles.css、Assets、JavaScript 及完整瀏覽器功能。
僅替換外部網站載入架構與 Cloudflare Worker。

部署：
1. GitHub Pages 上傳本 ZIP 內全部前端檔案與資料夾。
2. Cloudflare Worker 完整部署本 ZIP 的 worker.js。
3. 原本設定若保存 ?url= 形式的 Worker 網址仍可兼容；前端會自動取其根網址。
4. Cloudflare Secret 可沿用 ACCESS_KEY，也支援 PROXY_KEY。
5. Network 的 /browse 回應應顯示 X-OwO-Version: origin-mode-v8.10-exact。


v8.10 搜尋結果導覽修正：
- HTMLRewriter 直接移除搜尋結果連結的 target 與 ping，原生備援導覽不再嘗試開啟沙箱外視窗。
- 所有連結 href 仍預先指向 Worker /browse，即使注入腳本因目標網站程式錯誤中斷，點擊仍可在目前 iframe 導覽。
- 每份 HTML 注入原目標 base href，未改寫相對路徑仍以原網站為基準。
- 點擊攔截只在 Ctrl、Shift、Command 或中鍵時建立 OwO 新分頁，一般點擊在目前 OwO 分頁導覽。
- 修正主程式鍵盤事件 key 缺值時的 toLowerCase 執行錯誤。


v8.10 搜尋結果根本修正：
- Worker 在改寫 href 前先還原 HTML entities。
- Worker 端直接解除 Bing /ck/a、DuckDuckGo、Google、Yahoo 搜尋追蹤網址。
- data-owo-url 與 href 都保存真正目的網址，不再保存 Worker 或搜尋引擎追蹤網址。
- 前端收到 Navigate/OpenTab 後再次解除 Worker 巢狀包裝與搜尋追蹤。
- Bing GLinkPingPost、recoRS、reportActivity 背景追蹤改回空成功回應。
- X-OwO-Version 修正為 origin-mode-v8.10-exact。


v8.10：bridge 改為同源外部腳本；iframe load 結束載入；加入 8 秒保險。
