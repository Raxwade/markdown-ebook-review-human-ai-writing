# md-epub-preview 架構規劃

VSCode 擴充套件：任何 Markdown 檔 → EPUB → 右側面板即時預覽，改動一秒內反映。
不綁任何專案的建置腳本，不依賴 pandoc 或 calibre。

---

## 1. 範圍

**要做的**

- 任一 `.md` 開啟即可預覽，零設定可用
- 右側面板用真正的 EPUB 引擎渲染，看得到分頁、跨章、孤行、圖片跨頁
- 編輯後 debounce 重建，保留閱讀位置
- 匯出 `.epub` 到檔案旁邊
- 裝置框：iPhone／iPad／Mac 尺寸即時切換 + 自訂寬高
- 讀者外觀、全書搜尋、書籤、歷史與進度拖曳都直接作用在既有 renderer

**不做的**

- 不做 Kindle KF8／mobi 轉換（那要 Amazon 的 KindleGen 系工具）
- 不編輯既有 `.epub`
- 不做完整 EPUB 規格驗證（EPUBCheck 另外跑）
- 不裝 pandoc／calibre，整條管線純 JS

---

## 2. 三個關鍵決策（都有實測依據）

### 2.1 產生真的 EPUB，不是「像 epub 的 HTML 預覽」

如果只是把 md 轉 HTML 塞進面板，看到的是網頁捲動流，不是電子書。分頁位置、章節邊界、圖片會不會被切到下一頁——這些才是要看的。所以預覽路徑上就要有一個真的 EPUB 容器，交給真的閱讀引擎。

### 2.2 每次改動整本重建，不做增量

實測（markdown-it 15 + fflate，node 20）：

| 稿件 | 大小 | 章數 | 切章 | 全部 render | 打包 (level 0) | 合計 |
|---|---|---|---|---|---|---|
| `short-sample.md` | 78 KB | 53 | 0.2 ms | 12.0 ms | 0.6 ms | **26 ms** |
| `long-sample.md` | 321 KB | 62 | 1.7 ms | 47.6 ms | 2.3 ms | **101 ms** |

整本重建就在預算內，增量建置是白費的複雜度。

`build()` 仍然回傳「每章內容 hash」，但先不使用——留給 4.3 的最佳化開關。

### 2.3 預覽用 STORE，匯出用 DEFLATE

預覽在本機記憶體裡傳遞，大小無所謂，速度才有所謂：

- level 0（STORE）：2.3 ms → 914 KB
- level 6（DEFLATE）：51.9 ms → 442 KB

預覽走 level 0，匯出走 level 6。省下的 50ms 是總預算的一半。

---

## 3. 元件切分

```
src/
  extension.ts       啟動、註冊命令、面板生命週期
  preview.ts         WebviewPanel 管理、debounce、與 webview 的訊息協定
  config.ts          設定讀取與預設值
  reader-state.ts    ReaderProfile、每書狀態、CSS 產生、globalState/LRU
  epub/
    frontmatter.ts   YAML frontmatter → 書籍 metadata
    split.ts         依標題層級切章
    render.ts        markdown-it → XHTML
    assets.ts        解析與讀取本地圖片、CSS
    package.ts       產生 container.xml / content.opf / nav.xhtml / toc.ncx
    zip.ts           fflate 打包
    build.ts         串起上面所有東西
media/
  reader.html        webview 骨架（含 CSP）
  reader.js          裝置框、外觀、搜尋、書籤、歷史、註記與換書
  reader.css
  vendor/foliate-js/ 內嵌（MIT）
test/                純模組單元測試（node:test）
```

`src/epub/*` 全部是純函式：吃字串或 buffer，吐字串或 buffer，**完全不 import `vscode`**。所以可以直接 `node --test` 跑，不需要開編輯器。這是整個切分的重點——會出錯的邏輯（切章、路徑解析、XHTML 轉義）都在可測的那一半。

`preview.ts` 是唯一同時碰 vscode API 和 build 管線的地方。

---

## 4. 資料流

### 4.1 開啟預覽

```
命令 mdepub.preview
  → 建立 WebviewPanel(ViewColumn.Beside)
  → localResourceRoots = [ media/ , 該 md 檔所在資料夾 ]
  → 載入 reader.html（script 用 nonce）
  → build(document) → Uint8Array
  → panel.webview.postMessage({ type:'book', bytes })
  → webview: new File([bytes]) → makeBook() → view.open()
```

### 4.2 編輯

```
onDidChangeTextDocument
  → debounce 120ms
  → build() → bytes
  → postMessage
  → webview: 先存 view.lastLocation.cfi
           → 開新書
           → view.init({ lastLocation: cfi }) 還原位置
```

位置一定要還原。少了這步，每次打字都跳回封面，實際上不能用。

### 4.3 留著的最佳化開關（先不實作）

若「整本 reload + CFI 還原」量出來超過預算，改成：比對每章 hash，**只有當前顯示的那章變動時，直接換掉那個 iframe 的內容**，完全跳過 reload。`build()` 從第一天就回傳 hash 就是為了留這道門。先量再說。

### 4.4 切換裝置

```
webview 內的下拉選單
  → 存 view.lastLocation.cfi
  → 改裝置框尺寸（必要時重算 scale）
  → 重新分頁
  → goTo(cfi) 還原位置
```

**全程在 webview 內完成，不回 extension host，不重跑 `build()`，不傳新 bytes。** 換的是容器尺寸，不是書。細節與理由見 6.1。

---

## 5. 渲染引擎

