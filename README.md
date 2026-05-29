# OBS 直播间监控大盘

> v1.3.0 — 多路 OBS 直播间实时监控面板，WebSocket v5 直连，FLV 直播预览，开箱即用。

一个纯前端的 OBS 多路监控工具。单 HTML 文件 + Node.js HTTP 服务，零框架依赖，浏览器打开即用。适合直播运营团队同时监控多路主播画面、视频参数、音频电平和录制状态。

---

## 预览

![OBS 监控大盘](dashboard.png)

---

## 功能详情

### 直播监控

| 功能 | 说明 |
|------|------|
| 多路并发 | OBS WebSocket v5 直连，同时连接多台 OBS 实例，每台一个独立卡片 |
| FLV 直播播放 | 集成 mpegts.js，支持暂停/播放，默认 500ms 缓冲消除花屏 |
| 即构 ZEGO 拉流 | 自动从推流地址推断拉流地址（`play-hw.live-zego.lizhiweike.com`），无需手动输入 |
| 心跳检测 | `currentTime` 连续 3 次不变 → 自动重连；`LOADING_COMPLETE` 事件触发重连 |
| 防重复实例 | 每次重建播放器前彻底销毁旧实例（detachMediaElement + destroy） |

### 视频参数

| 指标 | 数据来源 |
|------|----------|
| 推流状态 | OBS `GetStreamStatus` + `StreamStateChanged` 事件 |
| 分辨率 | OBS `GetVideoSettings`（Base/Output 分辨率，横竖屏自动识别） |
| 帧率 | OBS `GetVideoSettings`（整数 + 分数帧率） |
| 码率 | OBS `GetOutputSettings`（视频 + 音频码率） |
| 丢帧 | OBS `GetOutputStatus`（渲染丢帧、编码丢帧、输出丢帧总量） |
| 编码器 | OBS `GetOutputSettings`（编码器名称，如 NVIDIA NVENC H.264） |

### 音频监控

| 功能 | 说明 |
|------|------|
| 电平波动条 | 彩色可视化（绿 -48~-18dB / 黄 -18~-9dB / 红 -9~0dB），实时 dB 数值 |
| 混音器音源切换 | 下拉框列出 OBS 全部音频输入（麦克风/桌面音频/辅助音频），可切换监听 |
| 音频参数 | 采样率、声道数、音频码率 |
| 静音检测 | 电平持续低于阈值时提示 |

### 录制 & 虚拟摄像机

- 录制状态：视频区 `REC` 红色徽章 + 实时录制时长（hh:mm:ss）
- 虚拟摄像机：视频区 `虚拟摄像` 蓝紫色徽章
- 状态通过 OBS `RecordStateChanged` / `VirtualcamStateChanged` 事件实时更新

### 层级管理

```
全部直播间
  ├── 地点 A
  │   ├── 办公区 A1
  │   │   ├── 楼层 1
  │   │   │   ├── 直播间 1
  │   │   │   └── 直播间 2
  │   │   └── 楼层 2
  │   └── 办公区 A2
  └── 地点 B
```

- 左侧树形导航栏，点击节点过滤房间卡片
- 「🏗️ 管理」弹窗：内联新增/删除地点、办公区、楼层
- 「管理」按钮删除节点时自动解除关联房间的层级绑定

### 导入导出

| 操作 | 说明 |
|------|------|
| 📤 导出配置 | 将当前 rooms + hierarchy 导出为 `obs-config.json` |
| 📥 导入配置 | 读取 JSON → 同名房间跳过（保留配置）→ 新增房间合并 → 层级直接覆盖 |

**典型场景**：管理员配好大盘 → 导出 → 分发给同事 → 同事导入即看到相同布局。

### 运行日志

