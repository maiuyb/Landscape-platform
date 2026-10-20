# 社区视觉与排版美术交接包（美术馆白盒展厅 · Fine-Art Print Gallery）

- **文档版本**：2026-10-20
- **适用范围**：`风景调色协作平台/frontend/community/`（社区广场页、作品详情弹窗、发布弹窗、登录/注册弹窗）
- **基准参照**：主应用已正式落地的欢迎页方案 A（见 [`风景调色协作平台/frontend/index.html`](../风景调色协作平台/frontend/index.html) 与 [`风景调色协作平台/frontend/welcome-workspace.css`](../风景调色协作平台/frontend/welcome-workspace.css)）

---

## 一、整体美术主张：从「深色霓虹卡片」转向「现代摄影美术馆」

目前社区页（`community/style.css`）使用的是深蓝黑底色（`#0d0f15`）配青色/紫色霓虹渐变（`#22d3ee` / `#818cf8`）。为与已定稿的欢迎页保持高度统一的视觉调性，社区需整体切换为**「美术馆白盒展厅（Fine-Art Print Gallery）」**风格：

1. **大面积温润棉纸留白**：以博物馆无酸棉纸白（`#FAF9F6`）与暖灰展墙（`#F3F0EA`）替代深色霓虹背景，消除对摄影作品本身色彩判断的干扰。
2. **装裱卡纸（Passepartout）画框感**：社区中的每一张风光作品卡片不再是贴边圆角黑盒，而是带有白色内衬卡纸留白（`#FFFFFF`）、极细微内描边与柔和漫反射阴影的「展厅印相」。
3. **人文衬线标题 + 克制无衬线 UI**：展览级主标题、作品名、展签（Placard）使用中文宋体/衬线体；搜索框、按钮、参数标签、交互控件使用干净的苹果风无衬线体。
4. **森林松绿与古铜金点缀**：主行动按钮采用深沉的展厅松绿（`#1D4D3C`），导览眉题（Kicker）与编号采用温润古铜棕（`#8C653E`）。

---

## 二、核心设计变量表（可直接替换 `community/style.css` 的 `:root`）

在 [`风景调色协作平台/frontend/community/style.css`](../风景调色协作平台/frontend/community/style.css) 顶部，可将原有 `:root` 变量替换为以下与欢迎页完全对齐的 Token（同时保留旧变量名映射，方便渐进迁移）：

```css
:root {
  /* === 1. 画廊核心设计变量（与 welcome-workspace.css 同源） === */
  --gallery-bg: #FAF9F6;              /* 主背景：温润博物馆棉纸白 */
  --gallery-wall: #F3F0EA;            /* 次级展墙背景：暖灰亚麻墙面（用于 Hero 横幅、分区底色） */
  --gallery-mat: #FFFFFF;             /* 作品装裱卡纸 / 卡片主体：纯白卡纸 */
  --gallery-ink: #171817;             /* 一级正文与主标题：深炭黑墨色 */
  --gallery-body: #595C59;            /* 二级正文与作品描述：中性暖灰 */
  --gallery-caption: #858984;         /* 三级展签、时间、作者辅助说明：浅石灰 */
  --gallery-forest: #1D4D3C;          /* 主强调色（主按钮/激活态）：画廊森林松绿 */
  --gallery-forest-hover: #153B2E;    /* 主强调色悬停态 */
  --gallery-bronze: #8C653E;          /* 次强调色（眉题 Kicker/罗马数字/徽章）：温润古铜金 */
  --gallery-border: rgba(23, 24, 23, 0.08);         /* 常规分割细线 */
  --gallery-border-strong: rgba(23, 24, 23, 0.16);  /* 按钮与输入框描边 */

  /* 字体栈 */
  --gallery-serif: "Songti SC", "Noto Serif SC", "Source Han Serif SC", Georgia, serif;
  --gallery-sans: "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;

  /* 展框阴影体系 */
  --gallery-shadow-print: 0 36px 80px -28px rgba(20, 22, 20, 0.14), 0 2px 10px rgba(20, 22, 20, 0.04);
  --gallery-shadow-card: 0 24px 52px -22px rgba(20, 22, 20, 0.11), 0 1px 6px rgba(20, 22, 20, 0.03);
  --gallery-shadow-inset: inset 0 0 0 1px rgba(23, 24, 23, 0.08);

  /* === 2. 兼容现有 community/style.css 旧变量名的直接映射 === */
  --bg: var(--gallery-bg);
  --bg-2: var(--gallery-wall);
  --card: var(--gallery-mat);
  --card-2: #F7F5F0;
  --line: var(--gallery-border-strong);
  --text: var(--gallery-ink);
  --muted: var(--gallery-body);
  --dim: var(--gallery-caption);
  --accent: var(--gallery-forest);
  --accent-2: var(--gallery-bronze);
  --green: #1D4D3C;
  --red: #B84A39;
  --yellow: #9E7332;
}
```

