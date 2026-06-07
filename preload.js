const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('obsidian', {
  pickFile:    (filters)              => ipcRenderer.invoke('pick-file', filters),
  getPort:     ()                     => ipcRenderer.invoke('get-port'),
  getVersion:  ()                     => ipcRenderer.invoke('get-version'),
  checkUpdate: ()                     => ipcRenderer.invoke('check-update'),
  saveFile:    (defaultName, content) => ipcRenderer.invoke('save-file', { defaultName, content }),
  readFile:    (filePath)             => ipcRenderer.invoke('read-file', filePath),
  getAudioPath: ()                      => ipcRenderer.invoke('get-audio-path'),
  onUpdaterStatus: (cb) => ipcRenderer.on('updater-status', (_, msg) => cb(msg)),
});

contextBridge.exposeInMainWorld('winCtrl', {
  minimize:    () => ipcRenderer.invoke('win-minimize'),
  maximize:    () => ipcRenderer.invoke('win-maximize'),
  close:       () => ipcRenderer.invoke('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),
});
