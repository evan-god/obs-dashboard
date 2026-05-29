/**
 * OBS 监控大盘 — Electron Preload v1.3.0
 * 安全地将主进程 API 暴露给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 导出配置 - 使用原生保存对话框
  exportConfig: (jsonContent) => {
    ipcRenderer.invoke('export-config-dialog', jsonContent);
  },
  // 导入配置 - 使用原生打开对话框
  importConfig: async () => {
    return ipcRenderer.invoke('import-config-dialog');
  },
  // 平台信息
  platform: process.platform,
  isElectron: true
});
