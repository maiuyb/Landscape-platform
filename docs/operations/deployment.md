# 测试站部署与维护

本目录说明仓库提供的部署工具，不代表某次运行或公网状态已经验证。项目演示入口为 `https://47.101.37.232/landscape/`，独立社区位于 `/landscape/community/`。健康接口 `/landscape/api/health` 返回状态和版本号，可用于核对实际部署。

## 组成与首次安装

`deploy/` 包含安装器、更新器、HTTPS/专用代理工具及 systemd/Nginx 模板。后端由单 Gunicorn 进程、多线程运行，只监听 `127.0.0.1:5051`；Nginx 挂载 `/landscape/`，与现有根站隔离。

首次安装需要管理员在目标 Ubuntu 服务器上检查已有 Nginx 站点及公开 Origin，再运行安装器，例如从上传的仓库根目录执行：

```sh
sudo python3 deploy/install.py --origin http://47.101.37.232 --nginx-site /etc/nginx/sites-enabled/agent-workflow-smoke --configure-ai
```

`--nginx-site` 必须指向目标服务器的实际站点配置。安装器准备 Node/npm、Python venv 和专用 `landscape` 账号，校验后 reload Nginx。已有安装不需要为普通源码更新重新运行首次安装。

AI Key 只在服务器终端隐藏输入，配置写入 `/etc/landscape/landscape.env`，权限 `640 root:landscape`。数据目录权限为 `750`。本地 `.env`、照片、数据库和课件不随代码复制。修改配置使用 `sudoedit`，随后重启 `landscape.service`。

## 程序、数据和自动更新

| 位置 | 用途 |
| --- | --- |
| `/opt/landscape/releases/<sha>` | 各代码版本和依赖 |
| `/opt/landscape/current` | 当前程序原子切换入口 |
| `/var/lib/landscape` | 持久数据库、上传文件和更新前 SQLite 一致性备份 |
| `/etc/landscape/landscape.env` | 应用环境与密钥 |
| `/etc/landscape/update.env` | 更新器专用网络配置 |
| `/opt/landscape/update-status.json` | 原子写入的更新阶段及提交号 |

`landscape-update.timer` 每 60 秒检查公开仓库 main；获取目标提交、准备依赖、备份数据库后才切换和重启。相同版本不重启，构建失败保留原版，就绪失败恢复旧代码并再次检查。**代码回退不会回退数据库**，避免覆盖更新期间写入；破坏性 schema 修改需要另行设计数据迁移/恢复。

更新器保留最近程序版本和最近十份更新前数据库备份。读取远端版本最多等待 45 秒；Git 传输持续低速 45 秒判为停滞，有进度的下载可继续但单次最多十分钟；每轮最多两次。整体 systemd 超时 45 分钟，阶段日志/心跳不输出密钥或原始子进程内容。

日常 main 自动更新前后端源码。root 安装的更新器、systemd/Nginx 和 HTTPS 配置位于 checkout 之外，不会随普通源码发布自动替换。更新基础设施时由管理员检查后运行对应安装/升级工具。

## 检查与恢复

```sh
systemctl status landscape.service landscape-update.timer --no-pager
journalctl -u landscape-update.service -n 60 --no-pager
curl -fsS http://127.0.0.1:5051/api/health
cat /opt/landscape/update-status.json
```

手动检查更新使用 `sudo systemctl start landscape-update.service`；暂停自动更新使用 `sudo systemctl stop landscape-update.timer`，网站服务继续运行。Nginx 备份保存在 `/var/backups/landscape/`。数据库恢复需先暂停写入并核对备份，不应作为代码回退的附带动作。

只更新已安装的更新器：上传并核对 `deploy/` 后运行 `sudo python3 deploy/upgrade-updater.py`。工具备份/检查更新器与 unit，失败恢复旧文件和原定时器状态。

## HTTPS 与认证入口

