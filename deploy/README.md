# Ubuntu 测试部署

首次部署目标为上海 ECS 的 `http://47.101.37.232/landscape/`，保留原有 Lumi 检查页。域名和 HTTPS 后续接入。本目录只有源码、模板和安装程序，不包含真实环境文件、密钥或数据。

## 首次安装

先在本机验证并把本分支合入 GitHub main，再把本目录的文件上传到服务器的独立暂存目录。在服务器已登录的终端运行（需要现有管理员密码）：

```sh
sudo python3 /home/ezio/hmi-deployment/install.py --origin http://47.101.37.232 --nginx-site /etc/nginx/sites-enabled/agent-workflow-smoke --configure-ai
```

安装器会安装 Python venv / Node / npm，创建专用 `landscape` 服务账户，为现有 Nginx server 增加 `/landscape/` 路由，校验配置后 reload。原网站根目录、SSH、其他服务和安全组不修改；后端只监听回环地址 `127.0.0.1:5051`，不需要对外开放新端口。

如果选择配置 AI，安装器只在服务器终端隐藏询问 API Key，写入服务器的 `/etc/landscape/landscape.env`，不打印输入内容。回车跳过也能使用普通修图和社区，但 AI 面板会明确显示缺少配置。不会复制本机真实 `.env`、照片、数据库或课件，也不会调用收费 AI 来做安装验收。

真实环境文件由 root 管理，权限 `640 root:landscape`；数据目录 `750`。后续可在服务器执行 `sudoedit /etc/landscape/landscape.env` 配置，再 `sudo systemctl restart landscape.service`。不要把环境文件内容或密钥粘贴到聊天、issue、GitHub。

## 自动更新与恢复

- `landscape-update.timer` 启动后每 60 秒检查公开仓库 `main`；不部署开发分支。网络、构建耗时另计，不能承诺推送即刻完成。
- 更新服务以普通 `landscape` 账户获取 Git，依赖准备完成后才原子切换 `/opt/landscape/current`；相同提交不会重启。
- `/opt/landscape/releases/<sha>` 保存程序，`/var/lib/landscape` 保存数据库、上传文件和最近 10 份更新前 SQLite 一致性备份。保留最近程序版本，备份不会放进网站可访问目录。
- 构建失败继续运行原版。新版本就绪检查失败则切回旧程序并检查，**不自动回退数据库**，避免覆盖更新期间写入的数据。未来破坏性 schema 迁移仍需单独安排，不能只依赖代码回退。
- 就绪检查为 `/landscape/api/health`，只返回状态和提交号，不返回环境配置。正常更新会有一次进程重启，正在进行的请求可能需要重试。
- root 安装的更新器和 systemd/Nginx 配置位于 checkout 之外。日常前后端源码随 main 自动更新；修改部署基础设施文件时需管理员重新运行安装器，不能默认这些系统文件也自动替换。
- 更新器只具有 `sudo systemctl restart landscape.service` 的免密权限；不能管理其他服务。

服务器检查命令：

```sh
systemctl status landscape.service landscape-update.timer --no-pager
journalctl -u landscape-update.service -n 60 --no-pager
curl -fsS http://127.0.0.1:5051/api/health
```

管理员手动触发一次检查用 `sudo systemctl start landscape-update.service`。暂停更新可用 `sudo systemctl stop landscape-update.timer`；测试站本身保持运行。Nginx 原配置备份位于 `/var/backups/landscape/`。

## 更新进度、网络恢复与专用代理

2026-10-18 补充：新版更新器先读取 main 的远端提交，再下载 Git 对象。连接/读取远端版本最多等待 45 秒；下载开启 `--progress`，由 Git/libcurl 在持续低于 1 字节/秒达 45 秒时判定传输停滞。有进度的慢下载允许继续，单次下载仍保留 10 分钟上限。每轮最多尝试两次，间隔 5 秒；失败后由每分钟定时器继续检查。整轮服务上限 45 分钟，包含依赖准备和就绪检查，超时会清理 Git 子进程。

阶段包括连接、Git 对象下载、解包、Python 环境和依赖、Node 依赖、前端准备、数据库备份、切换、重启、健康检查或回退。每 10 秒输出一次心跳；Git 提供进度时显示对象数量、百分比、接收字节和距离上次进度变化的时间。依赖进程没有可解析下载数值时明确显示等待及输出活动计数，不把输出字节数当下载量，不凭安静日志终止正常工作。

```sh
cat /opt/landscape/update-status.json
sudo journalctl -u landscape-update.service -n 40 --no-pager
```

状态文件采用原子写入，内容仅含已知阶段、提交号、计数和错误类别；可供本机普通账号读取，未通过网站提供。日志不打印原始子进程输出、命令环境、代理 URL 或凭据。Git 的百分比属于当前处理阶段，不是整轮部署百分比。同版本仅读取远端版本，不下载对象、不构建或重启。

已安装的服务器使用专用升级器，避免重新安装依赖或修改 Nginx/应用配置。在上传本目录新版源码后，由管理员运行：

```sh
sudo python3 /home/ezio/hmi-updater-upgrade/deploy/upgrade-updater.py
```

升级器先检查 Python 语法与 systemd unit，备份旧更新器和 unit，仅暂停更新任务进行替换，网站保持运行；安装失败会恢复原文件及原定时器运行状态。安装成功会启动一次新版更新检查。首次安装器同时采用新版 unit 的 45 分钟等待上限。

代理判断：同日服务器并行测试，默认 Git 的 3 次读取中 1 次成功、2 次在 15 秒诊断期限内未完成；强制 HTTP/1.1 的 3 次也未完成。此前还看到连接重传、接收字节停滞和新的连接超时。这些是有限样本，不能当作长期可用率，亦不能确定具体线路或设备原因；但足以说明当前直连不适合依赖固定短时间自动上线。建议为更新服务准备可信专用代理以提高稳定性；网站本身无需全局代理。不使用未知公共代理、不关闭 TLS 验证、不固定第三方 GitHub IP。

已预留 `/etc/landscape/update.env`，仅由更新服务加载，独立于应用密钥。当前没有配置代理。若有可信代理，管理员可在服务器用 `sudoedit /etc/landscape/update.env` 填写：

```ini
HTTPS_PROXY=http://YOUR_TRUSTED_PROXY_HOST:PORT
HTTP_PROXY=http://YOUR_TRUSTED_PROXY_HOST:PORT
NO_PROXY=127.0.0.1,localhost
```

以上是模板，需替换地址后使用；服务器的 `127.0.0.1` 指服务器自己，不是用户电脑。含账号密码的代理地址只在服务器终端输入，不粘贴到聊天、issue 或仓库。配置文件由 root 持有并设为 `600`，随后重启更新任务。代理配置不会传给应用服务或影响 SSH/Nginx。没有可信可用地址时，保持直连和限次重试，不能宣称已解决链路不稳定。

## 验证范围

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'
npm test
node tests/editor-community-browser.cjs
node tests/deployment-browser.cjs
```

后一个浏览器检查使用临时数据库和合成/产品示例，验证 `/landscape/` 下的资源、示例渲染、HTTP 剪贴板降级、登录、前后图上传、配方发布和预览/取消、独立社区页面，禁止请求漏到原网站根 API。更新器测试覆盖构建失败、相同版本不重启、就绪失败回退和保留更新期间数据库写入。

实际云端验收还需检查站点、进程/权限、旧页面、回环端口、定时器，以及后续 main 提交能否被自动识别；本说明本身不表示已完成云端安装。
