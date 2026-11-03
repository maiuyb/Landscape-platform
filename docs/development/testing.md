# 检查与测试

## 环境与统一入口

在根目录完成 `npm ci`、创建 `.venv` 并安装后端依赖。整理期间使用 Node.js 22.17.0、Python 3.13.5 和仓库锁定的 Playwright 1.64.0。自动化浏览器为 Playwright Chromium，不能据此宣称全部浏览器兼容。

```powershell
npm.cmd test
npm.cmd run test:backend
npm.cmd run test:integration
npx.cmd playwright install chromium
npm.cmd run test:browser
```

| 命令 | 覆盖范围 |
| --- | --- |
| `npm test` | 自动发现 `tests/*.test.cjs`；编辑状态、历史、渲染、颜色/细节/蒙版、预设、AI/社区适配、配方版本及透视算法 |
| `npm run test:backend` | `unittest` 自动发现 `tests/test_*.py`；AI、上传、缩略图、认证、资料/隐私、私有配方、积分/邮箱/赞助和部署工具 |
| `npm run test:integration` | 实际前端配方 → 临时 Flask API/SQLite → 前端读取的往返，比较版本/参数与渲染结果 |
| `npm run test:browser` | 依次运行 `tests/*-browser.cjs`，自动启动临时本地服务；部分专项自行覆盖根路径和 `/landscape` |

测试 runner 使用 `.venv` 中的 Python；后端命令在无本地 venv 时退回 `python`。浏览器隔离服务与往返检查要求已准备 `.venv`。无需为统一浏览器命令提前执行 `npm start`，也无需外部照片下载。

## 专项运行

统一浏览器命令接受一个或多个完整文件名，例如：

```powershell
npm.cmd run test:browser -- editor-browser.cjs editor-ai-browser.cjs
npm.cmd run test:browser -- auth-security-browser.cjs account-preferences-browser.cjs
```

| 主题 | 浏览器专项 |
| --- | --- |
| 编辑与渲染 | `editor-browser`、`editor-color`、`editor-detail`、`editor-local-adjustments`、`editor-preview`、`editor-comparison-grip` |
| 历史、预设与会话 | `editor-feedback`、`editor-history-gesture`、`editor-geometry-history`、`editor-presets`、`editor-workspace`、`editor-welcome`、`welcome-images`、`welcome-startup` |
| AI 与配方复用 | `editor-ai`、`editor-recipe-reuse`、`editor-share-cancel`、`editor-account-workflow` |
| 构图 | `editor-upright`、`editor-upright-loupe` |
| 社区与部署路径 | `editor-community`、`community-main-compatibility`、`community-images`、`community-loading`、`community-recommendation-images`、`deployment` |
| 用户管理 | `auth-security`、`account-preferences`、`author-portfolio`、`user-center`、`credits`、`work-management` |

表中名称均补上 `-browser.cjs`。界面已移除的配方文件下载/导入不再作为操作入口；底层配方/像素回归通过仅限本地测试的 observer 读取状态，并经当前配方预览流程注入合成样例。账号保存与社区发布仍通过实际界面/API 检查。

`welcome-images` 检查固定前后图、滑杆和保留动画、零编辑渲染调用、重复切换不新增图片请求、迟到加载不覆盖最新选择、失败重试，以及根路径/子路径和手机布局。

`welcome-startup` 延迟首组原图与效果图，等待真实开屏动画结束，检查内嵌预览仍可见、原图不等效果图就能显示，以及最终对比滑杆就绪；根路径和 `/landscape` 分别验证。

`test_community_import.py` 检查社区素材的预检、原位更新、重复导入、非法图片/配方/来源拒绝和写入失败回滚，保留收藏、作者及无关作品。它使用临时合成素材，不要求本地存在 200 张摄影资料。真实交付包另通过[社区素材导入](../operations/community-library.md)的准备工具逐张验证。

`community-loading-browser` 控制慢响应、临时失败和持续失败，检查最多 4 个并行图片请求、慢图不阻塞其他图片、有限重试且不下载原图、远处图片暂缓、实际列宽选图和放大时取原图。根路径和 `/landscape` 均覆盖。后台预生成、单次解码多尺寸、公开图片/私有接口缓存边界和 Nginx 配置失败恢复另有后端测试。

## 夹具与结果

`isolated-browser-support.cjs` 管理服务生命周期；`community-test-server.py` 使用临时存储和合成账号种子；`credits-browser-server.py` 使用内存邮箱。测试用入口只存在于夹具，不注册到生产应用。功能账号检查通过夹具准备用户，认证专项通过真实认证接口检查邮箱与挑战。

`photo-support.cjs` 指向仓库随附且有许可记录的照片；其他检查使用绘制的合成像素图。功能测试模拟外部 AI/邮件，不向公网发布作品或调用收费模型。测试服务只绑定回环地址，数据放临时目录，服务退出后清理。

每个浏览器专项的完整输出位于 `test-results/checks/<文件名>.log`，截图/报告在各自子目录。目录已被 Git 忽略。出现失败时检查对应日志，修复后只重跑受影响专项；通过后不需要反复执行无关检查。

## 人工照片效果与性能评审

以下工具用于人工效果观察，独立于必要功能回归。先启动本地演示服务（建议 `AI_MODE=demo`），默认地址为 `http://127.0.0.1:5050`，可用 `HMI_TEST_URL` 指向另一回环地址。

```powershell
npm.cmd run review:photos
npm.cmd run review:color
npm.cmd run review:presets
.\.venv\Scripts\python.exe scripts/fetch-detail-photos.py
npm.cmd run review:detail
npm.cmd run review:effects
npm.cmd run review:interaction
npm.cmd run review:welcome
```

`review:welcome` 自行启动隔离服务；其余工具使用已启动的服务。下载清单在 `tests/photo-fixtures.json`，来源限流或网络不可用时需重试。历史评审输出沿用 `test-results/e1/e2/e3/e4/` 目录，避免与已有照片下载重复；这些名称只是本机产物位置，不是产品阶段状态。

`thumbnail-resource-probe.py` 是可选大图/并发资源诊断工具，使用合成图片和临时目录：

```powershell
.\.venv\Scripts\python.exe tests/thumbnail-resource-probe.py --module '风景调色协作平台/backend/thumbnails.py'
```

## 验证边界

2026-11-03 整理验收：核心 73 项、后端 110 项、配方往返（含 17 类无效输入）、28 个浏览器专项均已通过。浏览器完整运行通过 27 个；发现头像异步渲染等待不充分后，修正并单独复跑剩余专项通过。另通过 121 个源码/测试文件的语法检查及 45 个本地文档链接检查。程序断言和一次机器计时不能证明正式用户易用性、审美质量、延迟分位数、长期负载能力、真实邮件可达性或云端模型效果。用户任务与访谈另见[研究计划](../research/plan.md)。