`sudo python3 deploy/enable-auth-https.py` 用于现有站点的 IP HTTPS、证书续期和认证入口限流，需要管理员单独运行。工具校验证书信任链、IP SAN、健康接口、公网访问与已有 UFW 状态；只增加必要 IPv4 TCP 443 规则，失败撤回本轮新增规则并恢复原配置。云安全组 443 需要在对应平台开放。

HTTPS 验证后设置不带路径的 `PUBLIC_ORIGIN`，旧 HTTP 项目路径跳转，原有根站保留。IP 证书有效期短，续期 timer 每六小时检查；使用 `landscape-cert-renew.timer` 和实际证书核验续期，不能只看 timer active。状态文件为 `/opt/landscape/https-status.json`。

切换 Origin 后浏览器存储不共享，需要重新登录。切换前导出当前照片。认证路径在 Nginx 增加来源/全站限流，应用内部防护见[账号说明](accounts.md)。

## 社区图片加载与缓存

社区推荐、卡片、画廊、记录和详情缩略图使用可视区域优先的加载队列，最多同时激活 4 张，提前准备距屏幕 320px 的图片。普通卡片根据实际列宽选择 200/400/800/1200 像素版本；推荐区保留经过裁切清晰度验证的 1200 像素版本。缩略图失败最多尝试三次，不自动下载原图；详情点击放大才请求完整图片。

正式版本启动后，单个后台工作线程按推荐/最近作品顺序准备现有封面；新上传图片也进入有上限的准备队列。四种尺寸共用一次源图解码，已有缩略图不重新编码。后台与前台继续共用跨进程生成锁及缓存空间限制。`LANDSCAPE_WARM_THUMBNAILS=0` 可关闭后台准备，本地开发默认关闭。源图和无损交付成片不会被改写。

应用对成功的公开图片设置 `public, max-age=3600`，图片错误、页面、脚本、账号及业务接口使用 `no-store`。正式 Nginx 需要移除一般项目 location 对图片附加的 `no-store`，并为公开缩略图/上传图片单独启用 512MB、有时效的代理缓存，缓存命中不进入应用服务。不会缓存账号或作品 API，不忽略上游 `no-store`、Cookie 或其他缓存限制。

首次安装会复制图片缓存模板。已有安装在代码更新后，由管理员运行：

```sh
sudo python3 /opt/landscape/current/deploy/enable-image-cache.py --apply
```

省略 `--apply` 只列出待更新文件。工具保留 HTTP→HTTPS 跳转及认证限流，只更新项目的公开图片规则；配置备份位于 `/var/backups/landscape/image-cache-*`。重载后最多等待 10 秒，让旧工作进程完成平滑切换，并要求实际缓存命中。Nginx 检查、reload、公开健康接口或图片缓存命中验证失败时恢复原配置。不会新增 sudo 授权、修改数据库、读取或修改应用密钥。

线上缩略图响应应只有允许缓存的策略，并在重复访问时出现 `X-Landscape-Image-Cache: HIT`；API 仍应为 `no-store`。浏览器验证需分别使用新会话和同一会话重复访问，检查图片传输量、首屏就绪、失败重试和滚动时加载，不能仅凭图片可访问便认定缓存已生效。

## 可选 GitHub 专用代理

网络需要时，由管理员运行 `sudo python3 deploy/install-github-proxy.py`，隐藏输入 Clash/Mihomo 订阅。工具核对官方内核摘要、订阅节点及 GitHub 可达性后，配置回环 `127.0.0.1:17890`。已有同名代理服务时停止安装，避免覆盖。

更新环境仅使用 `LANDSCAPE_GITHUB_PROXY=http://127.0.0.1:17890`，只传递给 GitHub Git 子进程。网站、AI、pip/npm 和其他网络不使用该代理，不设置更新器全局 `HTTPS_PROXY/ALL_PROXY`。订阅和节点为服务器私有配置。

回退直连时从 `/etc/landscape/update.env` 移除专用变量、停止 `landscape-github-proxy.service` 并重新触发更新。工具和模板必须保留与单元测试一致的文件名，不能把部署脚本视为一次运行后即可删除的残留。