**foliate-js 1.0.1**（MIT，桌面版 Foliate 同一套）。純 ESM，內嵌進 `media/vendor/`，不用打包工具。

用到的 API：

- `makeBook(file)` — 吃 `File`/`Blob`，內部用 zip loader 解 EPUB
- `<foliate-view>` 自訂元素 — `open()` / `init({lastLocation})` / `goTo()`
- `view.lastLocation.cfi` — 位置保存

沒選 epub.js：架構相同但較舊，維護較不活躍。

---

## 6. 設定

`mdepub.*`，全部有預設值，零設定可用：

| 設定 | 預設 | 說明 |
|---|---|---|
| `splitLevel` | `2` | 切到 `##`（`1` = 只切 `#`） |
| `device` | `iphone` | 開啟時的預設裝置框，見 6.1 |
| `customWidth` | `393` | `device: custom` 時的框寬，CSS px |
| `customHeight` | `852` | `device: custom` 時的框高，CSS px |
| `css` | 無 | 自訂 CSS 檔路徑，取代內建樣式 |
| `lang` | `zh-TW` | |
| `author` / `cover` | 無 | |
| `debounce` | `120` | ms |

書籍 metadata 取用優先序：**YAML frontmatter > VSCode 設定 > 從第一個 `#` 標題與檔名推得**。

圖片：相對路徑以 md 檔所在資料夾為基準解析，掃描 render 結果收集實際用到的檔案打包進去。支援 svg／png／jpg／webp／gif。三條規則是實作時定的：

- **打包路徑一律壓平成 `assets/檔名`。** `![](../../pics/a.png)` 在 markdown 裡合法，照抄進 EPUB 就會指到容器外面，嚴格的 reader 直接拒收。同名不同資料夾的圖用序號區分。
- **讀不到的圖，整個 `<img>` 元素拿掉**，只留 alt 文字（包成 `<span class="missing-image">`）。只改 src 不夠——沒被改寫的 src 會保留原路徑，指向一個壓縮檔裡不存在的檔案，reader 就畫一個破圖。這是 M1 靠截圖才看出來的，單元測試當初只檢查「改寫後的路徑不存在」，那條斷言在破圖的情況下照樣通過。
- **外部 URL 不動。** `https://` 開頭的不是我們的東西，不打包也不移除。

讀檔的動作在 `extension.ts`，不在 `src/epub/*`：後者只回報「這份 XHTML 引用了哪些相對路徑」，bytes 由呼叫端餵回來。§3 說的「完全不 import vscode」要成立，就不能在裡面碰 fs。

### 6.0 翻頁與導覽

foliate-js **只綁 touch 手勢**，鍵盤和按鈕是宿主自己的事。而且鍵盤要同時綁在外層 document 和分頁 iframe 的 document 上——書一有焦點（也就是大部分時候），只綁外層等於沒綁。iframe 的 document 從 view 的 `load` 事件拿。

面板上有：`‹` `›` 翻頁、章節下拉、以及「第幾章／共幾章　百分比」。

那個進度數字不是裝飾。切章之後每一章都是獨立的 spine item，第一章常常只有標題加一段話，整頁看起來幾乎是空的——沒有「1/10 章」這種提示，會直接被當成「只渲染出一小塊，壞了」。這是實際發生過的誤判。

面板裡套一層固定尺寸的框，書渲染在框內，用來看同一份稿在不同裝置上的實際分頁。

**尺寸是寬×高，不是只有寬。** §2.1 要看的三件事——分頁位置、章節邊界、圖片會不會被切到下一頁——全部同時吃寬和高。只鎖寬度、高度跟著面板走，看到的分頁在任何真實裝置上都不存在，這功能就白做了。所以每個預設都是一組 w×h。

**單位是 CSS px（邏輯點），不是實體像素。** iPhone 15 是 393×852，不是 1179×2556。排版只看邏輯點；填實體像素會得到一個大到沒意義的框。

預設值。目的是「這段會不會在手機上孤行」，不是裝置認證，所以取近似的邏輯視窗大小就夠，真要精確的用 `custom`：

| 分組 | 預設 | w×h |
|---|---|---|
| 手機 | `iphone-se` | 375 × 667 |
| | `iphone` | 393 × 852 |
| | `iphone-max` | 430 × 932 |
| | `pixel` | 412 × 915 |
| | `galaxy` | 360 × 800 |
| 平板 | `ipad-mini` | 744 × 1133 |
| | `ipad` | 820 × 1180 |
| | `ipad-pro-11` | 834 × 1194 |
| | `ipad-pro-13` | 1024 × 1366 |
| 電子書閱讀器 | `kindle` | 620 × 830 |
| | `kindle-oasis` | 675 × 900 |
| | `kobo-clara` | 600 × 800 |
| | `remarkable` | 830 × 1100 |
| 桌機視窗 | `desktop` | 1280 × 800 |
| | `desktop-wide` | 1440 × 900 |
| 其他 | `panel` | 跟著面板目前大小 |
| | `custom` | `customWidth` × `customHeight` |

電子書閱讀器那組**特別是近似值**。e-ink 裝置不像手機會公布 CSS px 視窗，那幾個數字是從實體解析度和常見 DPI 推的合理範圍，拿來看「這段在 Kindle 上會不會孤行」夠用，要對特定機型請用 `custom`。這組其實是最該有的一組——這是個 EPUB 工具，電子書閱讀器才是稿子真正會被讀的地方。

`desktop` 跟前面幾組不是同一種東西：手機、平板的視窗大小是固定的，框就等於裝置；桌機是使用者自己拉的視窗，1280×800 只是代表值，沒人真的全螢幕看書。

