OwO Simple Browser v8 - GitHub Pages + Cloudflare Worker Origin Mode

部署：
1. GitHub Pages：上傳 index.html、styles.css、script.js。
2. Cloudflare Worker：以 worker.js 完整取代目前 Worker 程式並部署。
3. 開啟 OwO 的設定頁，填入 Worker 根網址，例如 https://你的Worker.你的帳號.workers.dev。
4. 若 Worker 設有 PROXY_KEY 環境變數，在 OwO 設定頁輸入相同金鑰。

架構變更：
- 外部網站使用 iframe.src 直接載入 Worker 的 /browse 內容頁。
- 不再使用 iframe.srcdoc，因此不再產生 about:srcdoc 與 origin null。
- GitHub Pages 主介面與 workers.dev 內容頁為不同來源。
- Worker 以 HTMLRewriter 改寫 HTML 資源、連結、表單及 iframe。
- Worker 注入 fetch、XHR、動態資源、連結、新分頁與表單代理橋接。
- Cookie 依目標主機加前綴保存，避免不同目標網站直接共用 Cookie 名稱。

限制：
- 目標網站可能拒絕 Cloudflare 資料中心 IP、代理流量或嵌入行為。
- WebSocket、WebRTC、DRM、CAPTCHA、第三方登入、付款與硬體權限不保證相容。
- 請遵守目標網站條款與 Cloudflare 使用政策。
