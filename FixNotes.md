# 導覽與 iframe 代理修正版

## 部署
1. 更新前端 index.html、script.js、Assets/acorn.js 與 Assets/AcornLicense.txt。
2. 同時重新部署 worker.js，保留既有環境變數與 Secret。
3. 重新載入前端，避免舊版快取。

## 修正
- 語法樹辨識 location 指派、assign、replace，交回代理導覽。
- 靜態及動態 iframe/frame 改走 Worker 相容流程。
- 保留 replace 的歷史語意、原有按鈕文字與 sandbox 設定。
- Worker 保持單檔部署，內含 Acorn 解析器；授權位於 Assets/AcornLicense.txt。

## 驗證
Node 回歸、語法檢查、差異重建與回滾雜湊比對通過。
未進行實際網站、DNS、瀏覽器及 Worker 部署驗證。
未宣稱支援所有 eval、動態產生腳本、解析失敗或同名變數遮蔽的跳轉。
截圖的區域網路封鎖與 Mixed Content 是不同檢查；本版不關閉瀏覽器保護。

## 驗證與回滾
Verification/RegressionTest.cjs：Node 測試。
Verification/Changes.diff：可重建修改內容的 unified diff。
Verification/VERIFICATION.txt：命令、輸出、退出碼與雜湊。
Verification/ROLLBACK.sh：接受專案副本目錄，還原本次改動。
Verification/Baseline：修改前原始檔案。
