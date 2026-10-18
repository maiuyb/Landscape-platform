# 2026-10-18 公网测试部署

## 站点与边界

- 测试站：<http://47.101.37.232/landscape/>；独立社区：<http://47.101.37.232/landscape/community/>。
- 当前先用公网 IP 和 HTTP，域名/HTTPS 后续接入。`localhost` 仍用于本机开发，不再是给测试者的访问地址。
- 服务器原有 Lumi 根页面保持不变，已比较 HTTP 内容的 SHA-256；不覆盖原网站、SSH、安全组或其他服务。
- 后端仅监听 `127.0.0.1:5051`，由现有 Nginx 的 80 端口代理。运行用户为专用 `landscape`，应用资源占用在首次检查时约 40 MB，未出现自动重启。

## 程序与数据

- 部署实现 [PR #11](https://github.com/maiuyb/Landscape-platform/pull/11) 已合入，首次运行提交为 `887aa391821de1a134092b8ab2b9e5047920b9d9`。
- `/opt/landscape/releases/<sha>` 保存程序，`current` 原子切换；`/var/lib/landscape` 保存社区数据库、上传文件和私有备份，权限 `750 landscape:landscape`。
- 真实环境配置只在服务器 `/etc/landscape/landscape.env`，权限 `640 root:landscape`。用户在服务器终端自行输入 AI Key，未复制或打印本机 `.env`、密钥、数据库、用户照片、测试资料、课件。
- AI 状态接口确认 `configured=true / mode=live / model=qwen3.8-flash`。本轮只检查配置状态，没有发起收费模型请求；这不等于已验证云端真实建议质量和可用性。
- 新生成的本机专用 SSH 私钥位于用户 `.ssh`，没有进入仓库或上传服务器；服务器只添加对应公钥，原密钥保留。

## 自动更新

`landscape.service` 与 `landscape-update.timer` 已启用开机启动，timer 已运行，每 60 秒检查公开 GitHub main。构建完成、SQLite 备份成功后切换程序；激活失败回退程序，不自动覆盖数据库。相同版本不重启。网络和构建耗时另计，不能把“一分钟检查一次”写成“一分钟内一定上线”。

首次部署因 PyPI 下载较慢，Pillow 6.9 MB 依赖出现数分钟无前台输出；实际仍在下载。安装器随后补充实时日志显示，避免只显示 preparing。服务器暂存安装器更新后可供以后安装使用，基础设施的 root 文件仍按管理员安装机制维护，日常应用代码自动更新。

当前已确认首次部署后立即发生的第二次检查正常结束且应用未重启。后续 main 提交还将用于验证自动发现新版本、切换和就绪状态，最终结果以该次交付记录为准；不能仅凭 timer active 宣称新提交更新验收通过。

## 已执行检查

- 本地核心 62 项，后端/更新失败模式 24 项通过。
- 既有社区浏览器 7 组通过，子路径完整登录/两图上传/完整配方发布/预览取消/独立社区检查通过，数据全部隔离在本机临时目录。
- 实际公网 HTTP 浏览器检查通过：欢迎页与真实对比、产品示例修图、剪贴板兼容复制、普通 PNG 导出、木纹相框预览及独立导出（尺寸及内部照片像素检查）、社区读取、390px 编辑器和社区宽度。
- 公网检查无页面 JS 错误、失败资源或越过 `/landscape/` 的应用请求；没有注册测试账号、发布测试作品、向服务器上传测试照片或调用 AI。
- 后端监听范围、应用/更新状态、配置与数据权限、旧网站内容均已核对。就绪接口为 `/landscape/api/health`，只返回状态与提交号。

## 社区后续

已看到新分支 `codex/community-issue-4-pairing/28a61a7` 和成员在 [#4](https://github.com/maiuyb/Landscape-platform/issues/4) 的回复。该分支尚未独立验收，未混入本次云端部署，也未提前关闭 issue。当前部署沿用已验收的同源组合流程。后续验证需包含 HTTP 与 `/landscape/` 前缀环境，再决定合入。

服务器命令、更新恢复机制和配置说明见 [deploy/README.md](../deploy/README.md)。
