import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/http';
import { DiskWorkspace } from './workspace';
import { parseWorkspace, type Workspace } from '../src/domain/schema';

let win: BrowserWindow | null = null,
  disk: DiskWorkspace | null = null;
let url = '';
const preferencePath = () => path.join(app.getPath('userData'), 'recent-workspace.json');
async function attach(
  directory: string,
  initialize?: Workspace,
  attachments: { path: string; data: number[] }[] = [],
) {
  const next = new DiskWorkspace(directory, (event) =>
    win?.webContents.send('workspace:changed', event),
  );
  const snapshot = initialize ? await next.initialize(initialize) : await next.load();
  if (initialize)
    for (const a of attachments) await next.putAttachment(a.path, new Uint8Array(a.data));
  disk?.close();
  disk = next;
  disk.startWatching();
  await writeFile(preferencePath(), JSON.stringify({ directory }, null, 2));
  return snapshot;
}
function handle(name: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(name, (event, ...args) => {
    if (
      event.sender !== win?.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== url
    )
      throw new Error('不允许的调用来源');
    return fn(...args);
  });
}
app.whenReady().then(async () => {
  const root = app.getAppPath();
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const server = await startServer({ root, port: 0 });
  url = `http://127.0.0.1:${server.port}/`;
  app.on('will-quit', () => {
    disk?.close();
    server.server.close();
  });
  handle('workspace:open', async () => {
    const selection = await dialog.showOpenDialog(win!, {
      title: '打开 Travopaz 工作区文件夹',
      properties: ['openDirectory'],
    });
    return selection.canceled ? null : attach(selection.filePaths[0]);
  });
  handle('workspace:reopen', async () => {
    try {
      const prefs = JSON.parse(await readFile(preferencePath(), 'utf8')) as { directory: string };
      return attach(prefs.directory);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  });
  handle(
    'workspace:create',
    async (workspace: unknown, attachments: { path: string; data: number[] }[]) => {
      const w = parseWorkspace(workspace);
      const selection = await dialog.showOpenDialog(win!, {
        title: '选择空文件夹存放 Workspace',
        properties: ['openDirectory', 'createDirectory'],
      });
      return selection.canceled ? null : attach(selection.filePaths[0], w, attachments);
    },
  );
  handle('workspace:save', (workspace: unknown, revision: string) => {
    if (!disk) throw new Error('尚未打开本地工作区');
    return disk.save(parseWorkspace(workspace), revision);
  });
  handle('attachment:put', (relative: string, data: number[]) => {
    if (!disk) throw new Error('尚未打开本地工作区');
    return disk.putAttachment(relative, new Uint8Array(data));
  });
  handle('attachment:get', async (relative: string) => {
    if (!disk) throw new Error('尚未打开本地工作区');
    return Array.from(await disk.getAttachment(relative));
  });
  win = new BrowserWindow({
    width: 1500,
    height: 1050,
    minWidth: 1100,
    minHeight: 700,
    title: 'Travopaz · 旅行规划工作台',
    backgroundColor: '#f6f5f1',
    webPreferences: {
      preload: path.join(root, 'dist-electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.setWindowOpenHandler(({ url: external }) => {
    if (/^https?:\/\//.test(external)) void shell.openExternal(external);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, external) => {
    if (external !== url) {
      event.preventDefault();
      if (/^https?:\/\//.test(external)) void shell.openExternal(external);
    }
  });
  await win.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
