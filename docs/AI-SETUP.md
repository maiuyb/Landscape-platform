# AI 助手接入与运行

更新：2026-10-15。接口适配与本地模拟验证已完成；用户填 Key 后已用公开山景完成一次真实 Flash 请求，约 5.53 秒，返回可执行方案，预览/应用/撤销通过。跨照片质量、连续对话、延迟分布与账单仍待实测。不要仅凭“云端 AI 已配置”判断模型可用；真实结果见开发状态第 23 节。

## 本机配置

项目根目录的 `.env` 是本机配置文件，已列入 Git 忽略；`.env.example` 是可以提交的空白模板。本次开发已在不存在 `.env` 时创建空白配置，不覆盖已有文件。

1. 打开根目录 `.env`，只需将 `DASHSCOPE_API_KEY=` 后面填入自己的完整 Key。不需要把密钥发给开发助手，也不应填写到网页代码或提交 GitHub。
2. 其余默认值可保留：

   ```dotenv
   AI_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
   AI_MODEL=qwen3.8-flash
   AI_MODE=auto
   ```

3. 已更新的依赖包含 `python-dotenv` 与 Pillow。换一台机器时，重新安装后端 `requirements.txt`。
4. 重启后端服务，网页刷新后打开 AI 助手。状态应显示“云端 AI 已配置”。状态检查只读取服务配置，不调用收费模型。
5. 用一张可发送给云端的照片，描述“保留原来的颜色，稍微压暗高光”，点击获取建议。先预览、再应用，检查编辑页对应滑条和撤销结果。

`.env` 只从本项目根目录加载，不向上查找；系统/进程环境变量优先于文件。更改 Key、模型或模式后都要重启后端。`PORT` 仍由启动进程环境设置，默认本地演示使用 5050。

模式：服务器真实展示建议设置 `AI_MODE=live`，避免缺密钥被当作已接入。`auto` 无密钥时返回明确的固定演示，填入密钥后调用云端；`demo` 始终演示；`live` 缺密钥直接报配置错误。已配置云端但发生鉴权、网络、超时或解析错误时，不自动切换演示，也不自动重试收费请求。

## 处理分工与数据

- 原尺寸图片、调色、预设、曲线、锐化、降噪、蒙版和导出在访问者浏览器运行；服务器不需要为这些处理配置 GPU。原尺寸导出仍受访问设备性能和 Canvas 内存限制。
- 用户主动获取 AI 建议时，浏览器发送当前编辑效果的 **最长边 512px JPEG**、描述、主要编辑数值，以及本张图片最近三轮成功 AI 交流。蒙版仅发送数量，构图仅发送操作数量，不发送笔迹、原尺寸文件或项目历史。
- 后端校验参考图与参数，使用服务器保存的 Key 请求千问。参考图与交流不在本项目后端落盘；普通 HTTP 访问日志只记录路径/状态，不添加请求体、密钥或模型完整返回日志。千问平台的数据处理以其政策为准。
- 更换照片清空 AI 交流上下文；失败、演示和过期结果不进入云端交流上下文。页面内交流展示与编辑历史独立，撤销只撤销照片调整。
- 图片上传/社区接口是另一条流程，不要将“普通编辑不上传原图”扩展为所有社区功能都不会上传图片。

## 建议范围与执行语义

模型输出 `message` 与 1–3 个 `proposals`。每个方案可选目录内一个预设及 0–100 强度，再给最多 24 个明确参数。参数为最终绝对值，前后端均拒绝越界、非数值、未知键、未知预设和不支持的操作。

首轮支持基础光线/颜色、八色 HSL、细节、清晰度/去朦胧/暗角强度、RGB 原色校准。不开放模型任意 steps、脚本、几何、蒙版、白平衡增益或直接编辑曲线；参考图不足以可靠判断源图细微噪点，提示词要求模型说明边界。

选择预设沿用原预设语义：替换其管理的风格字段，保留曝光、亮度、白平衡、构图、蒙版与暗角形状；显式参数随后覆盖。不选预设的微调只改变列出的参数。浏览器编译为版本 6 的差异配方，缩略图、画布预览、正式应用和导出共用现有处理管线。AI 应用后结束旧预设强度会话，实际参数仍可手动调整、撤销和下载。

请求期间允许继续编辑或换图，结果回来时核对源图版本与参数快照；已过期则丢弃。新请求清空旧卡片，失败不留下可以误用的旧建议。

## 费用与限制

默认关闭思考模式，最大输出 2200 tokens，一次点击至多一次上游请求。保留模型返回的输入/输出/总 token 数，但不将其冒充账单实收金额；真实价格及图片计费规则以平台为准。