`panel` 是唯一不代表任何裝置的選項：框直接等於面板現在的大小，會跟著面板縮放重新分頁。這**不違反**下面那條「不准讓框跟著面板縮」——差別在於這是使用者明確要求「就用這個面板的尺寸排版」，layout 仍然發生在一個真實、明確宣告的尺寸上，看到的分頁對得起那個尺寸。被禁止的是使用者選了 iPhone、卻偷偷用面板寬度排版。

橫向不另外列預設，用一個按鈕把 w／h 對調。

**選單放在 webview 裡**（角落一個下拉），不是只能改 VSCode 設定。這東西是拿來回頭比對的，切換頻率高，走設定檔太慢。`mdepub.device` 只決定開啟時的起始值。

預設值那張表只寫在 `src/config.ts`，開面板時跟著 config 訊息送進 webview，`reader.js` 不自己留一份。`package.json` 的 `enum` 是唯一沒辦法推導的第二份，用測試釘住。這件事一開始沒做好——同一張表散在三個地方、彼此沒有任何約束，當下三份剛好一致，所以壞掉也不會有人發現。

**框比面板寬時（iPad、Mac 幾乎一定會）用 `transform: scale(k)` 整體縮小，不能改框本身的寬度。** 若改成 `width: 100%` 之類讓框跟著面板縮，foliate-js 會用面板寬度重新分頁——畫面看起來一切正常，但分頁位置是錯的，而分頁正是整個工具存在的理由。要真實尺寸就給捲軸，那也對；錯的只有「讓框自己縮」。

**但光是 `transform: scale()` 並沒有保住這件事，這裡原本寫錯了。** 原文說「layout 仍然發生在宣告的 CSS px 上，縮的只是畫面」——foliate-js 的 paginator 是用 `#container.getBoundingClientRect()` 決定欄寬的（`paginator.js:700`），而 `getBoundingClientRect()` 回的是**變形後**的尺寸。也就是說，只要 k < 1，分頁就是照著「看起來多大」算的，不是照著宣告尺寸。實測 iPhone 框縮到 56%：書排在 204px 寬，而框的 layout box 是 393px，內容只佔了 220px 寬的框裡的 114px。這正是本節說絕對不可以發生的事，只是從另一個入口進來的。

**所以裝置框現在是 `<iframe>`，不是 `<div>`。** iframe 裡面的 `getBoundingClientRect()` 是相對於它自己的 viewport，外面那層 transform 碰不到——量過：同一個縮放下，`<div>` 裡的元素回報 197，`<iframe>` 裡的回報 393。修好之後 56% 縮放下書排在 366px，和 100% 時一模一樣。

順帶一提，這也讓另一個 bug 消失了：paginator 只靠 `ResizeObserver` 觸發重排，而 ResizeObserver 看的是**未變形**的 border box，所以改 scale 它完全不知道。面板被縮到很小的當下如果剛好重排一次（切分頁、拖曳邊界），欄寬會被算成個位數 px（實測 9px，正常是 336px），而且面板拉回來也不會自己修——因為 border box 從頭到尾沒變。畫面上就是每一欄變成一條細線、字全部疊在一起。改成 iframe 之後 scale 不再影響量測，這個情況不存在了。

框裡的 foliate 需要自己的 module realm（custom element 是逐 document 註冊的），那就是 `media/stage.js`。用 `srcdoc` 所以同源，`reader.js` 直接伸手進 `contentDocument`，畫線與註記那套完全不用改寫成訊息協定。唯一要當心的是跨 realm 身分：`Blob`／`File` 一定要用框裡的建構子做，`zip.js` 會 `instanceof`，跨 realm 會靜靜地失敗。

**框裡面不准用 URL 載入任何東西。** 0.4.0 就是這樣壞的：整個裝置框是白的、翻頁按鈕沒反應，因為 `stage.js` 從頭到尾沒載進去。VSCode 的 webview 資源是走 service worker 的，它靠**發請求的 client 的 query string** 判斷是哪一個 webview 在要東西——`new URL(client.url).searchParams.get('id')`（`service-worker.js:677`）——而 `srcdoc` 文件的 URL 是 `about:srcdoc`，沒有 query，所以它印一行 `Could not resolve webview id` 然後回 404。

這不只是框自己那一個 `<script>`：foliate 的 `zip.js`、`epub.js`、`paginator.js` 都是開書的當下才 `import()` 進來的，而那是在框裡面發生的。所以整張 module graph 要打包成一個檔（`npm run bundle:stage` → `media/stage.bundle.js`），由 `reader.js` fetch 成文字再注進框裡——`reader.js` 所在的文件才是 service worker 認得的 client。注進去的是 inline script，需要本頁的 nonce；框繼承母文件的 CSP，nonce 也一起繼承，所以同一個值就通。它是 classic script 不是 module，所以 `append` 當下就同步執行完，下一行就能判斷成功與否，不必等 timeout。

**這條是 spike 結構上看不到的。** 靜態 server 沒有 service worker，誰要都給，所以 spike 會對著一份在產品裡不可能跑起來的程式碼全綠。要重新確認機制的話，service worker 就在硬碟上：`<vscode>/resources/app/out/vs/workbench/contrib/webview/browser/pre/service-worker.js`——注意是**用戶端**那台機器，Remote-WSL 的話在 `/mnt/c/…`，`~/.vscode-server` 裡沒有。順帶一提，同一份 `index.html` 也可以確認 webview 的 iframe 永遠帶 `allow-same-origin`（第 1024 行），所以「伸手進 `contentDocument`」這件事在產品裡是成立的。

