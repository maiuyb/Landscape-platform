# Demo 账号数据包

本目录是 Landscape 平台 `demo` 账号的数据快照，图片使用 Git LFS 存储。

## 内容

| 项目 | 数量 |
|---|---:|
| 用户 | 1（demo） |
| 作品记录 | 208 |
| 已发布作品 | 205 |
| 已删除作品记录 | 3（仍在可找回记录中） |
| 收藏 | 2 |
| 图片文件 | 409 |
| 图片体积 | 约 458.9 MB |

说明：

- 作品记录的 411 张引用图中，有 2 张历史图片在源数据里已经缺失（属于已删除作品 #12），因此实际可打包 409 张。
- 数据包只保留 `demo` 用户、其作品和收藏，不包含其他测试用户的账号数据。
- `manifest.json` 记录了数量、缺失文件和生成时间。

## 使用方式

先在本地备份当前的 `backend/recipes.db` 和 `backend/uploads/`，再复制：

```powershell
Copy-Item -LiteralPath "data\demo-account\recipes.db" -Destination "风景调色协作平台\backend\recipes.db"
Copy-Item -Path "data\demo-account\uploads\*" -Destination "风景调色协作平台\backend\uploads\" -Force
```

登录账号：`demo / demo1234`

## Git LFS

克隆或拉取前安装 Git LFS，并执行：

```powershell
git lfs install
git lfs pull
```

否则 `uploads/` 下的图片会是指针文件。
