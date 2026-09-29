import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DiskWorkspace } from '../../electron/workspace';
import { createWorkspace } from '../../src/domain/factory';
import type { DiskEvent } from '../../src/storage/bridge';
const dirs: string[] = [];
const directory = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'travopaz-test-'));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
describe('文件工作区', () => {
  it('外部无效文件保留原样，旧 UI 不能写回，修复后可恢复', async () => {
    const dir = await directory(),
      events: DiskEvent[] = [],
      store = new DiskWorkspace(dir, (e) => events.push(e));
    const first = await store.initialize(createWorkspace());
    const file = path.join(dir, 'workspace.json');
    await writeFile(file, '{ broken');
    await store.reloadExternal();
    expect(events[0]).toHaveProperty('error');
    await expect(store.save(first.workspace, first.revision)).rejects.toThrow('暂停保存');
    expect(await readFile(file, 'utf8')).toBe('{ broken');
    first.workspace.trip.name = '外部修改';
    await writeFile(file, JSON.stringify(first.workspace));
    await store.reloadExternal();
    expect(events[1]).toHaveProperty('snapshot.workspace.trip.name', '外部修改');
    const reloaded = await store.load();
    reloaded.workspace.trip.name = 'UI 修改';
    await store.save(reloaded.workspace, reloaded.revision);
    expect(JSON.parse(await readFile(file, 'utf8')).trip.name).toBe('UI 修改');
  });
  it('在 watcher 尚未触发时也检测外部版本变化', async () => {
    const dir = await directory(),
      store = new DiskWorkspace(dir),
      first = await store.initialize(createWorkspace());
    await writeFile(
      path.join(dir, 'workspace.json'),
      JSON.stringify({ ...first.workspace, trip: { ...first.workspace.trip, name: '更新' } }),
    );
    await expect(store.save(first.workspace, first.revision)).rejects.toThrow('已经变化');
  });
  it('附件复制后独立存在，禁止相对路径逃逸与目录 symlink', async () => {
    const dir = await directory(),
      store = new DiskWorkspace(dir);
    await store.initialize(createWorkspace());
    await store.putAttachment('attachments/test-id', new TextEncoder().encode('ticket'));
    expect((await store.getAttachment('attachments/test-id')).toString()).toBe('ticket');
    await expect(store.putAttachment('../external', new Uint8Array())).rejects.toThrow();
    await rm(path.join(dir, 'attachments'), { recursive: true });
    await symlink(await directory(), path.join(dir, 'attachments'));
    await expect(store.putAttachment('attachments/test-id', new Uint8Array())).rejects.toThrow(
      '不能指向',
    );
  });
  it('真实 watcher 监听原子替换，重新加载有效文件', async () => {
    const dir = await directory();
    let resolve: (event: DiskEvent) => void = () => {};
    const event = new Promise<DiskEvent>((r) => {
      resolve = r;
    });
    const store = new DiskWorkspace(dir, resolve);
    const first = await store.initialize(createWorkspace());
    store.startWatching();
    first.workspace.trip.name = 'watcher 更新';
    await writeFile(path.join(dir, 'workspace.json'), JSON.stringify(first.workspace));
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('watcher timeout')), 2000),
    );
    try {
      expect(await Promise.race([event, timeout])).toHaveProperty(
        'snapshot.workspace.trip.name',
        'watcher 更新',
      );
    } finally {
      store.close();
    }
  });
});
