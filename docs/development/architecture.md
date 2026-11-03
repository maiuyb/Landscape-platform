# 技术架构与源码入口

应用使用 Vue 3、Canvas 2D/Web Worker、Flask 和 SQLite。前端为直接加载的模块脚本，没有单独的前端打包器。`npm ci` 的 prepare 生命周期将 Vue 运行文件和许可证复制到忽略目录 `frontend/vendor/`。

## 运行与数据流

1. `scripts/start.cjs` 优先选择根目录 `.venv`，启动 `backend/app.py`。
2. Flask 同时提供主站静态页面、独立社区页面及 `/api/`。本地同源访问，Linux 部署由 Nginx 挂载到 `/landscape/`。
3. 浏览器载入原图，编辑状态由核心模型维护；渲染器调度 Worker，画布显示预览，下载时按完整尺寸渲染。
4. AI 请求发送缩略图、意图、当前参数和有限交流上下文。后端验证数据、账号与积分后调用模型，浏览器验证方案并编译为本地可执行修改。
5. 社区配方、账号、收藏和私有常用配方存 SQLite。发布图片、头像和缩略图缓存使用服务端文件目录。

欢迎页的固定滑杆对比直接使用预生成的原图/效果图。当前图片对优先解码，其余图片对在后台逐组预热并保留解码缓存；两张都就绪后才一起切换，连续选择以最后一次为准。此展示路径不调用编辑器渲染管线，进入实际编辑后才处理照片。

## 前端模块

| 入口/模块 | 职责 |
| --- | --- |
| `frontend/index.html`、`app.js` | 主站模板、页面状态、工具交互、多图生命周期、历史与对话框 |
| `editor-core.js` | 编辑状态、历史、配方序列化/迁移、完整渲染管线 |
| `editor-tools.js`、`editor-detail.js`、`editor-effects.js`、`editor-masks.js` | 基础/精细调色、细节、效果和局部蒙版算法 |
| `editor-upright.js`、`editor-upright-worker.js`、`editor-loupe.js` | 透视求解、后台分析及导引放大 |
| `preview-renderer.js`、`editor-worker.js` | 预览调度、后台渲染与兼容路径 |
| `editor-workspace.js`、`editor-frames.js` | 文件准入、照片集合及相框渲染 |
| `editor-presets.js`、`preset-sources.json` | 预设目录、强度/手调语义及来源 |
| `editor-ai.js`、`editor-community.js`、`recipe-handoff.js` | AI/社区方案验证、复用范围及一次性配方交接 |
| `community/index.html`、`community/app.js` | 独立社区、账号、作品/收藏管理及个性化设置 |
| `community-bridge.js`、`community-usability.js`、`auth-guard.js` | 主站/iframe 协作与交互适配 |
| `author-route.js`、`author-portfolio.js` | 作者路由、作品主页及分享 |
| `saved-recipes.js`、`credits-sponsor.js` | 私有配方、积分及赞助界面 |

样式按职责分文件：`style.css` 为基础，`theme.css` 为主站视觉覆盖，`welcome-workspace.css`/`gallery-curtain.css` 为首页和过场，社区及作者/配方/积分各有样式。多个文件有层叠关系，不能仅凭某个选择器未在 HTML 静态出现就判断无用。

## 后端模块

| 模块 | 职责 |
| --- | --- |
| `backend/app.py` | 组合 Flask 蓝图、静态文件、健康检查、上传/缩略图及 AI 接口 |
| `ai_service.py` | 根 `.env` 加载、模式、请求验证、模型适配、超时与进程限流 |
| `thumbnails.py` | 不依赖应用启动的缩略图服务、尺寸/缓存/并发限制 |
| `community_modules/auth.py`、`security.py` | 密码、会话、验证码挑战与认证限流 |
| `community.py`、`profile.py`、`saved_recipes.py`、`credits.py` | 社区、个人资料/隐私、私有配方、邮箱/积分/赞助业务 |
| `db.py`、`repository.py`、`recipe_schema.py`、`config.py` | 幂等数据库迁移、数据访问、配方校验与路径常量 |

社区主站嵌入使用同源消息握手；核验来源、窗口及会话通道后才处理分享/预览。外部独立编辑器地址不等于可以跨源自动转移照片或历史。

## 存储与部署边界

| 数据 | 本地默认位置或生命周期 |
| --- | --- |
| 编辑照片、历史、AI 当前照片上下文 | 浏览器当前页面内存 |
| 显示偏好、会话信息、预设收藏 | 浏览器本机存储，具体用途分键保存 |
| 账号、作品记录、私有配方、积分 | `backend/recipes.db`；可由 `LANDSCAPE_DB` 指定 |
| 发布图片与头像、缩略图缓存 | `backend/uploads/`；可由 `LANDSCAPE_UPLOAD_DIR` 指定 |
| 密钥和邮件配置 | 根 `.env` 或进程环境；服务器使用 `/etc/landscape/landscape.env` |

配置、数据库、上传文件、依赖和测试产物均不入 Git。正式部署的程序发布目录与持久数据分离，见[部署说明](../operations/deployment.md)。

缩略图宽度归并为 200/400/800/1200，源图限制 40MP，缓存最多 256MiB/1024 文件。线程门和跨进程锁限制转码并发，忙时返回 503/Retry-After；缓存按源文件版本失效并支持 ETag/304。
