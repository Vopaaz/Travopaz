import { _electron as electron, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDemo } from '../../src/domain/factory';
import { spawn } from 'node:child_process';

const xvfb =
  process.env.TRAVOPAZ_TEST_XVFB === '1'
    ? spawn(
        'Xvfb',
        [
          '-displayfd',
          '3',
          '-screen',
          '0',
          '1600x1100x24',
          '-nolisten',
          'unix',
          '-listen',
          'tcp',
          '-ac',
        ],
        { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] },
      )
    : null;
process.on('exit', () => xvfb?.kill());
if (xvfb)
  process.env.DISPLAY = `127.0.0.1:${await new Promise<string>((resolve, reject) => {
    let error = '';
    xvfb.stderr!.on('data', (chunk) => {
      if (error.length < 4000) error += chunk.toString();
    });
    const timeout = setTimeout(() => {
      xvfb.kill();
      reject(new Error(`Xvfb 启动超时：${error}`));
    }, 5000);
    xvfb.stdio[3]!.once('data', (data: Buffer) => {
      clearTimeout(timeout);
      resolve(data.toString().trim());
    });
    xvfb.once('error', reject);
    xvfb.once('exit', (code) => {
      clearTimeout(timeout);
      if (code) reject(new Error(`Xvfb ${code}: ${error}`));
    });
  })}`;

