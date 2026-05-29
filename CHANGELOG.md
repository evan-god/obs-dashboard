# OBS 直播间监控大盘 — 变更日志

版本规则：`主版本.次版本`（大更新改主版本号，小更新改次版本号）

---

## v1.0.0（2026-05-28）

### 核心功能
- OBS WebSocket v5 直连，实时监控多路直播间
- FLV 直播播放（mpegts.js），支持暂停/播放
- 即构 ZEGO CDN 自动拉流（从推流地址推断拉流地址）
- 房间卡片：在线状态、分辨率、帧率、码率、丢帧率、音频参数
- 左侧树形导航栏：全部直播间 → 地点 → 办公区 → 楼层
- 层级管理弹窗：树形结构增删地点/办公区/楼层，内联输入
- 房间管理：添加/编辑/删除直播间，自动关联层级
- 播放稳定性：heartbeat 检测、自动重连、renderAll 销毁、重复实例防护
- 运行日志：侧边栏底部折叠面板，💾 下载日志（Blob）
- 一键启动：`start-dashboard.js` HTTP 服务 + 自动打开浏览器

## v1.1.1（2026-05-28）

### 新增
- 麦克风实时电平波动条：订阅 `InputVolumeMeters` 事件，彩色电平条（绿/黄/红）+ dB 数值，60ms 节流 DOM 更新
- `GetInputVolume` 增加 fallback：`inputVolumeDb` 缺失时从 `inputVolumeMul` 计算

### 修改
- `eventSubscriptions` 增加 `InputVolumeMeters`（bit 16 = 65536），总计 65569
- 麦克风模块渲染：用「电平」波动条替换静态「音量」文本

## v1.2.0（2026-05-29）

### 新增
- 混音器音源下拉选择：从 OBS 获取全部音频输入（麦克风/桌面音频/辅助音频等），支持下拉切换监听设备
- `roomManager.selectAudioInput(id, name)` 方法：切换音源立即生效

### 修改
- 音频电平采集改为纯 OBS `InputVolumeMeters` 事件驱动（移除 Web Audio `createMediaElementSource` 方案）
  - 修复 `createMediaElementSource` 导致 FLV 视频无声的问题（该 API 会断开 video 元素默认音频输出）
- `InputVolumeMeters` 匹配逻辑：精准匹配 `selectedAudioInput`，不再做模糊/兜底匹配
- `GetInputList` 解析：同时匹配 `wasapi` 输入类型，覆盖 Windows WASAPI 音频设备
- 电平模块标题：麦克风 → 混音器电平
- state 新增 `audioInputs` / `selectedAudioInput` 字段
- 离线重置时同步清空音频输入列表

### 移除
- Web Audio 兜底方案（`_setupAudioMonitor` / `_cleanupAudioMonitor` 全部删除）
- `v._roomId` / `v._obsRoom` 赋值（不再需要）

## v1.3.0（2026-05-29）

### 新增
- **导入导出配置**：顶部栏「📤 导出配置」「📥 导入配置」按钮
  - 导出：rooms + hierarchy → `obs-config.json` 文件下载
  - 导入：读取 JSON → 合并房间（同名跳过）+ 覆盖层级 → 刷新生效
  - 导入提示：显示新增/跳过数量

## v1.2.2（2026-05-29）

### 修复
- 下拉选不中：`selectAudioInput` 改完后立即调用 `updateAllCards()` 重渲染卡片
- **下拉回弹（最终根因）**：`room.id` 是 number，HTML onchange 传 string，`Map.get(string)` ≠ `Map.get(number)` → `selectAudioInput` 直接 return 什么都不做。修复：`Number(id)` 统一类型 + 双写 `conn.state`
- 诊断日志：`GetInputList` 解析时输出保持/覆盖决策；新增 console 全局拦截 → 所有日志自动写入 `_logPersist`
- 电平条无波动：Phase 2.5 轮询 `GetInputVolume` 改为只查选中音源，并在 `InputVolumeMeters` 超过 5 秒未到时作为兜底数据源驱动电平条
- `GetInputVolume` 响应不再全量查询（之前查所有输入导致 state 被最后一条覆盖）


## v1.1.0（2026-05-28）

### 新增
- 录制状态显示：视频区徽章「REC」+ 卡片底部录制时长
- 虚拟摄像机状态：视频区徽章「虚拟摄像」
- 麦克风监控：设备名称 + 音量（dB）+ 静音检测，独立「麦克风」模块
- OBS WebSocket 轮询新增：`GetRecordStatus`、`GetVirtualCamStatus`、`GetInputList`、`GetInputVolume`
- 事件监听新增：`RecordStateChanged`、`VirtualcamStateChanged`

## v1.0.0（2026-05-28）

### 核心功能
- OBS WebSocket v5 直连，实时监控多路直播间
- FLV 直播播放（mpegts.js），支持暂停/播放
- 即构 ZEGO CDN 自动拉流（从推流地址推断拉流地址）
- 房间卡片：在线状态、分辨率、帧率、码率、丢帧率、音频参数
- 左侧树形导航栏：全部直播间 → 地点 → 办公区 → 楼层
- 层级管理弹窗：树形结构增删地点/办公区/楼层，内联输入
- 房间管理：添加/编辑/删除直播间，自动关联层级
- 播放稳定性：heartbeat 检测、自动重连、renderAll 销毁、重复实例防护
- 运行日志：侧边栏底部折叠面板，💾 下载日志（Blob）
- 一键启动：`start-dashboard.js` HTTP 服务 + 自动打开浏览器

### 技术栈
- 纯前端 HTML/CSS/JS，零框架依赖
- Node.js HTTP 服务（start-dashboard.js）
- mpegts.js FLV 播放器
- OBS WebSocket v5 协议
