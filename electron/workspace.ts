import { watch, type FSWatcher } from 'node:fs';
import { readFile, writeFile, rename, mkdir, realpath, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { migrateWorkspace, parseWorkspace, type Workspace } from '../src/domain/schema';
import type { DiskEvent, DiskSnapshot } from '../src/storage/bridge';
import {
  emptyRouteCache,
  parseRouteCache,
  ROUTE_CACHE_FILE,
  type RouteCache,
} from '../src/domain/routeCache';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class DiskWorkspace {
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private lastRevision = '';
  private invalid = false;
  constructor(
    readonly directory: string,
    private onEvent: (event: DiskEvent) => void = () => {},
  ) {}
  private file() {
    return path.join(this.directory, 'workspace.json');
  }
  async load(): Promise<DiskSnapshot> {
    const text = await readFile(this.file(), 'utf8');
    const workspace = migrateWorkspace(JSON.parse(text));
    this.lastRevision = hash(text);
    this.invalid = false;
    return {
      workspace,
      revision: this.lastRevision,
      directory: this.directory,
      routeCache: await this.loadRouteCache(),
    };
  }
  async loadRouteCache(): Promise<RouteCache> {
    try {
      return parseRouteCache(
        JSON.parse(await readFile(path.join(this.directory, ROUTE_CACHE_FILE), 'utf8')),
      );
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
        return emptyRouteCache();
      throw error;
    }
  }
  async saveRouteCache(cache: RouteCache) {
    const temp = path.join(this.directory, `.route-cache-${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(parseRouteCache(cache), null, 2) + '\n', { flag: 'wx' });
      await rename(temp, path.join(this.directory, ROUTE_CACHE_FILE));
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async initialize(workspace: Workspace, routeCache = emptyRouteCache()) {
    await mkdir(this.directory, { recursive: true });
    await mkdir(path.join(this.directory, 'attachments'), { recursive: true });
    await writeFile(this.file(), JSON.stringify(parseWorkspace(workspace), null, 2) + '\n', {
      flag: 'wx',
    });
    await this.saveRouteCache(routeCache);
    return this.load();
  }
  async save(workspace: Workspace, revision: string): Promise<DiskSnapshot> {
    parseWorkspace(workspace);
    if (this.invalid) throw new Error('外部文件无效，已暂停保存。请先修复 workspace.json。');
    const current = await readFile(this.file(), 'utf8');
    try {
      migrateWorkspace(JSON.parse(current));
    } catch (error) {
      this.invalid = true;
      this.onEvent({ error: String(error) });
      throw new Error('外部文件解析失败，已保留原文件并暂停保存。');
    }
    if (hash(current) !== revision)
      throw new Error('外部文件已经变化，已停止保存以避免覆盖。请重新打开工作区。');
    const text = JSON.stringify(workspace, null, 2) + '\n';
    const temp = path.join(this.directory, `.workspace-${crypto.randomUUID()}.tmp`);
    await writeFile(temp, text, { flag: 'wx' });
    if (hash(await readFile(this.file(), 'utf8')) !== revision) {
      await unlink(temp);
      throw new Error('保存过程中检测到外部修改，未覆盖文件。');
    }
    await rename(temp, this.file());
    this.lastRevision = hash(text);
    return {
      workspace,
      revision: this.lastRevision,
      directory: this.directory,
      routeCache: await this.loadRouteCache(),
    };
  }
  startWatching() {
    this.watcher = watch(this.directory, (_event, name) => {
      if (name !== 'workspace.json') return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.reloadExternal();
      }, 150);
    });
  }
  async reloadExternal() {
    try {
      const raw = await readFile(this.file(), 'utf8');
      if (hash(raw) === this.lastRevision && !this.invalid) return;
      this.onEvent({ snapshot: await this.load() });
    } catch (error) {
      this.invalid = true;
      this.onEvent({
        error: `外部文件无效：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  close() {
    this.watcher?.close();
    clearTimeout(this.timer);
  }
  private async attachmentPath(relative: string, create: boolean) {
    if (!/^attachments\/[a-zA-Z0-9_-]+$/.test(relative)) throw new Error('无效附件路径');
    const root = await realpath(this.directory);
    if (create) await mkdir(path.join(root, 'attachments'), { recursive: true });
    const attachmentRoot = await realpath(path.join(root, 'attachments'));
    if (attachmentRoot !== path.join(root, 'attachments'))
      throw new Error('附件目录不能指向工作区外部');
    const target = path.join(root, relative);
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('附件不能是符号链接');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return target;
  }
  async putAttachment(relative: string, bytes: Uint8Array) {
    await writeFile(await this.attachmentPath(relative, true), bytes);
  }
  async getAttachment(relative: string) {
    return readFile(await this.attachmentPath(relative, false));
  }
}
