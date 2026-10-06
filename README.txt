OwO Simple Browser v8.4 - 經典介面與 Origin Mode 整合版

本版保留 Web.OwO_20261006 的玻璃霧化視覺方向與主要使用方式，並套用 v8.3 的 GitHub Pages + Cloudflare Worker 獨立內容來源架構。

保留與重建功能：
- 玻璃霧化亮色與深色介面、分頁列、工具列、首頁搜尋與快捷網站。
- 多分頁、上一頁、下一頁、重新整理、首頁、分頁保存與還原。
- 瀏覽紀錄、書籤、設定頁、Worker 網址與金鑰設定。
- 頁面縮放、頁內搜尋、快捷鍵與提示訊息。
- 外部網站改用 iframe.src 載入 Worker /browse，不再使用 iframe.srcdoc。
- 保留 v8.3 的重複代理防護、challenge 查詢還原與外部彈出視窗攔截。

部署：
1. GitHub Pages 更新 index.html、styles.css、script.js。
2. Cloudflare Worker 以 worker.js 完整取代現有程式並部署。
3. OwO 設定頁填入 Worker 根網址，不加入 ?url=。
4. 若 Worker 有 PROXY_KEY，前端需填入相同金鑰。
