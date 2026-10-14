# 产品与开源项目参考资料

整理日期：2026-10-09（中国标准时间）  
说明：本文件保留可访问入口、官方文档链接和针对本项目的摘要笔记。网页内容会变化；链接指向原始页面，不复制整页文字或图片。

2026-10-14 接续：当前图片编辑以 Luminar Neo 为主要参照，Fotor 补充网页操作与 AI 入口；前五节保留初期资料，最新依据与观察边界见第 6 节和 [EDITOR-BASELINE.md](EDITOR-BASELINE.md)。

## 1. 网页端轻量编辑器

### Fotor

- [在线编辑器](https://www.fotor.com/)
- [官方功能介绍](https://www.fotor.com/features/)
- [官方产品介绍](https://www.fotor.com/)
- 可确认的公开能力：浏览器内编辑，包含基础裁切、尺寸调整、颜色/亮度调整、滤镜和一键增强，另有 AI 编辑和设计能力。
- 对本项目的参考：优先观察单图编辑入口、从上传到快速增强的路径、常见调色如何呈现；团队认为它比 Canva 更接近当前产品想法，建议作为网页端直接对照样本。
- 限制：产品页面主要描述功能，不等于独立用户研究证据；免费和付费功能随地区/版本变化。

### Canva Photo Editor

- [在线编辑器](https://www.canva.com/photo-editor/)
- [帮助中心：编辑照片](https://www.canva.com/help/image-editor/)
- 可确认的公开能力：从主页上传/编辑照片，提供自动调整、亮度/暖度等滑杆、裁剪和下载/分享；编辑既可作为独立照片，也可进入设计流程。
- 对本项目的参考：上传后快速行动、明确的三步流程和导出；不作为专业调色信息架构的直接样板，因为产品整体更偏视觉设计和内容制作。

### Pixlr Editor

- [网页编辑器](https://pixlr.com/editor/)
- [Google Play 下载](https://play.google.com/store/apps/details?id=com.pixlr.express)
- [Apple App Store 下载](https://apps.apple.com/us/app/pixlr-ai-photo-video-editor/id526783584)
- 可确认的公开能力：网页端编辑、滤镜和多种图像工具；项目状态在浏览器缓存中临时保存，官方页面提示长期保存需下载 PXZ 项目文件。
- 对本项目的参考：临时保存与长期项目文件的区别、收藏效果、快速增强和交付方式。
- 限制：如团队已体验后觉得复杂，学习重点放在个别具体交互，不将它当作整体复杂度目标。

### Photopea

- [网页编辑器](https://www.photopea.com/)
- 可确认的公开能力：浏览器内打开/保存 PSD 和多种图像文件。
- 对本项目的参考：只观察画布、文件处理和对比/撤销等通用交互。团队体验反馈是复杂度偏高，应明确排除“复制其完整工具面板”这一方向。

## 2. 摄影编辑、预设和 AI 编辑

### Adobe Lightroom

- [Lightroom 移动端下载说明](https://helpx.adobe.com/lightroom/mobile/get-started/download-and-install-lightroom.html)
- [Apple App Store](https://apps.apple.com/app/adobe-photoshop-lightroom/id878783582)
- [Google Play](https://play.google.com/store/apps/details?id=com.adobe.lrmobile)
- [预设介绍](https://www.adobe.com/products/photoshop-lightroom/lightroom-presets.html)
- [Lightroom Discover 推荐预设与 Remix FAQ](https://helpx.adobe.com/lightroom/desktop/using/remix-recommended-presets-faq.html)
- [复制和粘贴编辑设置](https://helpx.adobe.com/lightroom/desktop/edit-photos/edit-photos.html)
- 可确认的公开能力：预设可继续编辑；Discover 提供作者分享的可复用设置，推荐预设会分析用户照片并寻找相似照片及其编辑；支持选择性复制某些编辑设置。
- 对本项目的参考：熟练控制项、逐步学习、样片与编辑参数绑定、预设迁移/复用、设置范围选择和跨照片一致性。
- 限制：Lightroom 面向完整摄影工作流，控件数量远超轻量首版；取其能力模型，不照搬所有面板。

### Snapseed

- [Google Play 下载](https://play.google.com/store/apps/details?id=com.niksoftware.snapseed)
- [Apple App Store 下载](https://apps.apple.com/us/app/snapseed/id439438619)
- [Google 官方工具与滤镜说明](https://support.google.com/snapseed/answer/6183571?hl=zh-Hans)
- 可确认的公开能力：30 多种工具/滤镜、自动或手动调整、选择性区域调整、RAW 支持、撤销/重做、批量处理和用户风格复用。
- 对本项目的参考：移动端快速编辑、直接操作、滤镜与参数工具间的关系、局部控制及可逆编辑。
- 限制：用户尚未体验；需求分析中先列作待调研，不对具体流程做结论。

### 像素蛋糕 PixCake

- [官方网站](https://www.pixcakes.com/)
- [工作区页面功能说明](https://wiki.pixcakeai.com/guide/9379.html)
- [AI 工具箱](https://wiki.pixcakeai.com/ai-toolbox)
- [iOS 产品页与下载](https://apps.apple.com/cn/app/%E5%83%8F%E7%B4%A0%E8%9B%8B%E7%B3%95-%E4%B8%93%E4%B8%9A%E7%BA%A7ai%E4%BF%AE%E5%9B%BE%E8%BD%AF%E4%BB%B6/id6743614900)
- 可确认的公开能力：商业摄影工作区；AI 追色/仿色、样片色彩复刻、批量同步、推荐预设、实时预览、手动微调，以及风景色调应用等。
- 对本项目的参考：AI 与样片的连接、自动处理后仍可人工控制、专业用户工作流和预设应用。
- 关键待核实点：目前查到的公开资料不能证明存在开放式、多轮自然语言聊天修图流程。由摄影用户演示其实际 AI 操作，区分“AI 追色/工具调用”与“聊天式协作”。

### Fotor 移动端

- [Apple App Store](https://apps.apple.com/us/app/fotor-ai-photo-editor-video/id440159265)
- 对本项目的参考：网页与移动产品的编辑入口是否一致、滤镜/调整/AI 能力如何组合。当前调研优先级低于网页编辑器。

## 3. 专业摄影软件及文档

### darktable

- [项目主页](https://www.darktable.org/)
- [功能列表](https://www.darktable.org/about/features/)
- [安装/下载](https://www.darktable.org/install/)
- [GitHub 源码](https://github.com/darktable-org/darktable)
- [官方用户手册与资源](https://www.darktable.org/resources/)
- 可确认的公开能力：开源摄影工作流与 RAW 开发；非破坏性编辑、图像数据库、标签/筛选、XMP sidecar、历史和导出。
- 对本项目的参考：源图保护、历史可恢复、参数可重建、导入/编辑/导出的工作流。
- 限制：专业功能很多，界面复杂，不作为新手界面目标。

### RawTherapee

- [项目主页和下载](https://rawtherapee.com/)
- [官方用户文档 RawPedia](https://rawpedia.rawtherapee.com/)
- [图像编辑器说明](https://rawpedia.rawtherapee.com/The_Image_Editor_Tab)
- [GitHub 源码](https://github.com/Beep6581/RawTherapee)
- 可确认的公开能力：GPLv3 跨平台 RAW 处理，支持预设/处理配置、参数调整、非破坏性 sidecar 和多工具布局。
- 对本项目的参考：熟练摄影用户的参数需求和预设/处理配置保存方式；需观察其术语和分组是否可被目标用户理解。

### GIMP

- [官方下载](https://www.gimp.org/downloads/)
- [用户手册](https://docs.gimp.org/)
- [GitLab 源码](https://gitlab.gnome.org/GNOME/gimp)
- 对本项目的参考：通用图像编辑的工具模型、图层、选择和历史概念；不作为风景调色轻量工具的首选竞品。

## 4. 浏览器开源图像编辑实现

### miniPaint

- [在线体验](https://viliusle.github.io/miniPaint/)
- [GitHub 源码与 README](https://github.com/viliusle/miniPaint)
- README 说明其使用浏览器 HTML5 技术，支持本地打开/拖放、撤销、裁切、颜色调整、多种滤镜和图层；项目宣称图像留在浏览器，不发送到服务器。
- 对本项目的参考：浏览器本地图像处理、文件导入导出、撤销、画布和多个可选工具的实现组织。
- 限制：它也有较宽的通用编辑功能，团队不应以其界面复杂度作为目标；先看源码和 README 是否有特定可复用设计，遵守 MIT 许可和第三方依赖许可。

## 5. 本项目当前资料

- 初稿：[风景调色协作平台_需求规格说明书.md](../风景调色协作平台_需求规格说明书.md)
- 原型目录：temp 分支的 风景调色协作平台/backend 和 frontend。
- 竞品初步体验反馈：项目成员体验 Pixlr、Photopea、Canva、Fotor 后认为前两者较复杂，Canva 更偏平面设计，Fotor 与本项目设想较接近；一位摄影爱好者提到 Lightroom 和像素蛋糕为常用工具。这些是团队产品方向的输入，不等于正式用户研究发现。
- 当前开发以 [PRD.md](PRD.md) 为主需求基线；[DECISION-INPUT.md](DECISION-INPUT.md) 记录两位成员共同确认的方向；[UX-RESEARCH.md](UX-RESEARCH.md) 记录后续如何验证用户任务与交互。

## 6. 当前编辑基线参考（2026-10-14）

### Luminar Neo：主要编辑参照

- 用户提供四张本机 1.22.1 截图，覆盖开发、颜色/HSL、细节附加控制、样板目录。用户补充 HSL 下拉包括色相、饱和度、亮度。截图是本机版本布局的直接依据。
- [Skylum Develop 工具说明](https://support.skylum.com/editing-tools/essential-tools/develop-raw-develop)：用于核对明暗方向、白色/黑色和控制类别，不照搬内部算法。
- [Skylum Color 工具说明](https://support.skylum.com/editing-tools/essential-tools/color)：用于核对颜色控制与 HSL 模式。
- [Skylum 样板浏览与应用](https://support.skylum.com/presets/browsing-and-applying-presets)：作为样板目录参考。本项目保留预览/应用/取消及当前构图，自行确定参数更新规则。
- 官方网页可能描述更新版本；以用户截图确定 1.22.1 观察范围，不把网页中的所有新工具纳入本项目。
- 已只读检查 `H:\Luminar Neo  1.22.1最新版本，支持win系统\App\Luminar Neo\Data\PresetPacks\Collections`：22 个内置集合配置，样板目录内可读取 `template.lmps` JSON 和缩略图，部分效果依赖 LUT、天空图或私有处理模块。轻快风景、阴天、日落、都市灯光有对应集合；目录可读不代表所有模板依赖齐全或可直接执行。
- 文件检查可用于理解组织和参数目标；团队用自己的工具调校样板并记录素材来源，不承诺复现 Luminar 引擎效果，也没有将其文件复制进产品。

### Fotor：展开控制与网页行为补充

- 实际观察入口：[基础编辑页面](https://www.fotor.com/photo-editor-app/editor/basic)。此前未登录、使用内置风景示例，展开检查了基础、色阶、颜色、结构、降噪、暗角、颗粒、裁剪、旋转、调整尺寸、HSL、曲线，共 12 个面板。
- 观察到基础亮度/对比度/饱和度、曝光/高光/阴影、色温/色调、明度/颜色降噪，以及 HSL 和曲线等小参数。裁剪包含比例、宽高、比例锁定、手柄与三分线；部分操作有应用/取消。
- 这些记录证明面板及控件可见，不证明所有效果已逐项验证。未完成全部 AI、会员导出限制或画质对比；后续 AI 调用参考仍需具体观察。
- 观察截图保留在被忽略的 `test-results/references/fotor-basic-2026-10-14.png`，不是产品素材或必须提交的资源。

### 当前主次

Luminar 决定主要编辑控制与信息组织，Fotor 补充网页流程；Lightroom 按需辅助效果实现，像素蛋糕仅作 AI 能力边界参考。以上为用户选择及竞品观察，不替代真实照片评估或新手任务测试。

### E1 真实照片测试资料

使用 Wikimedia Commons 文件页面核对作者和许可，再下载页面提供的 1280 像素缩略图。四张照片及下载/许可地址记录在 [tests/photo-fixtures.json](../tests/photo-fixtures.json)，分别为 Hannes Röst 的 Fronalpstock、Silvanica1 的 Devils Tower 日落、Marathon 的伦敦夜景和 Gayatri Priyadarshini 的 Gulmarg 雪景。测试只在本地处理；对比页注明修改、来源和图片许可，不作为应用内样板素材。检查结论及性能范围见 DEVELOPMENT-STATUS.md 第 9 节。

### E2 技术参考及照片检查

- [OpenCV GrayworldWB](https://docs.opencv.org/4.x/d7/d71/classcv_1_1xphoto_1_1GrayworldWB.html)：通道均值及按饱和度选像素的传统白平衡参考。本项目自行实现近中性优先、暗部/截断排除和受约束的增益；不使用厂商私有算法。
- [OpenCV SimpleWB](https://docs.opencv.org/4.x/d1/d8b/classcv_1_1xphoto_1_1SimpleWB.html)：比较独立通道分位数拉伸方法；本次没有选用，以免将通道拉伸误当作中性点取样。
- [SciPy PchipInterpolator](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html)：形状保持分段三次插值及斜率计算参考。本项目 JavaScript 曲线采用相应方法限制过冲。
- [OpenCV 直方图教程](https://docs.opencv.org/4.x/d1/db7/tutorial_py_histogram_begins.html)：256 档分布的技术参考；本项目亮度/RGB 图由当前预览像素计算，透明像素不统计。

E2 复用上述四张真实照片，分别检查 HSL、曲线、自动曝光、自动白平衡及组合设置；参数、来源、许可、变体与工作区截图在本地 `test-results/e2/`。全部在本地处理，不向 AI 服务上传，也不复制 Luminar 素材。菜单选择与新的基础滤镜流程依据用户反馈；不是重新观察竞品所得结论。
