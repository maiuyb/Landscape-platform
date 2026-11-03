# 社区风光配方素材导入

`scripts/prepare-community-library.cjs` 与 `scripts/seed_community_recipes.py` 用于把本地 200 组素材转为可复现、可追溯的社区作品。图片与交付包不进入 Git；源码发布与数据库导入是两个独立步骤。

## 准备交付包

输入为根目录 `素材/` 中的 `manifest.json`、`manifest_with_recipes.json`、`photos/` 和 `before/`。先完成开发依赖安装，再运行：

```powershell
node scripts/prepare-community-library.cjs
```

默认输出在忽略目录 `test-results/community-import/library/`，也可通过第一个参数指定输出目录。工具保留原素材，从已经保存的 before JPEG 解码，调用实际浏览器编辑引擎执行完整配方，将结果保存为无损 WebP，再逐张比较解码像素与重新渲染结果。全部 200 张通过后才写出带校验摘要的 `manifest.json`。`rendered/` 是中间 PNG，交付只需要 `manifest.json`、`before/` 和 `after/`。

原素材中的 after JPEG 经过有损编码，不能据此承诺像素一致。新交付包的验证范围是当前 Chromium 与当前编辑引擎、所附 before 图、完整配方及全尺寸渲染；不代表其他版本或其他照片会呈现相同效果。before 基底经过明暗与饱和度整理，并非相机 RAW；此说明与摄影作者、原作链接、许可一并保存到作品详情。

## 预检与执行

必须显式指定已存在的数据库和上传目录，避免误用开发数据库。以下为正式部署布局，先预检：

```sh
sudo -u landscape /opt/landscape/current/.venv/bin/python /opt/landscape/current/scripts/seed_community_recipes.py \
  --assets /path/to/library \
  --database /var/lib/landscape/recipes.db \
  --uploads /var/lib/landscape/uploads --owner demo
```

预检不写入数据库或上传目录。检查 `update`、`insert`、`unchanged`、`deleted-skip` 数量，确认目标后，追加 `--apply --warm-thumbnails` 执行，可用 `--report /var/lib/landscape/community-library-import.json` 留存结果。

工具依据素材原文件 SHA-256 匹配目标账号已有作品，再使用持久映射识别后续导入。原位更新保留作品 ID、账号、收藏、计数和时间；不会创建账号、伪造收藏或恢复已删除作品。找不到已有作品时默认失败，只有新建素材库明确需要时才用 `--allow-new`。`--limit 60` 可限制处理数量，范围为 1–200。

执行前会在数据库同级的 `backups/` 创建 SQLite 一致性备份。工具校验图片摘要、尺寸、配方和来源链接，以带内容摘要的文件名复制图片，并可提前生成 800/1200 像素缩略图；随后用单个事务更新记录。准备期间作品被修改会终止导入，防止覆盖并发编辑；重复导入相同内容跳过写入。失败时回滚记录并清理本次新复制的图片，已有上传文件不删除。缩略图缓存可按既有缓存维护规则处理。

数据库备份不能自动替代正式恢复决策。需要恢复时先暂停写入，核对备份和导入之后的用户变更，再按部署文档处理。

## 展示与复用

作品列表使用成片及现有缩略图机制，详情沿用调色前后对比。详情接口提供完整 `steps`、`rendering`、参数摘要和来源说明；原作与许可链接仅接受 HTTP/HTTPS。

“在我的照片上预览”沿用现有配方复用流程。含局部蒙版的配方默认仍由用户选择是否同时复用作者局部选区；使用相同 before 图并勾选局部选区，才对应完整配方的复现条件。在其他照片上复用时应重新检查局部选区位置和构图。

回归测试 `tests/test_community_import.py` 使用合成图片和临时数据库，覆盖预检、匹配更新、收藏保留、重复导入、非法素材拒绝和失败回滚，不依赖私人素材或线上数据库。
