'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const channels = new Set(['download-progress', 'qvac-progress', 'qvac-stream', 'accessibility']);
function unwrap(result) {
  if (result && result.error) throw new Error(result.error);
  return result?.value;
}
contextBridge.exposeInMainWorld('hiraiaDesktop', {
  // Preload runs before the main frame has a committed URL. Pass immutable
  // startup metadata directly; never weaken IPC origin checks for that phase.
  info: JSON.parse(decodeURIComponent(process.argv.find(value => value.startsWith('--hiraia-desktop-info=')).split('=').slice(1).join('='))),
  sync: (operation, ...args) => unwrap(ipcRenderer.sendSync('hiraia:sync', operation, args)),
  invoke: (operation, ...args) => ipcRenderer.invoke('hiraia:invoke', operation, args).then(unwrap),
  subscribe: (channel, callback) => {
    if (!channels.has(channel) || typeof callback !== 'function') throw new Error('Unknown desktop event');
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('hiraia:' + channel, listener);
    return () => ipcRenderer.removeListener('hiraia:' + channel, listener);
  },
});
