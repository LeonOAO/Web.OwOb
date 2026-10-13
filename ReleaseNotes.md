# Web.OwO 2026.10.13 同源根路徑跳轉修正版

## 本版基準
使用本次上傳的 MinimalFix.zip，保留 HTTP 204 本文為 null 的修正。
Worker 版本更新為 9.7.6。未加入 Acorn、混淆或全面腳本解析。

## 修正流程
原網站在同源 iframe 執行根路徑跳轉時，可能跑到 Worker /lander，遺失代理前綴。
本版 Worker 只對未帶目標的 iframe GET 文件回傳小型復原頁，而不是服務狀態 JSON。
復原頁透過 postMessage 回報根路徑；前端核對 Worker origin、實際 iframe source、分頁模式及路徑，
再依該分頁原網站來源重建同源代理網址。金鑰由既有前端設定補回，不在復原訊息傳送。
各分頁保留自己的來源；十秒內最多復原三次，避免無限跳轉。

## 不變的部分
index.html、styles.css、Login.html、JavaScript/wOvOw.js、Assets/favico.ico 與上傳版本逐位元組一致。
原有按鈕文字、標準模式、sandbox、來源政策、存取金鑰與內網封鎖均保留。
一般健康檢查、OPTIONS、代理 API 路由維持原流程。

## 部署
1. 更新本版完整前端，特別是 script.js。
2. 同時部署本版 worker.js；保留既有 ACCESS_KEY 與 ALLOWED_ORIGINS。
3. ALLOWED_ORIGINS 必須包含實際前端來源（只填協定與網域，不含路徑）。
4. 重新載入前端以排除舊快取。Worker 狀態或回應標頭應顯示 9.7.6。
前端與 Worker 必須配套，否則復原訊息不會被處理。

## 已執行驗證
原版 /lander 回傳健康 JSON，修正版交回分頁並重建代理路徑、query、hash 與金鑰。
驗證不同分頁來源隔離、錯誤來源/視窗拒絕、非法路徑拒絕、重複抑制及循環上限。
健康檢查、OPTIONS、金鑰驗證、內網封鎖、來源政策與 canonical 代理路由測試通過。
語法檢查、diff 重建與可執行回滾通過；回滾雜湊與 MinimalFix 相同。

## 限制
測試為 Node VM 與本地替身，未在真實瀏覽器及已部署 Worker 驗證。
本版處理分頁主 iframe 的 GET 根路徑跳轉，不宣稱修復巢狀 iframe、根路徑資源或 POST 跳轉。
目的網站若回傳 403/503，仍可能顯示該錯誤；本版不保證原文章存在或網站接受代理。

## 隨附驗證
Verification/Changes.diff、VERIFICATION.txt、RegressionTest.cjs、ROLLBACK.sh 與 Baseline。
RegressionTest.cjs 使用 Node 內建模組，不需要 Acorn 或其他套件。
ROLLBACK.sh 接受專案副本目錄，還原本次 script.js 與 worker.js；保留 204 修正。
PreviousMinimalFix 保留上次驗證資料，與本次驗證分開。