> [!IMPORTANT]
> 修改 `:root` 后，请记得将 `body` 的 `background: radial-gradient(...)` 改为纯色 `background: var(--gallery-bg); color: var(--gallery-ink); font-family: var(--gallery-sans); line-height: 1.65;`，去掉原先的深蓝径向发光背景。

---

## 三、字体与排版层级规范（Typography Scale）

| 排版角色 | 适用位置 | 字体族 (`font-family`) | 字号与行高 | 字重与字距 | 颜色 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **展览眉题 (Kicker)** | 区域顶部英文导引（如 `CURATED COMMUNITY GALLERY`） | `--gallery-sans` | `12px` / `1.4` | `600`，`letter-spacing: 0.22em`，全大写 | `var(--gallery-bronze)` (`#8C653E`) |
| **展厅大标题 (H1)** | 社区首屏主标题 | `--gallery-serif` | `clamp(30px, 3.8vw, 46px)` / `1.18` | `600`，`letter-spacing: -0.015em` | `var(--gallery-ink)` (`#171817`) |
| **分馆标题 (H2)** | 「编辑精选馆藏」「最新公开配方」等区块标题 | `--gallery-serif` | `clamp(22px, 2.6vw, 30px)` / `1.25` | `600` | `var(--gallery-ink)` |
| **作品展签标题 (Card Title)** | 作品卡片标题、详情弹窗标题（建议可带 `Fig. 01 —` 展签感） | `--gallery-serif` | `16px–18px` / `1.4` | `600` | `var(--gallery-ink)` |
| **导语与正文 (Lead / Body)** | 社区导语、作品创作手记、调色思路说明 | `--gallery-sans` | `14px–16px` / `1.75` | `400` | `var(--gallery-body)` (`#595C59`) |
| **展签元数据 (Caption)** | 作者名、发布时间、参数摘要、点赞/复用计数 | `--gallery-sans` | `12px` / `1.5` | `400` | `var(--gallery-caption)` (`#858984`) |

---

## 四、关键组件美术规范与 CSS 写法示例

### 1. 顶部导览栏与搜索框（`.topbar` & `.search-wrap`）
- **背景**：半透明暖白毛玻璃 `background: rgba(250, 249, 246, 0.92); backdrop-filter: blur(16px); border-bottom: 1px solid var(--gallery-border);`
- **品牌字标（`.brand`）**：使用 `--gallery-serif`，字号 `17px`，副标题 `span` 使用 `--gallery-bronze`（`#8C653E`）。
- **搜索框（`.search-wrap`）**：改为胶囊造型 `border-radius: 999px; background: #FFFFFF; border: 1px solid var(--gallery-border-strong); height: 40px;`；聚焦时 `border-color: var(--gallery-forest); box-shadow: 0 0 0 3px rgba(29, 77, 60, 0.1);`。

### 2. 社区展厅横幅（`.hero`）
- 取消原有的青紫发光渐变球（删除 `.hero::after` 的 `rgba(34,211,238,0.25)`）。
- 采用暖灰展墙容器：
  ```css
  .hero {
    max-width: 1240px;
    margin: 32px auto 0;
    padding: 40px 48px;
    border-radius: 6px;
    background: var(--gallery-wall);
    border: 1px solid var(--gallery-border);
  }
  .hero-text h1 {
    font-family: var(--gallery-serif);
    font-size: clamp(26px, 3.2vw, 36px);
    font-weight: 600;
    color: var(--gallery-ink);
  }
  .hero-stats .stat b {
    font-family: var(--gallery-serif);
    font-size: 26px;
    color: var(--gallery-forest);
  }
  ```

