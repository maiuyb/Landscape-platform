# 社区与编辑器联调记录（2026-10-16）

本轮起点为 `main/c175cb27fdce519fdb310d8dd7ad6f0f0043eae2`。只读获取的远端状态：`main` 未变，实际更新为 **`community_banch_2/acbc47e7bfe55aeb8370964987d7feb260e8dc96`**；`community_branch/77ac7ee` 是旧代码。本轮交付分支为 `codex/community-editor-integration`，通过独立 PR 向 main 提交，提交及合入状态见 [交付跟踪 #8](https://github.com/maiuyb/Landscape-platform/issues/8)。早先的交接文档随本轮保留提交，用户课件不纳入 Git。

## 独立验收

- 只从新分支提取源码，未提取演示数据库、图片、缓存或旧文档覆盖工作区。
- 原分支 `verify_acceptance.py` 在临时库运行：**30 PASS / 0 FAIL**。
- 当前编辑器 `EditorCore.toRecipe` 实际生成完整 v6、旧版及迁移后 v6，经过真实 Flask 发布/详情接口：version、rendering、steps 保持一致。覆盖 0.8 EV、−20 高光、八色 HSL、四曲线、相对白平衡、细节、暗角/RGB 校准、旋转/翻转/裁剪/拉直及三类蒙版。
- 横向、纵向两种合成图，各三份配方，往返前后由同一 Core 渲染：**6 次逐像素一致**。
- 7 类常见非法输入返回 400 且未落库；旧数据库增量迁移保留旧记录、v1 语义与已有字段。
- 编辑器适配修复：旧详情返回 `rendering:null` 时按缺省标志处理；含不支持/无效步骤的社区配方拒绝整份预览，避免默默删除。

## 源码来源与改动边界

来源路径：`Landscape-platform-community_branch/community-demo/`。

| 本地位置 | 来源与接线差异 |
|---|---|
| `风景调色协作平台/backend/community_modules/{auth,community,config,db,recipe_schema,repository}.py` | 复用 acbc47e 的模块；导入改为包内相对导入，db 连接读取当前 Flask app 的存储路径，支持隔离测试。业务校验/查询实现未重写。 |
| `风景调色协作平台/frontend/community/{app.js,style.css}` | acbc47e 原始源码，保持原样。 |
| `风景调色协作平台/frontend/community/index.html` | 原页面只调整静态资源路径，并加载编辑器的主题/适配脚本。 |
| `frontend/community-bridge.js`、`community-host.css` | 编辑器所有的交接与宿主主题；不把社区业务变更混入其原始 app.js。 |

主服务继续使用原 `backend/app.py`，只组合社区蓝图和数据层，移除冲突的旧 `/api/recipes` CRUD 与旧 like 路由。注册/登录返回同一社区 token；收藏使用社区 `/favorite`。AI、20MB 上传边界和现有用户工作数据保留。启动时增量补 schema，不执行演示 seed；测试只用临时存储，本轮未启动真实工作库服务。

`LANDSCAPE_DB` / `LANDSCAPE_UPLOAD_DIR` 可指定隔离路径；缺省仍是原工作数据库和上传目录。不得将演示数据复制覆盖到它们。

## 页面与交接协议

- `/` 是当前编辑器；`/community/` 是同源社区。在编辑器里用保留 DOM 的 iframe 切换，返回时不刷新照片、参数或历史；搜索、排序、滚动和详情仍留在社区。
- 用户确认的复用规则：**默认只复用全局调色**，保留当前构图/局部调整；作者构图和局部选区分别勾选。选中构图时替换当前几何步骤，不重复叠加；选中局部选区时替换当前蒙版。选区按原图相对位置复用，弹窗明确提醒不同照片可能对不上。
- 分享：当前完整 v6 配方 + 最长边 1600px 的 PNG 预览图。调色前后均来自当前同一照片、同一构图；比较像素相同时只交调色后单图。先填社区原发布表单，**点击发布才上传**。配方不含 presetSession；元数据由社区表单填写。未登录先登录，再回到保留了配方和图片的表单。
- 预览：社区先取详情，再交给现有编辑器。先选择范围/预览，明确应用后可手调、撤销。无照片时只暂存配方，选自己的照片后重新确认；不读取作者封面替换照片。
- 会话沿用 `landscape:token` / `landscape:user`，兼容 `cd_token` / `cd_user`。社区表单的 `landscape:share-recipe` 仅作为复用原 parser 的一次性数据，读入后移除；图片 Blob 只在当前页面内存中交接。
- 正常组合流程不依赖持久 `landscape:preview-recipe` 或 `EDITOR_URL`：使用受约束的 `postMessage`。父页发 `landscape:connect`；双方核对同源、指定父/子窗口、当前页面随机 channel。后续消息含唯一 id、sentAt，5 分钟过期，重复消息丢弃。
- 子页 ready 后父页发 `landscape:share`（payload 为 `{recipe,metadata?}`，before/after 为 Blob），子页回 `landscape:share-received`；`landscape:preview` 的 payload 为 `{recipe,meta:{id,name,author}}`。关闭详情后的迟到请求失效；编辑器不在社区视图时忽略社区预览。
- 独立打开社区页面仍是上游原流程，跨端口的 localStorage 不能传当前照片/历史。不得将组合流程通过表述成独立部署已通过。

## 当前仍未通过的社区项

1. **#3 校验缺口**：`filter.name:[]`、`curve.channel:[]` 会触发集合成员检查的 TypeError，返回 500 HTML，应为 400 JSON。已在原始源码/临时库独立复现，交社区处理。[验收与复现评论](https://github.com/maiuyb/Landscape-platform/issues/3#issuecomment-6208024233)。
2. **#4 手机布局**：原社区页面在 390px 下横向溢出；编辑器新增范围弹窗无溢出。社区列表/详情/发布/登录布局仍需其负责人处理。
3. **#4 手动前后图**：上游手动表单只比较 URL，不能证明同源、同构图或视觉不同；编辑器自动分享已保证配对。独立服务跨源交接也未解决。[联调约定与剩余问题评论](https://github.com/maiuyb/Landscape-platform/issues/4#issuecomment-6208044811)。

两项 issue 保持打开，没有将“另一成员报告修复”直接作为完整验收通过。#6 已关闭、方向打光不做；#5/#7 继续暂缓。

## 验证与接续命令

- `npm test`：核心 **59 项**。
- `.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`：AI mock / 20MB 上传边界 **19 项**。
- `node tests/community-roundtrip.cjs`：当前组合服务的真实发布/详情 + 旧库迁移；可选参数为提取的上游 backend 路径，用同一组输入独立核对上游。
- `npm run test:community`：自启临时服务/数据库/上传目录，**7 组接线检查**；报告同时保留未通过的社区手机问题，不能称整站手机验收通过。
- `node tests/isolated-browser-support.cjs tests/editor-feedback-browser.cjs tests/editor-workspace-browser.cjs tests/editor-browser.cjs`：自启临时服务，**6 / 10 / 12 组**；一般编辑器浏览器测试已改为使用保留社区 iframe 的结构。

测试使用 mock AI，无收费请求；社区联调用合成图片。忽略目录 `test-results/community-integration/` 内保留原始源码核验、浏览器报告及截图，未纳入 Git 或上传。查看了手机范围弹窗与社区问题截图。未使用 computer-use，未读取课件内容或输出真实环境配置/密钥。

## 2026-10-17 更新接入与交付

本文件前文是 10-16 历史验收，最新源码来源升级为 `community_banch_2/87a0ae1`。同步其 recipe_schema.py、社区 app.js/style.css，保留本地包内导入和隔离数据路径；保留 `community-bridge.js` 作为当前编辑器的同源交接入口。新上游原生消息协议的差异由适配层隔离，未把两套协议混用。

当前组合服务已重新通过完整配方/前后图/登录/收藏/本图预览/取消/应用/撤销等 7 组检查；390px 社区和编辑器范围弹窗均无横向溢出。非法数组/对象枚举字段及其他非法输入共 17 类均 400 且不落库，旧数据迁移保留。适配层还拒绝缺失/非有限/过期时间戳，并保留有界去重。上游本体未被我们另写一套。

#3 的 schema 修复已接入并可关闭；#5/#7 已按当前用户决定实现，可关闭，不再暂缓。#4 继续跟踪人工前后图的可信配对与原生/独立部署消息协议统一；不再把已接入的手机布局列为未解决。#8 保留最终合入追踪。新完整交付 PR 包含旧 PR #9 的全部提交，替代其独立合入，避免重复审查。交付分支为 `codex/welcome-multi-photo-frames`，最新 PR 链接见 #8。

交付与后续使用测试范围见 [DELIVERY-2026-10-17.md](DELIVERY-2026-10-17.md)。未覆盖真实 DB/uploads，未读取或上传 `.env`/密钥/课件/测试产物，未再次调用真实 AI。
