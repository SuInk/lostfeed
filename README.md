# 刷过的 · LostFeed

小火箭（Shadowrocket）模块：自动记录你在**小红书**和**推特网页版**里刷到的内容。刷新以后找不到刚才那条？打开「刷过的」就能找回。

<img src="icon.png" width="72">

## 安装（只需要做一次）

**第 1 步：添加模块**

复制这个链接：

```
https://raw.githubusercontent.com/SuInk/lostfeed/main/lostfeed.sgmodule
```

打开小火箭 → 底部「配置」→「模块」→ 右上角 **+** → 粘贴链接 → 下载。

**第 2 步：打开 HTTPS 解密**（已经开过的跳过）

小火箭 →「配置」→ 当前配置右边的 ⓘ →「HTTPS 解密」→ 打开 → 按提示安装证书，
然后去 iPhone「设置 → 通用 → 关于本机 → 证书信任设置」把小火箭的证书打开。

**第 3 步：放到桌面**

用 Safari 打开 **https://suink.github.io/lostfeed/** → 点底部 **分享按钮** →「添加到主屏幕」。

桌面上会出现一个红色的「刷过的」图标，以后点它就能看历史了。

## 日常使用

1. 小火箭保持开启，正常刷小红书；推特请用 **Safari 打开 x.com** 刷（见下方说明）
2. 想找刚才那条 → 点桌面上的「刷过的」
3. 点任意一条会跳回原帖

页面支持按平台切换、搜索作者和内容；从别的 App 切回来会自动刷新。

## 其他查看方式（可选）

**快捷指令**：快捷指令 App → 新建 → 添加操作「打开 URL」→ 填 `https://suink.github.io/lostfeed/` → 命名「刷过的」。

**轻点背面**：设置 → 辅助功能 → 触控 → 轻点背面 → 轻点两下 → 选上面那个快捷指令。之后在推特 / 小红书里敲两下手机背面就能直接打开。

## 遇到问题

| 情况 | 怎么办 |
| --- | --- |
| 打开后显示「没连上小火箭」 | 按页面上的清单检查：小火箭已开启、模块已勾选并更新、HTTPS 解密和证书信任已打开 |
| 没有记录 | 打开 https://suink.github.io/lostfeed/debug（页面底部「诊断」），看有没有拦截到请求；没有的话检查 HTTPS 解密和证书信任 |
| 小红书刷了要重开 App 才记录 | 模块已自带拒绝小红书 QUIC 的规则，第一次装好后把小红书彻底划掉重开一次 |
| 想少存或多存一些 | 模块里 `argument=max=800` 改数字（每个平台分别计数） |

## 记录范围

| 平台 | 接口 |
| --- | --- |
| 小红书 App | 首页推荐、关注、搜索、笔记详情 |
| 推特网页版 | 首页（为你推荐 / 正在关注）、推文详情、用户主页、媒体、搜索、书签、列表 |

**为什么不支持 X App？** 实测 X App 的接口域名 `api.twitter.com` 有证书校验，一旦被小火箭解密就会直接断网，所以模块不拦截 X App 的域名，App 照常可用但不会记录。想记录推特就用 Safari 打开 x.com 刷，也可以把 x.com 添加到主屏幕当 App 用。

**X 图片墙（测试）**：X 的图片服务器可以解密，额外装这个模块后，会自动记下你在 X App 里刷到的图片和视频封面，在「刷过的」里多一个「X 图片」标签。只有图片，点不回原帖。如果 X 的图片加载不出来，关掉它即可：

```
https://raw.githubusercontent.com/SuInk/lostfeed/main/lostfeed-ximg.sgmodule
```

自动去重、跳过广告；数据只存在手机上的小火箭里，不会上传到任何地方。

高级：`https://suink.github.io/lostfeed/api/export` 导出 JSON，`https://suink.github.io/lostfeed/api/clear?p=xhs` 清空某个平台。

## 开发

```bash
npm test
```

`test/run.js` 在 Node 里模拟小火箭的脚本环境跑一遍样例数据，并生成 `test/preview.html` 预览页面。图标由 `scripts/make-icon.py` 生成。