`media/vendor/` 還是照打包進 `.vsix`，雖然執行期只用得到 bundle。這是故意的：spike 服務的是 repo 的目錄，出貨的目錄一旦跟它不一樣，spike 就不再代表產品——而上面那個 bug 就是這樣出去的。

框本身不能有 border：`box-sizing: border-box` 下 1px 邊框會讓 viewport 變成 391×850，宣告尺寸就不是宣告尺寸了。改用 `box-shadow` 畫外框，不佔 layout。

面板被拉很窄的時候，連 `iphone-se` 都會比面板寬——這時候還是照縮，或給捲軸。縮到 60% 的字很難讀，但分頁是對的；**不准在窄面板加一條「這種情況就讓它 reflow」的例外**，那就是上一段講的那個錯，只是換個入口進來。

裝置框是渲染引擎外面的一層容器，和 7.1 的 CSP 風險無關。就算退到 `column-width` 的退路，這層照樣有效。

**實測（M2）**：面板固定 520px 寬，同一章、同一份稿，只換裝置框：

| 裝置框 | 縮放 | 該章頁數 |
|---|---|---|
| iPhone SE 375×667 | 100% | 7 |
| iPhone 393×852 | 90% | 4 |
| iPad Pro 834×1194 | 60% | 2 |
| 桌機 1280×800 | 39% | 3 |

這張表當初被當成「框沒有跟著面板縮」的證據——如果縮的是框，四個數字會一模一樣。桌機比 iPad Pro 多一頁是因為它矮，不是因為它窄。

**但這張表其實證不了那件事。** 四個裝置縮放後的視覺尺寸本來就各不相同（375×100%、393×90%、834×60%、1280×39%），所以就算分頁是照視覺尺寸算的，四個數字也一樣會不同。它只排除了「所有框都被壓成面板寬」這一種壞法，沒排除上面那種。真正釘住這件事的是 `frame.contentWindow.innerWidth === 宣告寬度`，任何縮放下都該成立，`spike/notes-loop.mjs` 的第 0 項就是它。

位置在三種情況下都留住了，實測都停在同一章：換裝置、轉向、以及重新送一本書進來（＝ 4.2 的編輯循環）。

---

## 7. 風險，以及動工前要先驗的事

### 7.1 CSP 與 iframe（唯一可能整個做不成的點）

foliate-js 的 paginator 做的事：

```js
#iframe = document.createElement('iframe')
this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
this.#iframe.src = src            // blob: URL
```

它自己 demo 的 CSP 是 `frame-src blob: data:; default-src 'self' blob:`。這些指令我在 webview 的 meta 裡都給得起。

**給不起的是 VSCode webview 外層本身就是個 sandbox iframe，子 iframe 會繼承那層 sandbox。** 如果外層沒帶 `allow-same-origin`，blob: 子框架就建不起來，foliate-js 就跑不了。

**已驗，過了（M0，2026-08-01）。** 重現方式：`npm run spike`，內容在 `spike/`——static server + VSCode 等級的 CSP + 三種外層 sandbox 的對照。

VSCode 實際設的 sandbox，從安裝檔 `resources/app/out/vs/workbench/contrib/webview/browser/pre/index.html` 讀出來（build `e4c7e7b1d6`）：

```js
sandboxRules = new Set(['allow-same-origin', 'allow-pointer-lock'])
sandboxRules.add('allow-scripts')
```

`allow-same-origin` 在裡面。三種設定實測：

| 外層 sandbox | 結果 |
|---|---|
| 無 | 渲染、翻頁、CFI 還原都正常 |
| `allow-scripts allow-same-origin`（VSCode 實際值） | 同上 |
| `allow-scripts`（原本擔心的那個） | 死在更前面：opaque origin 讓 `view.js` 直接被 CORS 擋掉，根本輪不到 blob: iframe |

風險解除。**退路（自產 XHTML 用 CSS `column-width` 分頁）不用做了**，留著只是記錄當初的備案。

驗的過程另外撞出兩件原本沒寫、但會直接卡住 M2 的事：

**一、`style-src` 一定要放 `blob:`。** foliate-js 會把書裡的 CSS 轉成 blob: URL 再掛進去。少了這條，書照樣渲染、`open()` 也不會丟例外，但樣式全部消失，只在 console 留下 CSP 訊息——是那種會安靜壞掉的東西。實測可用的 CSP：

```
default-src 'none';
script-src 'nonce-…' ${cspSource};
style-src 'unsafe-inline' ${cspSource} blob:;
img-src blob: data: ${cspSource};
font-src ${cspSource};
frame-src blob: data:; child-src blob:; worker-src blob:;
connect-src blob: ${cspSource};
```

**二、裝置框一定要 `overflow: hidden`。** `<foliate-view>` 自己沒有任何 `:host` 樣式，內部會撐到容器的兩倍高（實測 844px 的框，scrollHeight 1688px）。不夾就會長出捲軸，6.1 講的「固定尺寸視窗」就不成立了。foliate-js 的三個 shadow root 都是 `mode: 'closed'`，從外面探不進去，所以這類問題只能用畫面驗，不能用 DOM 驗。

### 7.2 CFI 還原耗時

已量（60 章、38 KB 的 fixture，Chromium）：

| 階段 | ms |
|---|---|
| `makeBook` | 59 |
| `view.open` | 5 |
| `view.init`（首次，含渲染） | 155 |
| **重開一本 + CFI 還原（＝ 4.2 的編輯循環）** | **50** |