默认每进程最多 2 个并发、每分钟最多 10 次请求；可通过 `AI_MAX_CONCURRENT` / `AI_REQUESTS_PER_MINUTE` 修改。请求正文最多 768KiB、JPEG 最多 384KiB 且尺寸不超过 1024px；当前浏览器实际发送 512px。模型连接超时 5 秒、读取超时默认 45 秒，浏览器总等待上限 65 秒。进程限流不是账号认证，多进程会分别计数。

Flash 用于图片理解与参数建议；本批不调用 `qwen-image-3.0`，也不提供生成式换天、消除或图片生成。

## 上海服务器部署准备

本批未登录或修改租赁服务器。部署仍需域名/证书、访问范围和运行环境信息。

Linux 展示环境可采用 Nginx + 单 Gunicorn 进程、多线程：在服务器虚拟环境安装后端依赖与 `gunicorn`，从后端目录运行：

```sh
gunicorn --workers 1 --threads 4 --timeout 75 --bind 127.0.0.1:5050 app:app
```

用进程管理器维持服务。不要在公网启用 Flask debugger；当前本地入口也已关闭 debug。Nginx 将页面和 `/api/` 反代到同一服务，保留真实 Host；普通上传上限至少 21MiB，AI 路径可单独限制 768KiB，代理等待建议 70 秒。不要把项目根目录当作公开静态目录。

HTTPS 反代时，在后端配置 `PUBLIC_ORIGIN=https://实际域名`，使 AI 请求来源检查与浏览器一致；本机不必设置。不根据用户提供的 Host 或请求体选择模型接口地址。网页服务器在上海不等于模型推理一定发生在上海，本接口当前文档未要求首次调用选择地域。

付费 AI 面向公开访问前，应在反向代理或应用增加真实访问控制、共享限流/预算限制；课程展示可先使用受控访问。现有社区账号系统不作为付费 AI 的授权保证。后续部署时落实，不能将本轮适配描述为已完成公网生产部署。

## 已核对的接入依据

- [千问首次 API 调用](https://platform.qianwenai.com/docs/developer-guides/getting-started/first-api-call)：Key、OpenAI 兼容 Base URL。
- [Flash 模型](https://www.qianwenai.com/models/qwen3.8-flash)：图像输入、文本输出、结构化输出和当前价格。
- [视觉输入格式](https://platform.qianwenai.com/docs/developer-guides/multimodal/vision)：Base64 JPEG 与 `image_url` 消息结构。
- [API Key 管理](https://platform.qianwenai.com/docs/developer-guides/administration/api-keys)：只在服务端使用密钥。
- [Image 3.0](https://www.qianwenai.com/models/qwen-image-3.0)：图像输出能力及独立计费，暂未接入。

## 验证

```powershell
npm.cmd test
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
# 启动本地服务后；云端响应使用测试夹具，不调用收费模型
npm.cmd run test:ai
npm.cmd run test:workspace
```

`test:ai` 的 9 组云端成功、失败、连续对话等场景使用浏览器请求夹具；后端隔离测试单独核对完整请求/响应协议。在实际服务明确为演示模式时，浏览器另检查一次真实 Flask 演示请求。它们证明程序链路与错误处理，不能证明真实模型的可用性、建议质量、速度或费用。


## 可选 Gemini 的核查（尚未接入）

2026-10-15 用户询问 Google AI Pro 是否包含免费 API，以及上海服务器能否使用。当前 Google 官方说明：Pro 的开发者权益包含每月 $10 Google Cloud credit，须激活并关联相应账单账户；可用于 Gemini API/Vertex AI，但不是订阅期间所有 API 无限免费。独立 API Free Tier 仍受模型和项目配额约束。账户具体资格、已领取余额和计费绑定尚未核实，未使用用户 Google Key 或更改其账单设置。

- [Google 官方权益公告](https://blog.google/innovation-and-ai/technology/developers-tools/gdp-premium-ai-pro-ultra/)
- [权益与赠金领取 FAQ](https://developers.google.com/profile/help/benefits)
- [Gemini API 计费](https://ai.google.dev/gemini-api/docs/billing)
- [支持地区](https://ai.google.dev/gemini-api/docs/available-regions)

支持地区列表不包含中国大陆，因此上海服务器直连 Gemini Developer API 不是当前官方支持的可依赖部署路径。未做该服务器网络实测，也不把本机可用、网页能读图或账户持有 Key 视为服务器可用的证据。若后续对照模型，应先核实账户/API 产品、赠金适用范围和服务地区，再决定接入；当前继续使用已验证的 Qwen。
