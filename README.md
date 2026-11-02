# 风景调色协作平台

面向修图新手与摄影爱好者的网页应用。用户可以手动调整照片、尝试预设或社区配方，也可以用自然语言向 AI 描述希望的效果。三条路径共用照片、可撤销的编辑状态和导出流程。

这是一个人机交互课程项目，重点探索：**如何让用户理解、比较并控制调色结果，以及如何在 AI 建议与手动修改之间自然切换。**

## 体验项目

- [在线演示](https://47.101.37.232/landscape/)
- [社区展厅](https://47.101.37.232/landscape/community/)

手动编辑和示例照片可直接体验；云端 AI、收藏、发布与个人管理涉及账号或服务端配置。演示站可用性取决于服务器运行状态。

建议先从首页示例进入编辑器，试用预设，修改曝光或白平衡，比较原图与结果，再导出照片或保存常用配方。也可以在社区选择作品，将配方预览到自己的照片上。

## 当前功能

| 场景 | 已实现能力 |
| --- | --- |
| 手动编辑 | 曝光与白平衡、八色 HSL、RGB 曲线、直方图、锐化与降噪、清晰度、去朦胧、暗角、局部蒙版 |
| 构图与输出 | 裁剪、旋转、翻转、拉直、自动与导引式透视矫正、原图对比、100% 细节查看、JPG/PNG 导出及带框 PNG |
| 风格尝试 | 六类 18 款预设、搜索与收藏、强度调节、悬浮预览、社区配方复用 |
| AI 协作 | 自然语言描述、多个方案、变化说明、预览后应用、继续交流、失败时保留编辑 |
| 多图工作区 | 最多 6 张照片，各自保留参数、历史和导出选项 |
| 社区与个人管理 | 浏览、搜索、分类、收藏、前后图发布、作者主页、私有常用配方、作品删除与限期找回、显示偏好和公开资料隐私设置 |

普通调色、预览和导出在浏览器内完成。主动请求云端 AI 时会发送缩略图与相关编辑信息；发布社区作品时会上传图片和配方。**编辑工作区只保存在当前页面会话内，刷新或关闭页面前请导出照片或保存常用配方。**

项目尚未提供 RAW 工作流、跨设备编辑项目同步、批量导出或生成式换天等功能。自动透视矫正依赖照片中的直线结构；自动化检查不能证明审美效果、正式用户可用性或全部浏览器兼容性。

## 本地运行

需要 Node.js、npm 和 Python 3。本次验证使用的具体版本与测试范围见 [测试说明](docs/development/testing.md)。

Windows / PowerShell，在仓库根目录运行：

```powershell
npm.cmd ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r '风景调色协作平台/backend/requirements.txt'
$env:PORT = '5050'
npm.cmd start
```

打开 [本地应用](http://127.0.0.1:5050/)，停止服务用 Ctrl+C。未设置 `PORT` 时默认使用 5000。Linux/macOS 对应使用 `npm` 和 `.venv/bin/python`；前端与 API 由同一个 Flask 服务提供，安装依赖时会准备本地 Vue 文件。

首次启动会创建空数据库与上传目录，不会自动导入演示作品。普通编辑无需配置 AI。启用云端 AI、邮箱与赞助流程时，将 [.env.example](.env.example) 复制为 `.env` 并填写配置，详见 [AI 接入](docs/operations/ai.md) 和 [账号与积分](docs/operations/accounts.md)。无密钥的 `auto` 模式会明确返回固定演示建议。

## 检查项目

```powershell
npm.cmd test
npm.cmd run test:backend
npm.cmd run test:integration
npx.cmd playwright install chromium
npm.cmd run test:browser
```

浏览器检查自动启动临时本地服务，使用隔离数据库、合成账号与仓库自带图片，无需提前运行 `npm start`。日志和截图输出到被忽略的 `test-results/`。完整命令、专项运行和人工画质评审见 [测试说明](docs/development/testing.md)。

## 仓库结构

```text
风景调色协作平台/
  frontend/             Vue 页面、Canvas 编辑模块、社区界面和产品素材
  backend/              Flask 接口、AI 适配、账号/配方模块、缩略图服务
docs/
  product/              产品需求、编辑功能与使用约定
  research/             用户研究计划、参考资料
  development/          架构、测试、素材来源与维护说明
  operations/           AI、账号积分和部署运维
scripts/                本地启动、依赖准备、测试和人工评审工具
tests/                  核心单元、后端、浏览器回归及隔离夹具
deploy/                 Linux 部署安装器、Nginx 和 systemd 模板
picture/                成员保留的摄影资料，不由应用自动加载
```

## 阅读项目

- [文档导航](docs/README.md)：全部现行文档。
- [产品需求与评审重点](docs/product/requirements.md)：目标用户、体验原则、功能边界及待验证问题。
- [编辑器说明](docs/product/editor.md)：工具、预览、历史、配方兼容和多图行为。
- [技术架构](docs/development/architecture.md)：源码入口与前后端协作。
- [用户研究计划](docs/research/plan.md)：访谈与任务观察方案。
- [部署说明](docs/operations/deployment.md)：测试站安装、更新和恢复。

产品图片、木纹、Vue 和预设来源的声明随资源保留，详见 [素材与许可](docs/development/assets.md)。仓库未提供覆盖全部项目代码的统一开源许可证。