- 侧边栏底部可折叠日志面板，实时滚动
- 自动拦截 `console.log/warn/error` 写入内存（最多 1000 条）
- 「💾 下载日志」按钮导出为 `.log` 文件，方便排查问题

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│                    浏览器 (obs-dashboard.html)         │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │ 树形导航 │ │ 房间卡片  │ │ FLV播放 │ │ 运行日志   │  │
│  └─────────┘ └──────────┘ └────────┘ └───────────┘  │
│       ▲            ▲            ▲           ▲         │
│       └────────────┼────────────┼───────────┘         │
│                    │            │                      │
│           ┌────────┴─────────┐  │                      │
│           │  Connection Pool │  │                      │
│           │  (Map<id, conn>) │  │                      │
│           └────────┬─────────┘  │                      │
│                    │            │                      │
└────────────────────┼────────────┼──────────────────────┘
                     │            │
           WebSocket │            │ HTTP-FLV
           (wss://)  │            │ (CDN 拉流)
                     ▼            ▼
          ┌──────────────┐  ┌─────────────┐
          │  OBS 实例 1   │  │ ZEGO CDN    │
          │  (WebSocket   │  │ (play-hw.   │
          │   Server 5.x) │  │  live-zego…)│
          ├──────────────┤  └─────────────┘
          │  OBS 实例 2   │
          ├──────────────┤
          │  OBS 实例 N   │
          └──────────────┘
```

- **OBS 通信层**：每个直播间维护一个独立 WebSocket 连接，2 秒轮询 + 事件订阅双通道
- **FLV 播放层**：mpegts.js 通过 CDN 拉流，每个视频独立 `MediaDataSource` + 播放器实例
- **状态管理**：集中式 state 对象（rooms / hierarchy / connections / audioInputs）

---

## 快速开始

### 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Node.js | 14+ |
| OBS Studio | 28.0+（内置 WebSocket 5.x） |
| 浏览器 | Chrome / Edge / Firefox 最新版 |

### 1. OBS 开启 WebSocket

1. 打开 OBS Studio → 菜单「工具」→「WebSocket 服务器设置」
2. 勾选「启用 WebSocket 服务器」
3. 端口保持默认 `4455`
4. 如需密码保护，设置「服务器密码」并勾选「启用身份验证」
5. 点击「确定」

### 2. 克隆项目

```bash
git clone https://github.com/evan-god/obs-dashboard.git
cd obs-dashboard
```

### 3. 配置直播间

编辑 `obs-rooms.json`：

```json
[
  {
    "id": 1,
    "name": "room01",
    "streamer": "主播01",
    "host": "192.168.1.101",
    "port": 4455,
    "password": "",
    "platform": "自有平台",
    "pullUrl": "",
    "flvUrl": ""
  },
  {
    "id": 2,
    "name": "room02",
    "streamer": "主播02",
    "host": "192.168.1.102",
    "port": 4455,
    "password": "",
    "platform": "即构ZEGO",
    "pullUrl": "rtmp://push-hw.live-zego.lizhiweike.com/lizhiweike/streamkey",
    "flvUrl": ""
  }
]
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 唯一数字 ID |
| `name` | 是 | 房间名称 |
| `streamer` | 是 | 主播名称 |
| `host` | 是 | OBS 所在主机 IP |
| `port` | 是 | OBS WebSocket 端口，默认 4455 |
| `password` | 否 | WebSocket 密码（OBS 未设密码则留空） |
| `platform` | 否 | 平台名称（如「即构ZEGO」「自有平台」） |
| `pullUrl` | 否 | 推流地址，用于自动推断 FLV 拉流地址 |
| `flvUrl` | 否 | FLV 拉流地址（填写后优先使用，忽略 pullUrl 推断） |

> **即构 ZEGO 拉流规则**：固定域名 `play-hw.live-zego.lizhiweike.com`，应用名 `lizhiweike`，流名从推流 key 提取，后缀 `.flv`。系统自动拼接，无需手动填写 `flvUrl`。

### 4. 启动

```bash
# 方式一：双击批处理
启动OBS大盘.bat

# 方式二：命令行
node start-dashboard.js
```

浏览器自动打开 `http://localhost:8392`，开始监控。

---

## 使用指南

### 添加直播间

1. 点击右上角「+ 添加房间」
2. 填写房间名称、主播名称、OBS 主机 IP、端口、密码（如有）
3. 选择所属平台，填写推流地址
4. 选择层级归属（可选）→ 点击「添加」

### 管理层级

1. 点击左侧「🏗️ 管理」→ 打开层级管理弹窗
2. 直接在树节点旁输入新名称 → 回车创建
3. 点击节点旁的「✕」删除（自动解除关联）

### 播放控制

- **▶️ 播放**：点击卡片视频区的播放按钮
- **⏸️ 暂停**：再次点击暂停，释放播放器资源
- **🔊 静音**：点击视频区的音量图标切换静音

### 导入导出配置

#### 导出（管理员操作）
1. 配置好所有房间和层级
2. 点击顶部「📤 导出配置」
3. 自动下载 `obs-config.json`

#### 导入（同事操作）
1. 克隆项目后，点击顶部「📥 导入配置」
2. 选择 `obs-config.json` 文件
3. 自动合并：已有房间跳过，新房间加入，层级覆盖
4. 弹窗提示新增/跳过数量

---

## 调试 & 排错

### OBS 连不上

```bash
# 检查 4455 端口是否可达
curl http://<obs-host>:4455
```

如果返回 JSON 或 `Upgrade Required` → 端口通；如果超时 → 检查防火墙。

### 视频不播放

1. 确认 `pullUrl` 推流地址正确
2. 确认 OBS 正在推流（底部状态栏绿色）
3. 打开浏览器 F12 → Console 查看 mpegts.js 错误日志
4. 点击「💾 下载日志」导出完整运行日志

### 音频电平条无波动

1. 在混音器下拉框中切换音源
2. 确认 OBS 中该音频设备有信号输入
3. 检查 Console 是否有 `[OBS METER]` 日志

### 常见网络问题

| 问题 | 原因 | 解决 |
|------|------|------|
| WebSocket 连接失败 | 防火墙拦截 4455 端口 | Windows 防火墙添加入站规则 |
| FLV 加载失败 | 网络不通 CDN | 检查是否能访问 `play-hw.live-zego.lizhiweike.com` |
| 跨域错误 | 非本机访问 | 使用 Node.js HTTP 服务启动，不要直接双击 HTML |

---

## 技术栈

| 层 | 技术 |
|----|------|
| UI | HTML5 + CSS3（CSS 变量暗色主题） |
| 逻辑 | Vanilla JS（ES6+，零框架） |
| OBS 通信 | WebSocket（RFC 6455），OBS WebSocket v5 协议 |
| FLV 播放 | [mpegts.js](https://github.com/xqq/mpegts.js) |
| 服务 | Node.js `http` 模块（静态文件 + OBS API 代理） |
| 数据存储 | 浏览器 localStorage + `obs-rooms.json` |

---

## 项目结构

```
obs-dashboard/
├── obs-dashboard.html    # 主页面（~3500 行，全部功能内嵌）
├── obs-rooms.json        # 房间配置（git 跟踪模板）
├── start-dashboard.js    # HTTP 服务（端口 8392）
├── 启动OBS大盘.bat        # Windows 一键启动
├── dashboard.png         # 界面截图
├── package.json          # npm 配置 + Electron 打包配置
├── CHANGELOG.md          # 完整变更日志
├── electron/             # Electron 桌面应用壳（开发中）
│   ├── main.js           #   主进程
│   └── preload.js        #   预加载脚本
└── .gitignore
```

---

## 路线图

- [x] 多路 OBS WebSocket 监控
- [x] FLV 直播播放 + 即构 ZEGO CDN 拉流
- [x] 麦克风电平 + 混音器音源切换
- [x] 录制/虚拟摄像机状态
- [x] 层级管理（地点 → 办公区 → 楼层）
- [x] 导入导出配置
- [x] 运行日志下载
- [ ] Electron 桌面应用打包（.exe 安装包）
- [ ] 多用户登录 + 权限管理
- [ ] 实时告警（断流/高丢帧/静音）
- [ ] 历史数据回放

---

## License

[MIT](LICENSE)