### 3. 作品卡片：博物馆装裱卡纸（Passepartout Card）
社区瀑布流/网格中的每个作品卡片，建议采用**「白卡纸内衬 + 底部展签」**结构，照片四周留出 `14px–20px` 的纯白卡纸边（而不是让图片顶满卡片边缘）：

```css
.post-card {
  background: var(--gallery-mat);
  padding: 18px 18px 20px;
  border-radius: 4px;
  border: none;
  box-shadow: var(--gallery-shadow-card), var(--gallery-shadow-inset);
  transition: transform 0.28s ease, box-shadow 0.28s ease;
}
.post-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--gallery-shadow-print), var(--gallery-shadow-inset);
}
.post-card .thumb-wrap {
  border-radius: 2px;
  overflow: hidden;
  background: #141514;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}
.post-card .post-title {
  margin-top: 14px;
  font-family: var(--gallery-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--gallery-ink);
}
```
- **画幅建议**：若后续支持多画幅展示，可在精选中保留原生 `3:2`、`2:3` 竖幅或 `21:9` 宽幅比例；常规网格卡片中图片悬停缩放请保持克制（`transform: scale(1.02)`，过渡 `0.45s ease`）。

### 4. 胶囊按钮体系（`.btn-pill` / `.btn`）
所有操作按钮（`发布作品`、`一键复用配方`、`登录 / 注册`、筛选标签）统一使用胶囊圆角（`border-radius: 999px`）：
- **主按钮（Primary / Solid）**：
  - `background: #1D4D3C; color: #FFFFFF; border: 1px solid #1D4D3C;`
  - Hover：`background: #153B2E; transform: translateY(-1px);`
- **次按钮（Ghost / Outline）**：
  - `background: transparent; color: #171817; border: 1px solid rgba(23, 24, 23, 0.16);`
  - Hover：`border-color: #171817; background: rgba(23, 24, 23, 0.035);`
- **筛选分类胶囊（Filter Tab / Edition Pill）**：
  - 默认：`background: #FFFFFF; color: #595C59; border: 1px solid rgba(23, 24, 23, 0.14);`
  - 选中（`.active`）：`border-color: #1D4D3C; color: #1D4D3C; background: rgba(29, 77, 60, 0.05); font-weight: 600;`

### 5. 弹窗规范（登录 `#authModal`、作品详情 `#detailModal`、发布 `#publishModal`）
- **遮罩层**：`background: rgba(23, 24, 23, 0.42); backdrop-filter: blur(8px);`
- **弹窗面板**：
  - `background: var(--gallery-bg);`（`#FAF9F6`）或 `#FFFFFF`
  - `border: 1px solid var(--gallery-border-strong);`
  - `border-radius: 8px;`
  - `box-shadow: 0 36px 80px -28px rgba(20, 22, 20, 0.24);`
- **前后对比滑杆（作品详情弹窗内）**：
  - 请与欢迎页及编辑器保持一致：**仅保留画面中央的圆形珠光拖动手柄**（`46px × 46px`，`background: rgba(250, 249, 246, 0.94)`，内嵌左右箭头图标），不要在图片下方额外放置一条重复的 `<input type="range">` 滑杆。

---

## 五、不可改动的交互与通信契约（重要核对项）

社区页面在嵌入主应用 `iframe` 运行时，与主工作台通过 [`community-bridge.js`](../风景调色协作平台/frontend/community-bridge.js) 通信，且有自动化回归测试覆盖。改版美术样式时**请务必保留以下 DOM 钩子与事件契约**：

1. **登录弹窗选择器**：`#authModal` 及关闭按钮 `[data-close]` 必须保留（自动化测试 `tests/editor-welcome-browser.cjs` 与主界面「登录 / 注册」按钮通过它唤起和关闭登录框）。
2. **跨窗口 `postMessage` 协议**：保持 `community/app.js` 与 `community-bridge.js` 中现有的消息类型（如应用社区配方回传编辑器、打开登录弹窗、同步登录态）不变。
3. **移动端 `390px` 零横向溢出**：在 `390px` 视口下确保 `document.documentElement.scrollWidth <= window.innerWidth`，顶部栏与筛选胶囊允许换行或横向内滚动。
