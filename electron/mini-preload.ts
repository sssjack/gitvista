import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopState, MiniBarApi, MiniFrame } from '../shared/types';

const api: MiniBarApi = {
  desktopState: () => ipcRenderer.invoke('gv:desktop:state'),
  desktopCommand: command => ipcRenderer.invoke('gv:desktop:command', command),
  onDesktopState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state);
    ipcRenderer.on('gv:desktop:state', handler);
    return () => ipcRenderer.removeListener('gv:desktop:state', handler);
  },
  onFrame: listener => {
    const handler = (_event: Electron.IpcRendererEvent, frame: MiniFrame) => listener(frame);
    ipcRenderer.on('gv:desktop:frame', handler);
    return () => ipcRenderer.removeListener('gv:desktop:frame', handler);
  },
};
contextBridge.exposeInMainWorld('gitvistaMini', api);
