# OBS 直播间监控大盘

多路 OBS 直播间实时监控面板，WebSocket v5 直连，支持 FLV 直播播放预览。

## 功能

- **多路监控** — OBS WebSocket v5 直连，同时监控多台 OBS 实例
- **直播预览** — 集成 FLV 播放器（mpegts.js），支持即构 ZEGO CDN 拉流
- **音频监控** — 麦克风实时电平波动条，混音器音源切换
- **视频参数** — 分辨率、帧率、码率、丢帧率实时展示
- **层级管理** — 地点 → 办公区 → 楼层 → 直播间，树形导航
- **录制/虚拟摄像** — 录制状态、虚拟摄像机状态显示
- **导入导出** — 配置文件一键导入导出，团队共享大盘
- **纯前端** — 单 HTML 文件，零框架依赖，Node.js 静态服务即可运行

## 快速开始

### 环境要求

- Node.js（运行本地 HTTP 服务）
- OBS 28+（需开启 WebSocket 服务器，默认端口 4455）

### 启动

```bash
# 方式一：双击批处理
启动OBS大盘.bat

# 方式二：命令行
node start-dashboard.js
```

浏览器自动打开 `http://localhost:8392`。

### 导入配置

同事拿到 `obs-config.json` 后，点击顶部「📥 导入配置」即可看到相同的大盘布局。

## 项目结构

```
├── obs-dashboard.html   # 主页面（全部功能）
├── obs-rooms.json       # 房间配置文件
├── start-dashboard.js   # HTTP 服务启动脚本
├── 启动OBS大盘.bat       # Windows 快速启动
├── electron/            # Electron 桌面应用壳（开发中）
├── package.json         # 项目配置
└── CHANGELOG.md         # 变更日志
```

## 技术栈

- HTML/CSS/JS（零框架）
- OBS WebSocket v5
- mpegts.js（FLV 播放）
- Node.js HTTP 服务

## License

MIT
