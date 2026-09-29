import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../src/storage/bridge';
const bridge: DesktopBridge = {
  open: () => ipcRenderer.invoke('workspace:open'),
  reopen: () => ipcRenderer.invoke('workspace:reopen'),
  useBrowser: () => ipcRenderer.invoke('workspace:use-browser'),
  create: (workspace, attachments) =>
    ipcRenderer.invoke('workspace:create', workspace, attachments),
  save: (workspace, revision) => ipcRenderer.invoke('workspace:save', workspace, revision),
  putAttachment: (path, data) => ipcRenderer.invoke('attachment:put', path, data),
  getAttachment: (path) => ipcRenderer.invoke('attachment:get', path),
  subscribe: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) =>
      callback(value);
    ipcRenderer.on('workspace:changed', handler);
    return () => {
      ipcRenderer.removeListener('workspace:changed', handler);
    };
  },
};
contextBridge.exposeInMainWorld('desktop', bridge);
