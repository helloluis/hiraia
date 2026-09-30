'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, session, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { createStorage } = require('./storage.cjs');
const { createDownloads } = require('./downloads.cjs');
const { createInference } = require('./inference.cjs');
const { createTelemetry } = require('./telemetry.cjs');
const pkg = require('../package.json');
const buildInfo = require('../renderer/build-info.json');
const worker = path.join(__dirname, '..', 'qvac/worker.entry.mjs');
if (fs.existsSync(worker)) process.env.QVAC_WORKER_PATH = worker;

// Stable per-user storage, never next to an EXE on a USB stick or in Downloads.
app.setName('Hiraia');
if (process.env.HIRAIA_TEST_DATA_DIR) app.setPath('userData', path.resolve(process.env.HIRAIA_TEST_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'hiraia', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
let window;
let storage;
let inference;
let downloads;
const telemetry = createTelemetry();
let shuttingDown = false;

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' hiraia://file data: blob:; font-src 'self' data:; media-src 'self' hiraia://file blob:; connect-src 'self' hiraia://file https://hiraia.org https://assets.hiraia.org; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
function emit(channel, data) { if (window && !window.isDestroyed()) window.webContents.send('hiraia:' + channel, data); }
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted desktop caller');
  const url = new URL(event.senderFrame.url);
  if (url.protocol !== 'hiraia:' || url.hostname !== 'app') throw new Error('Untrusted desktop origin');
}
function failure(error) { console.error('[desktop]', error); return { error: String(error.message ?? error) }; }

async function start() {
  await app.whenReady();
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  storage = createStorage({ rendererRoot, dataRoot: app.getPath('userData') });
  downloads = createDownloads(storage, emit);
  inference = createInference(storage, emit);
  const info = () => ({ version: pkg.version, build: buildInfo.versionCode, platform: process.platform, arch: process.arch,
    totalMemory: os.totalmem(), screenReader: app.isAccessibilitySupportEnabled(), paths: storage.paths });
  const sync = { ...storage.sync, info };
  const async = { ...sync, 'fs.hash': storage.hash, 'download.start': downloads.start,
    'download.cancel': downloads.cancel, ...inference.handlers, ...telemetry.handlers };
  ipcMain.on('hiraia:sync', (event, operation, args) => {
    try { trusted(event); if (!Object.hasOwn(sync, operation) || !Array.isArray(args)) throw new Error('Unknown desktop operation');
      event.returnValue = { value: sync[operation](...args) }; }
    catch (error) { event.returnValue = failure(error); }
  });
  ipcMain.handle('hiraia:invoke', async (event, operation, args) => {
    try { trusted(event); if (!Object.hasOwn(async, operation) || !Array.isArray(args)) throw new Error('Unknown desktop operation');
      return { value: await async[operation](...args) }; }
    catch (error) { return failure(error); }
  });
  protocol.handle('hiraia', async request => {
    try {
      const url = new URL(request.url);
      let target;
      if (url.hostname === 'file') target = storage.resolve(request.url);
      else if (url.hostname === 'app') {
        target = storage.resolve(request.url);
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
          if (path.extname(url.pathname)) return new Response('Missing asset', { status: 404 });
          target = path.join(rendererRoot, 'index.html');
        }
      } else return new Response('Unknown origin', { status: 403 });
      const response = await net.fetch(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', CSP);
      headers.set('Access-Control-Allow-Origin', 'hiraia://app');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) { console.warn('[desktop asset]', error.message); return new Response('Asset unavailable', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ title: 'Hiraia', width: 1366, height: 850, minWidth: 360, minHeight: 480,
    backgroundColor: '#1C3B2E', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, spellcheck: false,
      additionalArguments: ['--hiraia-desktop-info=' + encodeURIComponent(JSON.stringify(info()))] } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Hiraia', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' }] },
  ]));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, value) => {
    const url = new URL(value);
    if (url.protocol !== 'hiraia:' || url.hostname !== 'app') event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => console.error('[desktop renderer]', details));
  window.webContents.on('console-message', event => console.log('[renderer]', event.message));
  app.on('accessibility-support-changed', (_event, value) => emit('accessibility', value));
  window.once('ready-to-show', () => window.show());
  await window.loadURL('hiraia://app/');
  if (process.env.HIRAIA_DESKTOP_DEVTOOLS === '1') window.webContents.openDevTools({ mode: 'detach' });
}
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (shuttingDown || !storage) return;
  event.preventDefault(); shuttingDown = true; downloads.close(); telemetry.close();
  Promise.race([inference.close(), new Promise(resolve => setTimeout(resolve, 3000))])
    .finally(() => { if (window && !window.isDestroyed()) window.destroy(); storage.close(); app.quit(); });
});
if (primary) start().catch(error => { console.error(error); dialog.showErrorBox('Hiraia could not start', error.message); app.exit(1); });
