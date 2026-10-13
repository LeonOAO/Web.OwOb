# Web.OwO 2026.10.13 最小修正版

## 本版基準
由原始 Web.OwO.2026.10.13.zip 重建，不延用上一份 MixedContentFix 的程式改動。

## 唯一程式修改
script.js 的 OwObFrameAgent.CreateQuietResponse：HTTP 204 回應的本文由空字串改為 null。
原版建立回應時會拋出 TypeError，fetch 攔截器會落入直接連線的後備路徑。
本版保留原有降噪清單，修正其回應建立方式，不改主要內容 API。

## 完整恢復
worker.js、index.html、styles.css、Login.html、JavaScript/wOvOw.js 與圖示逐位元組維持原版。
移除上一份修正版的 Acorn、全面腳本解析、iframe 路徑變更、歷史紀錄變更與新導覽橋接。
不更改原有按鈕文字、設定開關、sandbox 或安全檢查。

## 更新方式
1. 備份目前部署檔案。
2. 使用本版完整前端檔案更新；舊版 Assets/acorn.js、Assets/AcornLicense.txt 可刪除，本版不再引用。
3. 務必將 Worker 同時重新部署為本版 worker.js，保留既有環境變數與 Secret。
4. 重新載入頁面，確認瀏覽器未使用上一版快取。

## 已執行驗證
- 原版：204 回應建構失敗；三個降噪請求落入直接連線。
- 修正版：三個降噪請求取得無本文 204；網路呼叫為零。
- 主要內容 GET 與 Request POST 仍走代理，兩版均通過。
- JavaScript 與 Worker 語法檢查通過。
- diff 重建與回滾執行通過，回滾雜湊等於原版。
- 除 script.js 的唯一修改外，原始檔案逐位元組比對一致。

## 範圍限制
測試使用 Node 與本地網路替身，未在真實瀏覽器及已部署 Worker 上驗證。
不保證所有外部網站正常，不宣稱修復上游 403/503 或所有 srcdoc 跳轉。
本版優先移除上次過度修改造成的風險；原先 redlib 停放頁問題不以全面改寫方式處理。

## 驗證與回滾
Verification/Changes.diff、VERIFICATION.txt、ROLLBACK.sh、Baseline/script.js 隨附。
RegressionTest.cjs 使用 Node 與 Acorn 作為測試依賴，應用程式及 Worker 不依賴 Acorn。
ROLLBACK.sh 接受專案副本目錄，只還原本版 script.js 的單一修正。
