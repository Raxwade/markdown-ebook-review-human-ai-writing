---
title: 樣書：管線驗收
author: Example Author
lang: zh-TW
tags:
  - test
  - epub
---

# 樣書：管線驗收

這份稿子是拿來驗整條管線的，每一節都對應一個容易出錯的地方。

## 一、標點與轉義

AT&T、R&D，還有 `a < b && c > d` 這種會撞到 XML 轉義的字串。角括號：<not-a-tag>，以及裸的 & 符號。

實體：&nbsp; &copy; &hellip; &amp; 這幾個在 XHTML 裡沒有 DTD 就是非法的，必須在 render 階段就變成字元。

## 二、程式碼區塊

裡面的 `#` 不能被當成標題切章：

```bash
# 這是註解，不是標題
## 這也是
echo "a < b && c > d"
```

~~~python
## 波浪號圍欄裡的也一樣
print("hello")
~~~

## 三、表格與清單

| 欄位 | 說明 | 預設 |
|---|---|---|
| `splitLevel` | 切章層級 | `2` |
| `device` | 裝置框 | `iphone` |

- 項目一
- 項目二
  - 巢狀項目
1. 有序一
2. 有序二

## 四、引用、分隔線、強調

> 引用裡也有 <tag> 和 & 符號。
> 第二行。

---

**粗體**、*斜體*、~~刪除線~~、`行內程式碼`，還有[連結](https://example.com)。

## 五、圖片

下面這張圖不存在，應該產生一則警告，而且 href 不能留在輸出裡：

![缺圖](missing/nope.png)

## 六、長內文

這一節放長一點的文字，讓分頁真的有東西可以分。混雜 Latin text so the line breaker has both scripts to chew on, 中英交錯的排版才看得出行尾處理對不對。

這一節放長一點的文字，讓分頁真的有東西可以分。混雜 Latin text so the line breaker has both scripts to chew on, 中英交錯的排版才看得出行尾處理對不對。

這一節放長一點的文字，讓分頁真的有東西可以分。混雜 Latin text so the line breaker has both scripts to chew on, 中英交錯的排版才看得出行尾處理對不對。

這一節放長一點的文字，讓分頁真的有東西可以分。混雜 Latin text so the line breaker has both scripts to chew on, 中英交錯的排版才看得出行尾處理對不對。
