# 构建、发布与恢复

0.1.0 小红书版已发布；当前正式体验入口在 README。GitHub 承载可运行源码，独立网页版可自行部署。仓库不会因 push 自动上线 Pages。

## 验证

```bash
npm ci --ignore-scripts
npm run verify
```

网页产物在 `dist/release/web/`。`artifacts/release-web-build-report.json` 记录源码散列、模块与输出文件散列。构建报告只描述新构建的检查结果，不代表该产物已经部署。

## 静态网页（可选）

上传 `dist/release/web/` 全部内容到静态服务器，或在 Fork 的 Settings → Pages 中选择 GitHub Actions，手动运行 `Publish Pages` 并填写验证过的提交／标签。工作流先构建和测试，再部署；默认 push 仅跑 CI。

当前主项目的在线体验使用小红书，不在 README 展示未经部署的 Pages 地址。

## 小红书

从自己的创服平台上传页取得当前完整官方口令，加载匹配版本的 Skill 到 `.codex/minitool-zip-builder/`，再运行 `npm run build:release`。官方工具不随本项目分发；不能把网页校验当作平台校验。

上传新版本前，用相同 ZIP 在官方模拟器和目标手机上检查开始、触控、横屏、整局、结算、重开与后台恢复。当前已上线包不因 GitHub 源码更新而自动变化。小红书反馈保持站内评论区说明。

网页版反馈链接由 `release/config.json` 的 `webFeedbackUrl` 配置，仅填真实可访问的 Issues URL；小红书构建不会显示该站外入口。

## 恢复

网页恢复：重新构建和部署上一稳定提交，检查新开页和刷新后的资源是否完整。Actions 归档默认保存 14 天，不表示静态托管会保留旧资源。

小红书恢复：保存上一稳定 ZIP 和 SHA256，通过创服重新上传并验证；是否重新审核及生效时间以平台为准。开发二维码不能替代正式体验分享链接。
