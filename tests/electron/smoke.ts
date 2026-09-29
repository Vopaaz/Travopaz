import { _electron as electron, expect } from '@playwright/test';
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
  Object.entries({ ...process.env, XDG_CONFIG_HOME: config }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
delete electronEnv.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--no-sandbox'], env: electronEnv });
try {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '京都 · 慢游三日' })).toBeVisible();
  await app.evaluate(({ dialog }, directory) => {
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
  console.log(
    'Electron smoke passed: local workspace, watcher, invalid-file protection, recovery, autosave.',
  );
} finally {
  await app.close();
  xvfb?.kill();
  await rm(config, { recursive: true, force: true });
  await rm(directory, { recursive: true, force: true });
}
