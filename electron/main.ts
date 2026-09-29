import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/http';
import { DiskWorkspace } from './workspace';
import { parseWorkspace, type Workspace } from '../src/domain/schema';

let win: BrowserWindow | null = null,
  disk: DiskWorkspace | null = null;
const url = 'travopaz://app/';
// A stable, standard origin keeps IndexedDB available across restarts, regardless of the API port.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'travopaz',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
const profile = app.commandLine.getSwitchValue('user-data-dir');
if (profile) app.setPath('userData', path.resolve(profile));
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
  const backend = `http://127.0.0.1:${server.port}`;
  protocol.handle('travopaz', async (request) => {
    const target = new URL(request.url);
    if (target.host !== 'app') return new Response('未知应用地址', { status: 404 });
    // Only forward to this application's loopback server. Do not forward the custom Origin/Host.
    return net.fetch(`${backend}${target.pathname}${target.search}`, {
      method: request.method,
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? 'application/json' },
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
    });
  });
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
      const prefs = JSON.parse(await readFile(preferencePath(), 'utf8')) as {
        directory: string | null;
      };
      return prefs.directory ? attach(prefs.directory) : null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  });
  handle('workspace:use-browser', async () => {
    await writeFile(preferencePath(), JSON.stringify({ directory: null }, null, 2));
    disk?.close();
    disk = null;
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
