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

当前已完成编辑基线 E1 与 E2：11 项光线/基础颜色控制、八色 HSL（24 项）、整体/R/G/B 曲线及预览直方图；新增自动曝光、自动白平衡和白/灰点取样笔。一级菜单为光线、颜色、曲线、构图，HSL 在颜色内展开。裁剪支持拖边/角、框内移动、比例锁定与源图像素输入；滤镜悬浮预览、移开恢复、点击直接应用，可立即切换或撤销。保留可见复位按钮，参数名称也支持双击复位。

曝光显示 EV，高光正值提亮。新导出配方为版本 3，保存白平衡、HSL、曲线；仍读取版本 1/2 并保留旧版明暗响应。自动调整是受约束的统计估计，可手调/撤销，不保证每张风景照片得到最佳审美效果。锐化、降噪和拉直将在 E3 接续。

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
```

照片的来源、作者、许可和缩略图下载地址记录在 `tests/photo-fixtures.json`；下载至 `test-results/e1/photos/`，不作为产品素材或上传云端。下载受来源站点限流时可稍后重试，或按所列地址手动下载到相同位置。效果对比见 `test-results/e1/review.html`，测量与验证见 `test-results/e1/report.json`。该测试检查中性像素、参数效果、旧配方往返、数值输入、分组复位、手机布局和原尺寸 PNG 输出；照片画质与性能结论限于已记录样本及本机环境。

E2 浏览器检查覆盖新裁剪/滤镜交互、取样笔、HSL/曲线历史、版本 3 配方往返和完整尺寸 PNG 逐像素一致性。`review:e2` 复用四张真实照片，生成 `test-results/e2/review.html`、参数及工作区截图。需要同时启用 E2 工具测拖动时，设置 `HMI_PERF_E2=1` 和 `HMI_PERF_PHASE=e2` 再运行 `test:interaction`；该人工降速检查不代表用户设备的完整显示延迟。

后端上传接口与前端一致，单张文件最大 20MB（20 × 1024 × 1024 字节），超限返回 JSON 格式的 HTTP 413；另设总上传请求上限并预留表单开销，拒绝超限请求时不保存到上传目录。课程原型仍使用原有开发服务器和认证。本次不包含个人服务器部署。
