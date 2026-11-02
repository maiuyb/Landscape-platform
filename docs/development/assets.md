# 素材、第三方代码与许可

## 产品随附资源

| 资源 | 用途与来源声明 |
| --- | --- |
| 欢迎页摄影与前后效果图 | 位于 `frontend/assets/welcome/`，作者、原图链接、许可和派生说明见 [CREDITS](../../风景调色协作平台/frontend/assets/welcome/CREDITS.md) |
| 相框木纹 | 位于 `frontend/assets/frames/`，Poly Haven CC0 来源见 [CREDITS](../../风景调色协作平台/frontend/assets/frames/CREDITS.md) |
| 18 款预设 | 来源与改编记录见 [preset-sources.json](../../风景调色协作平台/frontend/preset-sources.json)，保留 [MIT 声明](../../风景调色协作平台/frontend/licenses/peva3-presets-MIT.txt)；按本项目引擎重新调校，不承诺原引擎效果 |
| Vue 运行文件 | `npm ci` 时复制到忽略目录 `frontend/vendor/`，同时保留 Vue 的 LICENSE；无需提交生成文件 |
| 赞助图片与站点标识 | 位于 `frontend/assets/alipay-sponsor.jpg` 与 `frontend/logo.svg`，属于现有产品资源 |

产品本地处理不依赖外部图片 CDN。测试使用仓库自带摄影样例或合成图片，保留其原许可声明。

## 人工效果评审

[photo-fixtures.json](../../tests/photo-fixtures.json) 记录另外的山景、夕阳、夜景和雪景照片的作者、来源、许可及下载地址。通过 `npm run review:photos` 下载到忽略目录 `test-results/e1/photos/`；高分辨率细节副本由 `scripts/fetch-detail-photos.py` 获取。它们用于检查实际画质与性能，不作为自动化功能测试的前置条件。

## 成员摄影资料

`picture/` 保留成员提供的十张原尺寸摄影资料，应用不会自动载入，也不会自动导入数据库。原 `picture/测试图/` 的两张照片与上级文件逐字节相同，整理时删除重复副本。成员来源提交为 `714dc7d`。

这些照片的文件名包含摄影作者及 Unsplash 标识，但目录尚无逐图许可/来源清单；不能把文件名当作已经完成授权核对的证据。需要用作公开产品素材时，应先补齐出处。当前产品的欢迎页与相框使用前述有独立声明的资源。

项目根的 `素材/`、`素材.zip`、`课件/` 及未跟踪采集脚本属于本地资料，整理时保留在原处，未纳入提交。用户数据库、上传照片与真实配置不属于可清理的源码残留。