編輯一次的總成本＝建置 + 50 ms。78 KB 那本 26＋50＝76 ms，321 KB 那本 101＋50＝151 ms。離 1 秒的目標很遠，4.3 的增量開關暫時不用開。

CFI 還原是逐字比對過的：`goTo(40)` 之後存下 `epubcfi(/6/82!/4/2,/2,/8/1:180)`，重開一本再還原，拿到同一個字串。

### 7.3 Remote-WSL 的安裝路徑

extension host 在 WSL、webview UI 在 Windows 端的 Electron。`asWebviewUri` 的路徑問題全部在這條接縫上爆。要真的 `vsce package` → `code --install-extension` 裝起來驗，不能假設。

**M3 進度**：`.vsix` 打包好、也裝進 Remote-WSL 了。但「裝得起來」跟「`asWebviewUri` 在這條接縫上給得出對的路徑」是兩件事，後者要真的開一次面板才知道。這條風險還沒關。

---

## 8. 交付方式

esbuild 打包 → `@vscode/vsce package` → `.vsix` → `code --install-extension`。
不上架 marketplace，本機安裝即可（要上架隨時可以）。

---

## 9. 里程碑

| | 內容 | 驗收 |
|---|---|---|
| **M0** ✅ | spike：CSP/iframe 能不能跑、CFI 還原計時 | 過了，見 7.1／7.2。`npm run spike` 可重跑 |
| **M1** ✅ | build 管線 + 單元測試 + `Export EPUB` 命令 | 65 個測試過；自產的 EPUB 用 M0 的 harness（foliate-js＝Foliate 桌面版同一顆引擎）載入、渲染、翻頁、CFI 還原都正常。兩份外部參考稿未納入 repo，因此尚未在此環境實測 |
| **M2** ⚠️ | 預覽面板 + live reload + 裝置框 | 程式寫完，webview 那半用 harness（載真正的 `media/reader.html`）驗過：切裝置、轉向、換書位置都不跳，分頁確實隨框改變（見 6.1 的表）。**還沒在真的 VSCode 裡跑過**，`preview.ts` 那半留到 M3 的 Remote-WSL 安裝一起驗 |
| **M3** ⚠️ | 設定、錯誤處理、README、打包安裝 | 設定、錯誤處理、README、`.vsix` 都好了，也在 Remote-WSL 裝起來了（`raxwade.md-epub-preview@0.1.0`）。extension host 那半用 stub 過的 `vscode` 模組測了命令註冊、匯出、面板 HTML、資源路徑白名單。**但沒有人真的在編輯器裡開過面板**——那要手動點一次才算數 |

M1 結束就已經是可用的工具（通用 md→epub 匯出），M2 才是完整目標。

## 10. 註記與畫線（M4）

給書的審閱者用的：在面板裡選一段字、上色、寫意見，存成 `.md` 旁邊的伴隨檔，讓 Claude／Codex 之類的 agent 連同原稿一起讀，直接改稿。**不動 `.md` 本身**——原稿的乾淨是這個功能的前提，不是附帶效果。

### 10.1 錨點為什麼要兩層

| | 用途 | 存不存 |
|---|---|---|
| CFI | foliate 畫線的位置 | **不存**。它指的是「算繪出來的那本書」，每次重建都失效 |
| `{startLine, startCol, endLine, endCol}` | 存檔、給 agent 解析 | 存。指的是使用者在編輯的 `.md` |

橋樑是 `data-md-line`：markdown-it 的 block token 帶 `token.map`（相對於該章的行號），`render.ts` 把它加上該章在全文的起始行後印進每個區塊元素。**只有預覽版有**，匯出的 EPUB 不帶。

**它是一個區間，不是一把鑰匙。** 一個區塊常常涵蓋很多行——圍籬程式碼區塊整段就是一個 `<pre>`，硬換行的段落也是一個 `<p>`——所以 `data-md-line-end` 一起印（`token.map[1]`，右開），webview 用**包含**去找，而不是拿行號當 key 查。取文件順序上最後一個符合的，因為那是最內層的區塊，也就是 `blockOf` 當初量欄位用的那一個：`<blockquote data-md-line="10"><p data-md-line="10">` 兩個都包含第 10 行，精確比對會拿到外面那個 blockquote，欄位就量進錯的文字裡。

原本用 `querySelector('[data-md-line="N"]')`，只要標記不在區塊的第一行就一定失敗，而且是**無聲**的：`anchorInDocument` 回 null，`drawSection` 跳過，註記照樣存進伴隨檔、照樣列在面板上、書裡什麼都沒有。原因是兩邊記的根本不是同一個數字——webview 記的是**區塊的起始行**（`lineOf` 往上找到最近的帶標記祖先），而 `src/notes.ts` 重新定位時是拿引文去搜原始碼，回報**文字實際所在的那一行**。單行區塊兩者相等，所以一直沒被發現。

順帶承認一件事：多行區塊的 `range` 因此是「區塊起始行 + 區塊內偏移」，不是「文字所在行 + 該行偏移」。伴隨檔的讀者（人或 agent）看到 `{startLine: 89, startCol: 47}` 沒辦法直接對到 `.md` 的位置，得自己重建區塊結構。這是目前的實情，不是這一節原本讀起來的樣子。

沒有這層對應就只能拿引文去 `.md` 裡全文比對，而使用者標的往往在 `**兩者兼備**` 這種行內語法裡面——算繪後看到的是「兩者兼備」，原始碼是 `**兩者兼備**`，字串比對直接落空。

