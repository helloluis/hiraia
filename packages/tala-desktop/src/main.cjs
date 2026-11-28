'use strict';
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const policy = require('./policy.cjs');

// Packaged apps have no origin override, test IPC, preload or Node bridge.
// Test mode only substitutes a local HTTPS fixture in the unpackaged app.
const testing = !app.isPackaged && process.env.TALA_DESKTOP_TEST === '1';
const origin = testing ? process.env.TALA_DESKTOP_TEST_ORIGIN : policy.ORIGIN;
if (!policy.internal(origin, origin)) throw new Error('HTTPS origin required');
if (testing) app.setPath('userData', process.env.TALA_DESKTOP_TEST_PROFILE);
app.setName('Tala');
app.enableSandbox();
const partition = 'persist:tala';
const recovery = pathToFileURL(path.join(__dirname, 'recovery.html')).href;
const windows = new Set();
let externalPrompt = false;
let mainWindow;

async function openExternal(url, owner) {
  if (!policy.external(url, origin) || externalPrompt) return;
  externalPrompt = true;
  try {
    const result = await dialog.showMessageBox(owner, {
      type: 'question', title: 'Open link in your browser?',
      message: 'This link opens outside Tala.', detail: url,
      buttons: ['Cancel', 'Open browser'], defaultId: 0, cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) await shell.openExternal(url);
  } finally { externalPrompt = false; }
}
function attach(win) {
  windows.add(win);
  win.on('closed', () => windows.delete(win));
  const wc = win.webContents;
  // about:blank is needed by Tala's same-origin print iframe, never top-level.
  wc.on('will-frame-navigate', (event) => {
    if (policy.internal(event.url, origin)) return;
    if (!event.isMainFrame && event.url === 'about:blank') return;
    event.preventDefault();
    if (event.isMainFrame && policy.internal(wc.getURL(), origin)) void openExternal(event.url, win);
  });
  wc.on('will-redirect', (event, url) => {
    if (!policy.internal(url, origin)) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (policy.internal(wc.getURL(), origin) && policy.internal(url, origin)) {
      return { action: 'allow', overrideBrowserWindowOptions: windowOptions() };
    }
    if (policy.internal(wc.getURL(), origin)) void openExternal(url, win);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => attach(child));
  wc.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && policy.internal(url, origin)) void win.loadURL(recovery);
  });
  wc.on('render-process-gone', () => { if (!win.isDestroyed()) void win.loadURL(recovery); });
  return win;
}
function windowOptions() {
  return { width: 1280, height: 850, minWidth: 480, minHeight: 480,
    title: 'Tala', backgroundColor: '#F5ECD6',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: policy.preferences(partition) };
}
function createWindow() {
  mainWindow = attach(new BrowserWindow(windowOptions()));
  void mainWindow.loadURL(origin + '/week').catch(() => {});
  return mainWindow;
}
function configureSession(ses) {
  ses.webRequest.onHeadersReceived({ urls: [origin + '/*'] }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    // Next's bootstrap uses inline scripts/styles. There is still no eval, remote
    // script host, plugin content, foreign frame, HTTP content, or Node bridge.
    if (details.resourceType === 'mainFrame') {
      const sitePolicies = [];
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-security-policy') {
        sitePolicies.push(...headers[key]); delete headers[key];
      }
      // Multiple CSP headers intersect: never weaken a future policy from Tala.
      headers['Content-Security-Policy'] = [...sitePolicies,
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
      ];
    }
    callback({ responseHeaders: headers });
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
    !!wc && policy.internal(wc.getURL(), origin) && policy.internal(requestingOrigin, origin) &&
    ['fullscreen', 'clipboard-sanitized-write'].includes(permission));
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const trusted = wc && policy.internal(wc.getURL(), origin) && policy.internal(details.requestingUrl, origin);
    callback(!!trusted && ['fullscreen', 'clipboard-sanitized-write'].includes(permission));
  });
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (event, item, wc) => {
    const name = policy.filename(item.getFilename());
    if (!wc || !policy.internal(wc.getURL(), origin) || !name ||
        !policy.download(item.getURL(), origin) || !item.getURLChain().every(url => policy.download(url, origin))) {
      event.preventDefault();
      return;
    }
    // Electron's native Save dialog handles explicit file selection and overwrite confirmation.
    item.setSaveDialogOptions({ title: 'Save from Tala', defaultPath: path.join(app.getPath('downloads'), name) });
    item.once('done', async (_event, state) => {
      if (state === 'cancelled') return;
      const owner = BrowserWindow.fromWebContents(wc);
      if (!owner || owner.isDestroyed()) return;
      if (state !== 'completed') {
        await dialog.showMessageBox(owner, { type: 'error', message: 'The file could not be saved. Please try the download again.' });
        return;
      }
      // Never execute or automatically open downloaded bytes. Only reveal the file
      // the native dialog just saved, on explicit user confirmation.
      const result = await dialog.showMessageBox(owner, { message: 'File saved.',
        buttons: ['Done', 'Show in folder'], defaultId: 0, cancelId: 0 });
      if (result.response === 1) shell.showItemInFolder(item.getSavePath());
    });
  });
}
function menu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: (_item, win) => win?.webContents.print({ silent: false }) },
      { role: 'close' }, ...(process.platform !== 'darwin' ? [{ role: 'quit' }] : []),
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: (_item, win) => {
        if (win?.webContents.getURL() === recovery) void win.loadURL(origin + '/week').catch(() => {});
        else win?.webContents.reload();
      } }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [
      { label: 'Downloads and installation help', click: () => { void shell.openExternal(policy.ORIGIN + '/download'); } },
      { label: 'About Tala', click: () => { void dialog.showMessageBox({ message: 'Tala ' + app.getVersion(), detail: 'Online lesson planning by Hiraia. Internet required. Download a new installer to update this desktop app.' }); } },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => {
    configureSession(session.fromPartition(partition));
    menu(); createWindow();
    app.on('activate', () => { if (windows.size === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('web-contents-created', (_event, wc) => {
    wc.on('select-bluetooth-device', (event, _devices, callback) => { event.preventDefault(); callback(''); });
  });
}
