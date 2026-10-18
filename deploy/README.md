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

## 验证范围

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'
npm test
node tests/editor-community-browser.cjs
node tests/deployment-browser.cjs
```

后一个浏览器检查使用临时数据库和合成/产品示例，验证 `/landscape/` 下的资源、示例渲染、HTTP 剪贴板降级、登录、前后图上传、配方发布和预览/取消、独立社区页面，禁止请求漏到原网站根 API。更新器测试覆盖构建失败、相同版本不重启、就绪失败回退和保留更新期间数据库写入。

实际云端验收还需检查站点、进程/权限、旧页面、回环端口、定时器，以及后续 main 提交能否被自动识别；本说明本身不表示已完成云端安装。
