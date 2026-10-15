# Landscape-platform
风景调色协作平台。需求以 [docs/PRD.md](docs/PRD.md) 为准，编辑细节见 [Luminar 编辑基线](docs/EDITOR-BASELINE.md)；接续背景见 [开发交接包](docs/DEVELOPMENT-HANDOFF.md)，本次进度见 [开发状态](docs/DEVELOPMENT-STATUS.md)。

## 本地运行（Windows / PowerShell）

需要 Node.js 和 Python 3。首次运行在项目根目录执行：

```powershell
npm.cmd ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r '风景调色协作平台/backend/requirements.txt'
$env:PORT = '5050'
npm.cmd start
```

打开 <http://127.0.0.1:5050>。前端与 API 由 Flask 同一服务提供，Vue 运行文件在安装依赖时生成到本地；编辑不依赖外部 CDN。停止服务用 Ctrl+C。未设置 `PORT` 时沿用原型的 5000 端口，若已占用可以指定其他端口。

一般手动编辑不会上传原图。当前作品在浏览器内存中保存，刷新/关闭页面后不恢复；请提前导出图片或下载配方。未配置 `DASHSCOPE_API_KEY` 时，AI 返回带明确提示的固定演示配方。云端模型仍沿用原型 `qwen-vl-plus`，真实 API 尚需单独验证。

当前已本地实现编辑基线 E1–E4：11 项光线/基础颜色控制、八色 HSL（24 项）、整体/R/G/B 曲线、预览直方图、自动曝光/白平衡和取样笔，以及锐化、半径、边缘保护、明度/颜色降噪。右侧按光线、颜色、曲线、细节、构图分组，HSL 在颜色内展开。裁剪支持拖边/角、框内移动、比例锁定与源图像素输入；拉直实时预览，可自动裁去空白或保留空白，辅助线可开关，应用一次可撤销。滤镜悬浮预览、移开恢复、点击应用，可立即切换。可见复位按钮和双击名称复位均保留。

新增清晰度、去朦胧、RGB 三原色各色相/饱和度、暗角与画笔/线性/径向蒙版；蒙版支持局部参数、擦除、羽化、反选、不透明度和随构图变换，详见编辑基线 6.4。用户要求菜单重组与前端整理留待共同讨论，本批只补功能。

曝光显示 EV，高光正值提亮。当前配方为版本 6，保存细节、拉直与统一白平衡控制，继续读取版本 1/2/3/4/5 并保留旧版明暗响应。自动调整是受约束的统计估计，可手调/撤销。点击“100% 细节查看”，再点照片选择位置，可以按原图像素查看局部并切换原图/编辑后；这与主画布的适配缩略预览不同。自动/取样白平衡会同步色温和色调滑条，之后可继续微调或分别复位。降噪先于最终锐化；高强度会损失纹理或产生光晕，建议在该窗口检查效果。

滑条预览已改为后台计算，拖动时降低工作栅格分辨率、松手恢复完整预览；画布显示尺寸和原图导出不受影响。此前的渲染函数计时不能代表真实操作性能，连续鼠标拖动检查见开发状态第 10 节。

## 检查与测试

```powershell
npm.cmd test
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_upload.py -v
npx.cmd playwright install chromium
# 先按上面的步骤启动本地服务（默认测试地址为 5050）
npm.cmd run test:browser
```

可用 `HMI_TEST_URL` 覆盖浏览器测试地址。浏览器测试使用自绘像素测试图；社区内容与部分 AI 成功/失败场景由测试夹具模拟，不向云端发送真实照片。测试报告、导出文件和截图保存在被忽略的 `test-results/`。

E1 另有真实照片与新控件验证（先启动本地服务）：

```powershell
npm.cmd run test:photos
npm.cmd run test:e1
npm.cmd run test:preview
npm.cmd run test:interaction
npm.cmd run test:e2
npm.cmd run review:e2
npm.cmd run test:e3
# 额外下载已有许可的夜景/雪景原尺寸文件（仅本地检查）
.\.venv\Scripts\python.exe scripts/fetch-detail-photos.py
npm.cmd run review:e3
npm.cmd run test:e4
npm.cmd run review:e4
```

照片的来源、作者、许可和缩略图下载地址记录在 `tests/photo-fixtures.json`；下载至 `test-results/e1/photos/`，不作为产品素材或上传云端。下载受来源站点限流时可稍后重试，或按所列地址手动下载到相同位置。效果对比见 `test-results/e1/review.html`，测量与验证见 `test-results/e1/report.json`。该测试检查中性像素、参数效果、旧配方往返、数值输入、分组复位、手机布局和原尺寸 PNG 输出；照片画质与性能结论限于已记录样本及本机环境。

E2 浏览器检查覆盖新裁剪/滤镜交互、取样笔、HSL/曲线历史、版本 3 兼容、当前版本配方往返和完整尺寸 PNG 逐像素一致性。`review:e2` 复用四张真实照片，生成 `test-results/e2/review.html`、参数及工作区截图。需要同时启用 E2 工具测拖动时，设置 `HMI_PERF_E2=1` 和 `HMI_PERF_PHASE=e2` 再运行 `test:interaction`；该人工降速检查不代表用户设备的完整显示延迟。

E3 检查覆盖降噪/锐化质量、透明边缘、分块接缝、100% 局部与完整导出像素一致、拉直裁边/留白、版本 4 往返、旧配方和手机。`review:e3` 生成 `test-results/e3/review.html` 的原图像素局部及参数；夜景为 4000×3000、雪景为 2000×1500，另外复用山景/日落 1280px 检查图。12MP PNG 下载已与完整处理结果比对。设置 `HMI_PERF_E2=1`、`HMI_PERF_E3=1` 和 `HMI_PERF_PHASE=e3` 再运行拖动检查，可测新旧工具及细节窗口组合。大图完整输出比工作预览更慢，实测及边界见开发状态第 13 节。

E4 检查覆盖三原色、清晰度/去朦胧、暗角、三种蒙版及擦除/历史/几何跟随、版本 6 往返、原图像素局部、PNG、Worker/兼容与 375px 界面。`review:e4` 生成 `test-results/e4/photos/review.html` 的四张照片六组对照及参数。继续设置 `HMI_PERF_E4=1`、其他 E2/E3 开关和 `HMI_PERF_PHASE=e4` 可测组合拖动；实测边界见开发状态第 15 节。

后端上传接口与前端一致，单张文件最大 20MB（20 × 1024 × 1024 字节），超限返回 JSON 格式的 HTTP 413；另设总上传请求上限并预留表单开销，拒绝超限请求时不保存到上传目录。课程原型仍使用原有开发服务器和认证。本次不包含个人服务器部署。
