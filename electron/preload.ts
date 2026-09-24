import { contextBridge, ipcRenderer } from 'electron';
import type { GitVistaApi } from '../shared/types';
const api: GitVistaApi = {
  settings: () => ipcRenderer.invoke('gv:settings'),
  setTheme: theme => ipcRenderer.invoke('gv:theme', theme),
  updatePreferences: preferences => ipcRenderer.invoke('gv:preferences', preferences),
  browseGitPath: () => ipcRenderer.invoke('gv:git:browse'),
  testGitPath: gitPath => ipcRenderer.invoke('gv:git:test', gitPath),
  getGitIdentity: repo => ipcRenderer.invoke('gv:identity:get', repo),
  setGitIdentity: (repo, identity) => ipcRenderer.invoke('gv:identity:set', repo, identity),
  openRepository: path => ipcRenderer.invoke('gv:open', path),
  forgetRepository: path => ipcRenderer.invoke('gv:forget', path),
  cloneRepository: (url, parent, name) => ipcRenderer.invoke('gv:clone', url, parent, name),
  initRepository: path => ipcRenderer.invoke('gv:init', path),
  query: (repo, query) => ipcRenderer.invoke('gv:query', repo, query),
  action: (repo, action) => ipcRenderer.invoke('gv:action', repo, action),
  exportPatch: (repo, ref) => ipcRenderer.invoke('gv:export', repo, ref),
  revealPath: (repo, relative) => ipcRenderer.invoke('gv:reveal', repo, relative),
  windowControl: action => ipcRenderer.send('gv:window', action),
};
contextBridge.exposeInMainWorld('gitvista', api);
