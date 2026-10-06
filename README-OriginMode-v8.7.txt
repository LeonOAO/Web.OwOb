OwO Simple Browser v8.7 Exact Original Origin Mode

本版以 Web.OwO_20261006 原始專案為主體，保留原始 index.html、Login.html、styles.css、Assets、JavaScript 及完整瀏覽器功能。
僅替換外部網站載入架構與 Cloudflare Worker。

部署：
1. GitHub Pages 上傳本 ZIP 內全部前端檔案與資料夾。
2. Cloudflare Worker 完整部署本 ZIP 的 worker.js。
3. 原本設定若保存 ?url= 形式的 Worker 網址仍可兼容；前端會自動取其根網址。
4. Cloudflare Secret 可沿用 ACCESS_KEY，也支援 PROXY_KEY。
5. Network 的 /browse 回應應顯示 X-OwO-Version: origin-mode-v8.7-exact。