行號會因為上面的編輯而位移，所以它是**線索不是答案**：`anchorNote()` 從記錄的行往外找，最近的優先。

跨行的標記在任何單一行上都看不到，所以單行找不到時還有第二輪：把後續的行接起來成一個窗，看引文是不是**從這一行開始**。窗要成長到多大，是用**引文的長度**算的，不是行數：接受的匹配起點在 `first.length` 之前、長度是 `needle.length`，所以窗長到這兩者相加就不可能再有新的、起點還在這一行的匹配。**這裡不能用固定行數**——markdown 的段落之間有空行，八行的窗只夠四段，跨五個短段落的標記會在原稿一個字都沒改的情況下被判定失效。空行接起來等於沒接（`normalize` 兩邊都會併掉空白），所以窗只走有字的行，一長串空行不會被每一行、每一則註記重走一遍。

### 10.2 伴隨檔

`<book>.md.notes.json`，就放在 `.md` 隔壁。刪掉檔案＝所有標記消失，這是規格不是副作用，所以 `preview.ts` 掛了 `FileSystemWatcher`；最後一則被刪掉時 `writeNotes()` 會把檔案一起刪掉，不留空殼。

長標記在檔案裡是**掐頭去尾**的（超過 120 字，前後各留 45），另存 `quoteLength`。整段整段標下去很常見，逐字存等於在伴隨檔裡複製一本書；而重新定位本來就只用得到頭尾。

### 10.3 從清單點一則註記

點下去要做兩件事：**翻到那個標記，並且把它標成「現在在看的那一則」**——書上畫黑框，清單那一列同時反白，兩邊講的是同一則。再點一次別的就換過去，Esc 放掉。編輯意見留在「編輯」鈕上，因為那是個蓋住整頁的對話框，跟「讓我看到那個標記」直接衝突。

會需要 `chapterStartLines`，是因為 **CFI 要等那一章被算繪出來才存在**——它是 `drawSection` 生的，而 `drawSection` 只跑在已載入的 section 上。所以稍具規模的書，清單裡多數註記根本沒有 CFI，點下去只能落到編輯器，讀起來就是「這個清單只能編輯、不能導航」。改成：先用註記的行號查出它在第幾章、跳過去、**等畫完**（`redrawAll()` 會回傳那條 draw chain；`goTo` 只保證 renderer 動了，不保證畫過），這時 CFI 才有值，再跳到確切位置。

章的 href 取自 TOC 本身（`el.toc.__items[i]`），不是自己拼的——那是章節下拉選單已經在用的字串，不必再猜 foliate 想怎麼寫路徑。兩邊同序、一章一筆。

選取狀態記的是 **note id 不是 CFI**：CFI 每次重建都會重生，記 CFI 的話打一個字就掉了。畫法是拿框裡的 `Overlayer.highlight` 畫完再往那個 `<g>` 加 stroke，這一頭不自己造任何 SVG 元素（`createSVGElement` 綁的是它自己 realm 的 document）。邊框顏色寫死不用 `var()`：custom property 沒送到會算成黑色，而這裡畫的就是黑色，用 var 等於讓自己的失敗看不見。跨行的標記會一行一個框、框邊相接，這是選擇的結果——要畫成單一外框就得算聯集輪廓，而一行一框已經足夠讀成「這是同一個選取」。

### 10.4 引文是算繪後的字，原稿是 markdown

這兩個永遠不會是同一個字串，而重新定位就是拿前者去後者裡面找。所以比對前兩邊都先過 `matchable()`：去掉空白、去掉連結的目標、去掉 markdown-it 會吃掉的那些符號。

**為什麼以前沒事**：大部分標記要嘛不含語法，要嘛整段包在一對語法**裡面**——`**兩者兼備**` 算繪成 `兩者兼備`，它仍然是原始行的子字串。會壞的是語法夾在被標文字**中間**的時候，而表格的 `|` 就是最日常的那個：`| 321 KB | 62 | 1.7 ms |` 算繪出來是 `321 KB 62 1.7 ms`，中間的 `|` 沒了，於是引文根本不是原始行的子字串。實際症狀是一則橫跨表格欄位的標記回報「找不到原句」，而它的螢光筆就畫在那裡。跨越 `**粗體**` 或連結的標記也一樣。

空白一併去掉不只是為了整齊：一段被硬換行成兩行的文字，算繪後是用一個空格接起來的一行，引文對那個空格的所有權並不比對原本的換行多。兩邊都拿掉之後，下面那個把行接起來的視窗搜尋就可以直接相接、不必補分隔符，而且是精確的。

**是字元剔除，不是真的跑一次 markdown**。這段程式每次重建都要對每一則註記跑過每一行——實測是 3000 行的稿子配 60 則註記——每行跑一次 `plainText()` 差了好幾個數量級。代價是比對比 markdown 自己的規則寬鬆；「取離記錄行最近的那個」本來就在那裡守著，而「真的被刪掉的引文仍然要判 stale」有測試釘住。

順帶一提：**判為 stale 的註記不會畫任何東西**（`anchorInDocument` 直接回 null）。所以如果面板寫著「找不到原句」而書上還看得到一塊反白，那塊**不是**我們畫的——瀏覽器自己的選取在框失去焦點時會變成灰色而不是消失，截圖上兩者一模一樣。斷言 13 釘的就是這件事。

### 10.5 找不到原句的時候

保留並標記，不是丟掉。意見是這裡面最貴的東西，被一個無關的編輯默默清掉是比較嚴重的失敗——面板上會出現 ⚠，附「編輯」和「刪除」讓使用者自己決定。

