# 同源最小修正版

以本次上傳的 MinimalFix 為唯一基準。只有 worker.js 改動，其他原始檔案逐位元組一致。
保留既有 204 修正，未沿用前一版根路徑復原頁或前端訊息改動。

## 修正範圍
同源 HTML 中，整段獨立 inline script 只有固定根路徑 location 指派、assign 或 replace 時，
將跳轉目標改為同源代理路徑，保留 query、hash、金鑰與 replace 方法。
不處理複雜腳本、變數目標、外部腳本、模組或 JSON；不加入 Acorn。
標準模式 HTML 與外部 JavaScript 處理流程不變。

## 部署
若目前已部署指定 MinimalFix 前端，只需更新 worker.js，保留既有環境變數與 Secret。
若目前仍是其他修正版，請先使用本包前端恢復指定 MinimalFix，再部署本包 Worker。
本版保留原 Worker 版本字串 9.7.5，辨識改動請查看 RewriteSameOriginLiteralRedirects 函式。

## 已驗證
原版測試跳轉跑到 Worker /lander；修正版跑到含原網站目標的代理路徑。
標準 HTML 回應與 fixture 相同，四種跳轉形式通過，七種不在範圍的腳本維持原樣。
金鑰、內網封鎖、健康檢查、語法、diff 重建及回滾雜湊檢查通過。

## 限制
測試是 Node VM 與本地替身，未驗證實際瀏覽器或已部署 Worker。
實際網站原始回應取得被執行環境阻擋，因此尚未確認該網站腳本符合上述形式。
不宣稱修復所有動態跳轉、上游拒絕或標準模式既有問題。

## 證據
Verification/SameOriginLiteralFix 包含 baseline、diff、測試、紀錄及可執行回滾。
回滾接受專案副本目錄，只還原 Worker，保留 MinimalFix 前端與 204 修正。
