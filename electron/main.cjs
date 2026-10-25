const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
let service;
const smoke = process.argv.includes('--smoke-test');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      process.env.DISPARO_DATA_DIR ||= app.isPackaged
        ? path.join(app.getPath('userData'), 'data')
        : path.join(__dirname, '../.data');
      const { startServer } = await import('../server/index.mjs');
      try {
        service = await startServer({ port: 0 });
      } catch (error) {
        if (error.code !== 'INSTANCE_RUNNING' || !error.port) throw error;
        const state = await fetch(`http://127.0.0.1:${error.port}/api/state`).then((response) =>
          response.json(),
        );
        if (path.resolve(state.system.dataDir) !== path.resolve(process.env.DISPARO_DATA_DIR))
          throw error;
        service = { port: error.port, close: async () => {} };
      }
      const win = new BrowserWindow({
        show: !smoke,
        width: 1440,
        height: 960,
        minWidth: 1050,
        minHeight: 720,
        title: 'Disparo',
        backgroundColor: '#f5f6f8',
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      const localOrigin = `http://127.0.0.1:${service.port}`;
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
      });
      win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(localOrigin + '/')) event.preventDefault();
      });
      await win.loadURL(localOrigin);
      if (smoke) {
        fs.writeFileSync(
          process.env.DISPARO_SMOKE_REPORT,
          JSON.stringify({
            loaded: true,
            url: localOrigin,
            electron: process.versions.electron,
            version: app.getVersion(),
          }),
        );
        app.quit();
      }
    })
    .catch((error) => {
      if (smoke) {
        if (process.env.DISPARO_SMOKE_REPORT)
          fs.writeFileSync(
            process.env.DISPARO_SMOKE_REPORT,
            JSON.stringify({ loaded: false, error: error.message }),
          );
        app.exit(1);
      } else {
        require('electron').dialog.showErrorBox('Não foi possível abrir o Disparo', error.message);
        app.quit();
      }
    });
  let closing = false;
  app.on('before-quit', (event) => {
    if (service && !closing) {
      event.preventDefault();
      closing = true;
      service.close().finally(() => app.quit());
    }
  });
  app.on('window-all-closed', () => app.quit());
}