### 10.6 兩個會靜默壞掉的地方

- **要在 `create-overlay` 畫，不能在 `load` 畫。** paginator 是 `await view.load()` 之後才 dispatch `create-overlayer` 的，`load` 那時候 overlayer 還不存在，`addAnnotation()` 會找不到它然後什麼都不做，也不報錯。
- **`--overlayer-highlight-opacity` 預設 0.3**，會再乘上顏色自己的 alpha，結果大約 0.15，淡到要找。顏色的 alpha 寫在顏色裡，所以這個乘數要設回 1。這個值沒有辦法用參數傳進去——overlayer 是自己在 highlight 的 `<g>` 上寫 `opacity: var(--overlayer-highlight-opacity, .3)`（`overlayer.js:184`），所以只能靠 custom property。
- **custom property 不會跨文件邊界，而畫線的地方在裝置框裡。** overlayer 的父節點是 paginator 用自己 realm 的 `document` 建的（`paginator.js:202`），§6.1 改成 iframe 之後那個 realm 就是裝置框的。所以顏色只寫在 webview 的 `reader.css` 裡時，`fill: var(--mark-yellow)` 是對著一個沒聽過這個名字的文件解析的——五個顏色全部畫成黑色，opacity 退回 0.3。**沒有任何東西會報錯**：SVG 在、`getAttribute('fill')` 讀回來完全正確、overlayer 的子節點數也一如預期，所以 spike 原本那九條斷言全部照過。顏色因此獨立成 `media/marks.css`，webview 端 `@import`，裝置框端 `<link>`，兩份文件載同一個檔案；spike 的 1b 斷言看的是**計算後**的 `fill` 和 `opacity`，不是 attribute。

---

## 11. 閱讀器體驗（M5）

M5 加的是「讀這本已算繪好的書」的能力，不是另一條建置管線。所有外觀操作都留在 webview 裡，直接改同一個 Foliate renderer；搜尋、書籤、歷史與進度也都以 Foliate 的 CFI／fraction 為座標。裝置框尺寸仍由 §6.1 的邏輯決定，`Aa` 沒有權力改它。

### 11.1 `ReaderProfile`

`src/reader-state.ts` 定義 version 1：

```ts
interface ReaderProfile {
  version: 1
  fontSize: number
  fontFamily: 'publisher' | 'serif' | 'sans-serif' | 'monospace'
  bold: boolean
  lineHeight: number
  characterSpacing: number
  wordSpacing: number
  pageMargin: number
  textAlign: 'publisher' | 'left' | 'justify'
  columns: 'auto' | 'single' | 'double'
  readingMode: 'paginated' | 'scrolled'
  theme: 'publisher' | 'system' | 'light' | 'paper' | 'sepia' | 'gray' | 'dark'
}
```

Host 端是規格邊界：每次收到 `reader:profile-save` 都驗 enum、夾數值範圍、把字級量化成 10% 一階，再用 `reader:profile` 回傳正規化後的 profile 和 CSS。Webview 不自行相信送出的值。資料存在 `globalState['mdepub.readerProfile']`，所以所有書共用，但不做跨機器同步。

預設 profile 產生**空字串 CSS**，paginator 也不留任何覆寫 attribute。這點比「把內建值再寫一次」重要：出版者 CSS 日後可能改，Reset 的意思必須是移除 reader override，不是回到一組我們猜的數字。

字體只用系統 stack，不從網路抓字型。主題把 `--theme-bg-color` 一起設好，讓 paginator 的框外背景跟章節文件同色。`publisher` 完全不碰前景／背景；`system` 用 CSS system colors，其他主題用固定的前景、背景與連結色。

### 11.2 套用外觀的順序

每次 profile 改變：

1. 記下 `view.lastLocation.cfi` 和 fraction 備援。
2. 對原本的 `view.renderer` 呼叫 `setStyles()`。
3. 在同一個 paginator 設定／移除 `flow`、`margin`、`max-column-count` 與 `max-column-count-portrait`。
4. 等 `FontFaceSet.ready`、兩輪 paint 與 paginator 的 layout；每一段等待都有 timeout，壞字型或背景分頁不能凍住後續操作。
5. 用 renderer 的 `goTo(resolveNavigation(cfi))` 回原位。刻意繞過 `view.goTo()`，因為外觀回復不是使用者的導航，不該污染歷史。CFI 失效才退到 fraction。
6. `redrawAll()`，讓畫線按新幾何重畫。

這整段與換書共用一條 promise chain，快速拖 slider 時只套最後一份 profile，不會跟正在 `open()` 的新書互拆 renderer。`book` 和 renderer identity 都不變，也不會 post `book` request 給 host。

Markdown 重建是例外：它本來就必須換書。新流程在 `view.open(book)` 之後、`init()` 回復位置之前先套 profile，因此沒有一頁用出版者樣式算好、下一拍才跳版。註記仍照 §10 從 `.md` range 重生 CFI。

Foliate 原本在 portrait 強制單欄，只有 `max-column-count` 不足以表達使用者明確選的雙欄，所以 vendored paginator 增加 `max-column-count-portrait` attribute。`auto` 會移除兩個 attribute，回到 upstream 的 portrait／spread 判斷。

### 11.3 每份稿件的閱讀狀態

```ts
interface BookReaderState {
  version: 1
  cfi: string | null
  fraction: number
  bookmarks: Array<{
    id: string
    cfi: string | null
    fraction: number
    chapter: string
    created: string
  }>
  lastUsed: number
}
```

