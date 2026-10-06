OwO Simple Browser v8.6 - 經典介面與 Origin Mode 整合版

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


v8.5 修正：
- Worker 端遞迴解除巢狀代理網址，最多 8 層。
- 即使前端或目標網站再次把 /browse 包進 url 參數，也會還原成真正目標網址。
- Referer 還原與最終轉址同樣套用解除巢狀處理。
- 移除上游 Location 標頭，避免瀏覽器直接離開 Worker 內容來源。
- Worker 版本標頭更新為 origin-mode-v8.5。

重要：Cloudflare Worker 必須完整重新部署本壓縮檔內的 worker.js。若回應標頭不是 origin-mode-v8.5，代表仍在執行舊 Worker。


v8.6 根本修正：
- 注入頁面的 abs() 不再以 Worker 的 location.href 當相對網址基準。
- 每個 HTML 回應都注入自己的原始最終目標網址 OriginalBase。
- /search、/signin、相對表單、相對 fetch/XHR 與 JavaScript 動態路徑會解析回原目標網站。
- 不再把 Worker 自己的 /search 誤認成真正目標並回頭 fetch Worker。
- Referer 保留完整 /browse 內容網址，作為未改寫導覽的第二層還原依據。
- Worker 版本標頭更新為 origin-mode-v8.6。

部署後請在 Network 的 /browse 回應確認 X-OwO-Version 為 origin-mode-v8.6。
