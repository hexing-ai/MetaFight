# 素材与许可

| 内容 | 来源 | 许可／用途 |
|---|---|---|
| 模拟、基础渲染、基础模型与程序化声音 | WebReal 固定版本，见 UPSTREAM.md | MIT，保留原版权 |
| 货轮地图、装饰、产品模型与程序化材质、HUD | src/metafight/ 与 dev/m3/ | 本项目原创代码，MIT |
| MetaFight MF 几何标识 | tools/make-release-icon.mjs | 原创，MIT；release/icon.svg及512×512 PNG可复现 |
| icons/ 下图标 | WebReal | MIT；仅用于上游入口，不进入公众包 |
| esbuild 0.28.2 / acorn 8.18.0 | 对应开源npm项目 | MIT，仅开发构建依赖 |
| 小红书 SDK / 官方打包 Skill | 宿主／官方 | 不随源码复制或再分发 |

晴昼封面与船体材质图集由内置 imagegen 生成，资源位于 dev/m3/assets/，来源、用途与 SHA256 见其中 SOURCES.json。封面属于美术插画，战斗场景由 WebGL 实时渲染。资源随包离线加载，没有从 CF 手游提取模型或贴图。设计研究的概念图不在公开源码或运行包中。MIT 许可不代表对第三方商标作权利承诺；WebReal 作者不为本项目背书。


README 展示图：`docs/images/gameplay.png` 为本项目 WebGL 实战原始截图；`docs/images/start-screen.png` 为真实开始页截图，含 AI 生成封面。均无第三方商业游戏画面或账号信息。原创生成图像由本项目按 MIT 条款提供使用，不承诺 AI 输出具备独占版权；不影响上游代码署名义务。