const config = await mkdtemp(path.join(os.tmpdir(), 'travopaz-electron-config-'));
const directory = await mkdtemp(path.join(os.tmpdir(), 'travopaz-electron-workspace-'));
const electronEnv: Record<string, string> = Object.fromEntries(
  Object.entries({ ...process.env, GOOGLE_MAPS_API_KEY: '' }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
delete electronEnv.ELECTRON_RUN_AS_NODE;
let app: ElectronApplication | undefined;
let electronErrors = '';
const launch = async () => {
  app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${config}`],
    env: electronEnv,
  });
  app.process().stderr?.on('data', (chunk) => {
    electronErrors = (electronErrors + chunk.toString()).slice(-6000);
  });
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(config);
  const page = await app.firstWindow();
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  expect(page.url()).toBe('travopaz://app/');
  // GET and POST both use the protocol bridge; the test never spends a real Maps API quota.
  expect(await page.evaluate(async () => (await fetch('/api/health')).json())).toEqual({
    ok: true,
    routingConfigured: false,
  });
  expect(
    await page.evaluate(async () => (await fetch('/api/routes/clear', { method: 'POST' })).json()),
  ).toEqual({ ok: true });
  expect(
    await page.evaluate(async () =>
      (
        await fetch('/api/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: '地点甲', destination: '地点乙', mode: 'WALK' }),
        })
      ).json(),
    ),
  ).toMatchObject({ status: 'unavailable', minutes: null, source: 'google' });
  return page;
};
try {
  let page = await launch();
  await expect(page.getByRole('heading', { name: '京都 · 慢游三日' })).toBeVisible();
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  let settings = page.getByRole('dialog', { name: '全局设置', exact: true });
  await settings.getByLabel('Home名称', { exact: true }).fill('桌面端的家');
  await settings.getByLabel('Home地址', { exact: true }).fill('跨平台设置保存测试');
  await settings.getByLabel('默认交通出发前缓冲 / 分钟').fill('125');
  await settings.getByLabel('步行阈值 / 分钟').fill('18');
  await settings.getByRole('combobox', { name: '默认导航应用', exact: true }).selectOption('apple');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '编辑旅行设置', exact: true }).click();
  await page.getByLabel('旅行名称', { exact: true }).fill('重启后保留的桌面旅行');
  await page.getByLabel('旅行名称', { exact: true }).blur();
  await page.locator('.candidate-card').filter({ hasText: '锦市场' }).click();
  await page.locator('.detail-panel input[type="file"]').setInputFiles({
    name: 'restart.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('persistent desktop attachment'),
  });
  await expect(page.locator('.attachment-row')).toContainText('restart.txt');
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await app!.close();

  // Relaunch the actual main process with the same profile and a new ephemeral backend port.
  page = await launch();
  await expect(page.getByRole('heading', { name: '重启后保留的桌面旅行' })).toBeVisible();
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  settings = page.getByRole('dialog', { name: '全局设置', exact: true });
  await expect(settings.getByLabel('Home名称', { exact: true })).toHaveValue('桌面端的家');
  await expect(settings.getByLabel('Home地址', { exact: true })).toHaveValue('跨平台设置保存测试');
  await expect(settings.getByLabel('默认交通出发前缓冲 / 分钟')).toHaveValue('125');
  await expect(settings.getByLabel('步行阈值 / 分钟')).toHaveValue('18');
  await expect(settings.getByRole('combobox', { name: '默认导航应用', exact: true })).toHaveValue(
    'apple',
  );
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.candidate-card').filter({ hasText: '锦市场' }).click();
  await expect(page.locator('.attachment-row')).toContainText('restart.txt');
  const attachmentFile = path.join(config, 'restart-downloaded.txt');
  await app!.evaluate(({ session }, file) => {
    session.defaultSession.on('will-download', (_event, item) => item.setSavePath(file));
  }, attachmentFile);
  await page.getByTitle('下载附件', { exact: true }).click();
  await expect
    .poll(() => readFile(attachmentFile, 'utf8').catch(() => ''), { timeout: 5000 })
    .toBe('persistent desktop attachment');

  await app!.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, directory);
  const workspace = createDemo();
  const snapshot = await page.evaluate(
    async (workspace) => window.desktop!.create(workspace, []),
    workspace,
  );
  if (!snapshot) throw new Error('创建本地工作区失败');
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await page.getByRole('button', { name: '打开本地文件夹', exact: true }).click();
  await expect(page.locator('.trip-kicker')).toContainText('本地文件夹');
  workspace.trip.name = '外部 AI 修改';
  const file = path.join(directory, 'workspace.json');
  await writeFile(file, JSON.stringify(workspace));
  await expect(page.getByRole('heading', { name: '外部 AI 修改' })).toBeVisible();
  await writeFile(file, '{ broken external file');
  await expect(page.locator('.global-banner')).toContainText('外部文件无效');
  await expect(page.getByRole('heading', { name: '外部 AI 修改' })).toBeVisible();
  await page.getByRole('button', { name: '编辑旅行设置' }).click();
  await page.getByLabel('旅行名称', { exact: true }).fill('无效文件期间的 UI 修改');
  await page.getByLabel('旅行名称', { exact: true }).blur();
  expect(await readFile(file, 'utf8')).toBe('{ broken external file');
  workspace.trip.name = '修复后重新加载';
  await writeFile(file, JSON.stringify(workspace));
  await expect(page.getByRole('heading', { name: '修复后重新加载' })).toBeVisible();
  await page.getByLabel('旅行名称', { exact: true }).fill('Electron 自动保存验证');
  await page.getByLabel('旅行名称', { exact: true }).blur();
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  expect(JSON.parse(await readFile(file, 'utf8')).trip.name).toBe('Electron 自动保存验证');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  settings = page.getByRole('dialog', { name: '全局设置', exact: true });
  await settings.getByLabel('默认交通出发前缓冲 / 分钟').fill('140');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await app!.close();
  page = await launch();
  await expect(page.getByRole('heading', { name: 'Electron 自动保存验证' })).toBeVisible();
  await expect(page.locator('.trip-kicker')).toContainText('本地文件夹');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '全局设置', exact: true })
      .getByLabel('默认交通出发前缓冲 / 分钟'),
  ).toHaveValue('140');
  await page
    .getByRole('dialog', { name: '全局设置', exact: true })
    .getByRole('button', { name: '完成', exact: true })
    .click();
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await page.getByRole('button', { name: '新建旅行', exact: true }).click();
  const newTrip = page.getByRole('dialog', { name: '新建旅行', exact: true });
  await newTrip.getByLabel('旅行名称', { exact: true }).fill('从文件夹切换后的新旅行');
  await newTrip.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByRole('heading', { name: '从文件夹切换后的新旅行' })).toBeVisible();
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  settings = page.getByRole('dialog', { name: '全局设置', exact: true });
  await settings.getByLabel('默认交通出发前缓冲 / 分钟').fill('160');
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('已保存到本机');
  await app!.close();
  page = await launch();
  await expect(page.getByRole('heading', { name: '从文件夹切换后的新旅行' })).toBeVisible();
  await expect(page.locator('.trip-kicker')).toContainText('浏览器工作区');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '全局设置', exact: true })
      .getByLabel('默认交通出发前缓冲 / 分钟'),
  ).toHaveValue('160');
  expect(JSON.parse(await readFile(file, 'utf8')).globalConfig.preBuffer).toBe(140);
  console.log(
    'Electron smoke passed: restart persistence (settings, draft, attachment), protocol API, local workspace reopen, workspace switching, watcher, invalid-file protection, recovery, autosave.',
  );
} catch (error) {
  console.error(electronErrors);
  throw error;
} finally {
  await app?.close().catch(() => {});
  xvfb?.kill();
  await rm(config, { recursive: true, force: true });
  await rm(directory, { recursive: true, force: true });
}