Key 是 canonical URI 的 SHA-256，不把完整路徑塞進 globalState key。CFI 是第一選擇；稿件修改使它失效時用 overall fraction。`lastUsed` 每次開書、換頁或改書籤都更新，整個集合最多 100 筆，超過就刪最久沒用的。

Webview 每次 `relocate` 都把最新狀態送到 host 的記憶體 cache，host 對真正的 `globalState.update()` 做 500ms debounce。這個切分是為了可 flush：切換稿件與 panel disposal 時，host 已經握有最後位置，可以立刻把 pending cache 寫掉；若 debounce 放在 webview，panel 被銷毀後就拿不到尚未送出的那一頁。書籤與 profile 不走 debounce，當下保存。

協定有四個權威訊息：

| Host → webview | Webview → host | 用途 |
|---|---|---|
| `reader:profile` | `reader:profile-save` | 全域外觀；host 回正規化 profile 與 CSS |
| `reader:book-state` | `reader:book-state-save` | 每書位置與書籤；訊息帶 `bookId` 防切稿競態 |

外觀或閱讀狀態訊息都不能呼叫 `buildForPreview()`；extension 測試以 `book` 訊息數量釘住這條界線。

### 11.4 搜尋、書籤、歷史、進度

搜尋直接用 `view.search()`，也就是 vendored Foliate `search.js` 的 whole-book async generator。設定 `matchCase: false`，結果逐章送出：UI 一邊顯示掃描進度，一邊建立章節群組、snippet 與命中數。新 query 先增加 generation、對舊 iterator 呼叫 `return()`，再排進同一條 search chain；舊 generator 就算正在等某章解壓，也不能把結果寫回新查詢。`clearSearch()` 同時清掉 overlayer 裡的舊命中。

書籤在當下 CFI 和 fraction 都保存。清單按 fraction 排序、依章名分組；導航先試 CFI，再試 fraction。當前位置用 CFI 相等或極小的 fraction 距離判斷 `☆`／`★`，避免一次排版造成肉眼同頁卻無法移除。

歷史沿用 Foliate 的 `view.history`：目次、內部連結、搜尋、書籤與 `goToFraction()` 本來就會 push。頁面／捲動 relocate 只 replace 當前 entry。外觀與裝置回復直接走 renderer，所以不 push。工具列只把 `canGoBack`／`canGoForward` 暴露成 `↶`／`↷`。

進度 range 在拖曳中走 renderer，避免每一個 `input` 都塞一筆歷史；`change` 才呼叫 `view.goToFraction()` 留下一筆正式跳轉。拖曳中也不持久化中間位置，最後 relocate 才保存。

搜尋、書籤、既有註記共用一個 drawer，一次只開一頁。寬面板時佔右欄；700px 以下覆蓋在 stage 上，不改裝置框的宣告尺寸。

### 11.5 驗證邊界

`test/reader-state.test.ts` 檢查所有範圍／enum、migration、CSS、global profile、每書隔離與 100-entry LRU；`test/extension.test.ts` 檢查四種協定訊息的 save／echo，並釘住它們不產生新 `book`。

`spike/reader-experience.html` 載入真正的 `media/reader.html` 和 bundled stage，在 Chrome 裡檢查 book／renderer identity、計算後字體與顏色、CFI 回復呼叫、欄數／flow、裝置 viewport、畫線、CJK 搜尋與 stale-query cancellation、書籤、進度與歷史。這能進 closed shadow roots 唯一留下的 public handles，但仍不能模擬 VSCode service worker 依 webview id 解資源的規則；打包後仍要在真的 VSCode webview 開一次。

### 11.6 延後項目

亮度是作業系統／編輯器責任。翻頁動畫、字典／翻譯、朗讀、行導引與閱讀統計需要更大的平台或無障礙設計，M5 不以半套 UI 先佔位置。

### 11.7 介面語系不是書籍語系

介面以英文為 source language 與無條件 fallback，不能再把繁中散落在 HTML、裝置表或動態狀態字串裡。Host 把 `vscode.env.language` 正規化後放進 `config.locale`；目前 `zh-TW`、`zh-Hant`、`zh-HK`、`zh-MO` 使用繁中目錄，其餘語系回退英文。未知語系絕對不能回退中文。

`reader.html` 本身只放英文，並用 `data-i18n`、`data-i18n-title`、`data-i18n-placeholder`、`data-i18n-aria-label` 標出靜態文字；搜尋結果數、書籤、註記、錯誤與狀態則全部走 `reader.js` 的同一份 runtime catalog。這樣頁面載入時不會先閃出中文，靜態與動態文字也不會使用兩套語言。

裝置表的 `group` 是 `phone`／`tablet`／`ereader`／`desktop` 這類不帶語言的 key，翻譯只在 webview 發生。Command Palette 與 Settings 頁使用 VSCode 原生的 `package.nls.json`／`package.nls.zh-tw.json`，出貨的 README 以英文撰寫。

`mdepub.lang` 是 EPUB metadata 與內容語言，和介面語言分開。frontmatter 或明確設定仍然優先；設定留空時使用 VSCode 顯示語言的 canonical BCP 47 tag，即使該語系尚無介面目錄也不會被改成英文。TOC 這類產生進書裡的文字依書籍語言決定，不依當下 UI。

`test/i18n.test.ts` 釘住英文 fallback、語系正規化、manifest key 完整性，以及 parser warning 的語系；瀏覽器 harness 另外切換英文、繁中與未支援語系，確定 `Aa` 面板沒有硬編碼中文。
