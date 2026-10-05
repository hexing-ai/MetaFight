# 安装、运行与排错

## 最短路径

1. 安装 Node.js 22 与 npm 10，运行 `node -v` 和 `npm -v` 检查版本。
2. 克隆仓库，运行 `npm ci --ignore-scripts`。锁文件固定 esbuild 与 acorn；没有游戏运行时第三方依赖。
3. 运行 `npm start`，打开终端显示的本机地址，点击「开始战斗」。此命令启动的是 MetaFight 当前版本。

不使用 Git 也可以从 GitHub 的 Code → Download ZIP 下载，解压后在含 package.json 的目录执行第 2、3 步中的 npm 命令。

## 常见情况

| 现象 | 处理 |
| --- | --- |
| Node 版本提示不匹配 | 使用 Node 22；`.nvmrc` 固定已使用的版本。安装 nvm 后执行 `nvm install && nvm use`。 |
| npm ci 下载失败 | 检查 npm registry 的连通性后重试；无需提供任何 API Key。 |
| 4173 已被占用 | `npm start -- --port 4174`，然后打开 `http://127.0.0.1:4174/`。 |
| 双击 HTML 后无法运行 | 使用本地 HTTP 预览；不要通过 file:// 打开构建文件。 |
| 找不到网页或资源 404 | 先执行 `npm run build:release:web`，再运行 `npm run preview`。 |
| 没有声音 | 先点击开始；查看游戏音量、系统静音及浏览器声音设置。 |
| 切出去后游戏不动 | 后台会自动暂停，返回后点击继续。 |
| 电脑无法自由转动视角 | 在右侧画面按住鼠标拖动；本产品不使用鼠标锁定。 |
| 手机打开电脑的 localhost 不通 | 预览只监听电脑的 127.0.0.1；手机推荐使用 README 的小红书体验入口。 |
| 提示缺少官方 Skill | 这是小红书打包依赖。普通体验请用 `npm start`，不需要官方工具。 |

## 开发命令

- `npm start` / `npm run dev`：构建当前公众游戏并预览；没有热更新，改源码后停止并重启。
- `npm run verify`：自动构建必要网页产物，运行全部回归检查；支持不具备小红书官方工具的环境。
- `npm run test:m3`：仅视觉、体验和性能预算相关测试。
- `npm run dev:upstream`：保留的上游底座入口，默认端口 5173；不用于体验当前产品。
- `npm run build:web`：早期平台能力探针，不是公众游戏。
- `npm run build:release:web`：当前公众网页版。

独立部署只需 `dist/release/web/` 全部文件，不能只上传 index.html。支持静态项目子路径，不需要服务器端路由或数据库。详见 [发布说明](../RELEASING.md)。


## 在同一 Wi-Fi 下用手机试玩

运行 `npm start -- --lan --port 4187`，然后用手机浏览器打开终端打印的局域网地址。手机和电脑需连接同一Wi-Fi，电脑保持唤醒。该预览仅提供构建后的游戏文件；停止服务按Ctrl+C。
