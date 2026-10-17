# 社区新提交复验（2026-10-17）

本次按用户要求核对 issue、远端分支及另一成员的阶段交付。只获取远端并独立检查源码，没有合并或覆盖当前工作区的社区模块，没有操作真实数据库或上传文件。当前编辑界面改动仍在本地 `codex/welcome-multi-photo-frames`，未提交。

## 远端快照

| 分支 / PR | 核对结果 |
|---|---|
| main | `c175cb27fdce519fdb310d8dd7ad6f0f0043eae2`，未变 |
| community_banch_2 | 从 `acbc47e` 更新至 `87a0ae1ec68b7cef7b6a39975a533b6bc9374022`，作者提交时间 10-17 16:17（UTC+8） |
| community_branch | 仍为旧提交 `77ac7ee` |
| codex/community-editor-integration / PR #9 | `fb47980`；PR 仍 open，尚未合入 main |

新提交只改四份源码：配方 schema、其验收脚本、社区 app.js、社区 style.css。没有提取其中的演示数据库、上传照片或 Python 缓存。获取时 #3/#4 没有新的成员验收回复；本次复验后已补充下述评论。

## 已通过的部分

- 新上游 `verify_acceptance.py` 独立运行：**35 PASS / 0 FAIL**，含 filter.name / curve.channel / hsl.band / 步骤 type / 蒙版 type 的非法数组输入，返回 400 而非 500，拒绝后不落库。
- 当前 EditorCore 实际生成的完整 v6、旧配方、迁移后 v6 经过新上游真实 Flask 发布/详情接口，version、rendering、steps 保持一致；读回编辑状态一致。7 类其他非法输入仍被拒绝，旧 schema 增量迁移保留原记录与旧版语义。
- 390px 下在新上游服务装载合成作品，检查列表、长 JSON 详情、发布表单：页面 scrollWidth=390，未发现可见元素超出屏幕右边；无页面脚本错误。这个结论限于本次场景，不代表所有设备/浏览器全面验收。

## #4 仍存在的问题

1. **人工前后图只比较尺寸。** 用同一份合成 PNG 内容分别选入前图/后图，发布返回 201，两次上传 URL 不同，仍按前后双图呈现。尺寸相同不能保证来自同一照片/构图，也不等于视觉不同。编辑器自动生成的受控配对与人工封面需要区分。
2. **新增消息协议与已交付的编辑器约定不一致。** 独立父页接收到了 `landscape:community-ready`（ts）；按当前编辑器发送 connect/share 后没有填入配方，预览发出了另一套数据结构。对照如下。

| 项目 | 当前编辑器 / PR #9 | 新社区原生接口 |
|---|---|---|
| 握手 | landscape:connect → landscape:ready | landscape:community-ready |
| 配方分享 | landscape:share，payload | landscape:share-recipe，顶层 recipe |
| 预览 | landscape:preview，payload | landscape:preview-recipe，顶层 recipe/meta |
| 时间 | sentAt | ts |
| channel | 父页握手指定 | URL query 或固定缺省值 |

这里检查的是新社区原生接口，没有移除或覆盖现有 community-bridge.js 来制造本地回归；不把“有 postMessage”直接写成双方已互通。

3. **独立跨端口兜底未改变。** 仍使用 localStorage + EDITOR_URL；不能跨端口共享当前照片、编辑内存及历史。

## 反馈与接续

- [#3 复验评论](https://github.com/maiuyb/Landscape-platform/issues/3#issuecomment-6232438083)：新分支非法集合字段修复通过；main/本地组合服务尚未引入本次修复，暂保留接入追踪。
- [#4 复验评论](https://github.com/maiuyb/Landscape-platform/issues/4#issuecomment-6232438305)：手机场景通过；人工图对、消息协议、独立跨端口仍需社区侧处理。
- 后续接入应按文件和协议核对；后端包内导入、隔离路径以及现有编辑器适配需要保留，不整包覆盖。

没有公开发布测试作品、上传测试资料、读取课程资料或调用真实 AI。源码副本、合成数据及浏览器产物保留在已忽略的本机测试目录，不纳入 Git。#5/#7 的本地功能实现及最新菜单反馈见 [WELCOME-MULTI-FRAME.md](WELCOME-MULTI-FRAME.md)，#6 仍关闭且不做。

## 同日交付接入（覆盖前文的“尚未接入”状态）

用户随后授权推送当前成果。当前分支同步了 87a0ae1 的 recipe_schema.py、社区 app.js 和 style.css，保留编辑器适配层来处理实际同源交接，未重新实现社区业务。组合流程 7 组已再次通过，含新旧完整配方 6 次渲染逐像素一致、真实自动前后图、身份/收藏、预览范围/应用/撤销、迟到消息及无图待用；390px 社区页也通过。接口非法输入由 7 类扩到 17 类，数组和对象枚举均返回 400，记录数不变。#3 修复可以关闭；#4 人工图对及原生独立部署协议待办继续保留。见 DELIVERY-2026-10-17.md 和 #8 的最终 PR。
