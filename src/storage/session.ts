import { createDemo } from '../domain/factory';
import { parseWorkspace, uid, type Workspace, type Attachment } from '../domain/schema';
import * as browser from './browser';
import type { DiskSnapshot } from './bridge';
import {
  emptyRouteCache,
  parseRouteCache,
  type RouteCache,
  type RouteCacheEntry,
} from '../domain/routeCache';

type Snapshot = {
  workspace: Workspace;
  loading: boolean;
  saving: boolean;
  cacheSaving: boolean;
  routeCache: RouteCache;
  routeCacheEpoch: number;
  error: string | null;
  notice: string | null;
  directory: string | null;
  canUndo: boolean;
  canRedo: boolean;
};
export class WorkspaceSession {
  private state: Snapshot = {
    workspace: createDemo(),
    loading: true,
    saving: false,
    cacheSaving: false,
    routeCache: emptyRouteCache(),
    routeCacheEpoch: 0,
    error: null,
    notice: null,
    directory: null,
    canUndo: false,
    canRedo: false,
  };
  private listeners = new Set<() => void>();
  private past: Workspace[] = [];
  private future: Workspace[] = [];
  private revision = '';
  private epoch = 0;
  private queue = Promise.resolve();
  private blocked = false;
  private initialized = false;
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(patch: Partial<Snapshot>) {
    this.state = {
      ...this.state,
      ...patch,
      canUndo: !!this.past.length,
      canRedo: !!this.future.length,
    };
    this.listeners.forEach((fn) => fn());
  }
  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    window.desktop?.subscribe((event) => {
      if (!this.state.directory) return;
      if ('snapshot' in event && event.snapshot.directory !== this.state.directory) return;
      if ('error' in event) {
        this.blocked = true;
        this.epoch++;
        this.emit({ error: event.error, saving: false });
      } else {
        this.acceptDisk(event.snapshot, '已加载外部修改；撤销历史已重置。');
      }
    });
    try {
      const disk = await window.desktop?.reopen();
      if (disk) {
        this.acceptDisk(disk);
        return;
      }
      const saved = await browser.loadActive();
      const routeCache = saved ? await browser.loadBrowserRouteCache(saved.id) : emptyRouteCache();
      this.emit({
        workspace: saved ?? this.state.workspace,
        routeCache,
        routeCacheEpoch: this.state.routeCacheEpoch + 1,
        loading: false,
      });
      if (!saved) this.persist();
    } catch (e) {
      this.emit({ loading: false, error: `加载失败：${String(e)}` });
    }
  }
  private acceptDisk(snapshot: DiskSnapshot, notice: string | null = null) {
    this.epoch++;
    this.revision = snapshot.revision;
    this.blocked = false;
    this.past = [];
    this.future = [];
    this.emit({
      workspace: parseWorkspace(snapshot.workspace),
      directory: snapshot.directory,
      loading: false,
      error: null,
      notice,
      saving: false,
      cacheSaving: false,
      routeCache: parseRouteCache(snapshot.routeCache),
      routeCacheEpoch: this.state.routeCacheEpoch + 1,
    });
  }
  edit(mutator: (draft: Workspace) => void) {
    const before = this.state.workspace,
      after = structuredClone(before);
    mutator(after);
    const parsed = parseWorkspace(after);
    if (JSON.stringify(before) === JSON.stringify(parsed)) return;
    this.past.push(before);
    if (this.past.length > 150) this.past.shift();
    this.future = [];
    this.emit({ workspace: parsed, notice: null });
    this.persist();
  }
  undo() {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state.workspace);
    this.emit({ workspace: previous });
    this.persist();
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.workspace);
    this.emit({ workspace: next });
    this.persist();
  }
  private persist() {
    if (this.blocked) return;
    const workspace = this.state.workspace,
      epoch = this.epoch,
      desktop = this.state.directory ? window.desktop : undefined;
    this.emit({ saving: true });
    this.queue = this.queue.then(async () => {
      if (epoch !== this.epoch || this.blocked) return;
      try {
        if (desktop) {
          const result = await desktop.save(workspace, this.revision);
          if (epoch !== this.epoch) return;
          this.revision = result.revision;
        } else await browser.saveBrowser(workspace);
        if (this.state.workspace === workspace) this.emit({ saving: false, error: null });
      } catch (error) {
        this.blocked = Boolean(desktop);
        this.emit({ saving: false, error: `自动保存失败：${String(error)}` });
      }
    });
  }
  async flush() {
    await this.queue;
  }
  recordRoutes(epoch: number, entries: RouteCacheEntry[]) {
    if (epoch !== this.state.routeCacheEpoch || !entries.length) return;
    const routeCache = parseRouteCache({
      version: 1,
      entries: [...this.state.routeCache.entries, ...entries],
    });
    this.emit({ routeCache });
    this.persistRouteCache();
  }
  clearRouteCache() {
    this.emit({ routeCache: emptyRouteCache(), routeCacheEpoch: this.state.routeCacheEpoch + 1 });
    this.persistRouteCache();
  }
  private persistRouteCache() {
    const { routeCache, routeCacheEpoch, workspace, directory } = this.state;
    const workspaceEpoch = this.epoch;
    this.emit({ cacheSaving: true });
    this.queue = this.queue.then(async () => {
      // Finish queued writes before switching workspaces, even after new queries are paused.
      if (workspaceEpoch !== this.epoch) return;
      try {
        if (directory && window.desktop) await window.desktop.saveRouteCache(routeCache, directory);
        else await browser.saveBrowserRouteCache(workspace.id, routeCache);
        if (routeCacheEpoch === this.state.routeCacheEpoch && routeCache === this.state.routeCache)
          this.emit({ cacheSaving: false });
      } catch (error) {
        if (routeCacheEpoch === this.state.routeCacheEpoch)
          this.emit({ cacheSaving: false, error: `路线缓存保存失败：${String(error)}` });
      }
    });
  }
  private pauseRouteRequests() {
    this.emit({
      loading: true,
      cacheSaving: false,
      routeCacheEpoch: this.state.routeCacheEpoch + 1,
    });
  }
  async replaceBrowser(workspace: Workspace, blobs = new Map<string, Blob>(), cache?: RouteCache) {
    this.pauseRouteRequests();
    try {
      await this.flush();
      const routeCache =
        cache === undefined
          ? await browser.loadBrowserRouteCache(workspace.id)
          : parseRouteCache(cache);
      for (const [path, blob] of blobs) await browser.putBlob(workspace.id, path, blob);
      await browser.saveBrowser(workspace);
      await browser.saveBrowserRouteCache(workspace.id, routeCache);
      // Desktop must remember this switch too, or a previous disk workspace wins on the next launch.
      await window.desktop?.useBrowser();
      this.epoch++;
      this.blocked = false;
      this.past = [];
      this.future = [];
      this.emit({
        workspace,
        routeCache,
        routeCacheEpoch: this.state.routeCacheEpoch + 1,
        directory: null,
        error: null,
        notice: null,
        saving: false,
        cacheSaving: false,
      });
    } finally {
      this.emit({ loading: false });
    }
  }
  async openDesktop() {
    this.pauseRouteRequests();
    try {
      await this.flush();
      const snapshot = await window.desktop?.open();
      if (snapshot) this.acceptDisk(snapshot);
    } finally {
      this.emit({ loading: false });
    }
  }
  async saveAsDesktop() {
    this.pauseRouteRequests();
    try {
      await this.flush();
      const attachments = [];
      for (const a of this.state.workspace.attachments)
        attachments.push({
          path: a.path,
          data: Array.from(new Uint8Array(await (await this.readAttachment(a.path)).arrayBuffer())),
        });
      const snapshot = await window.desktop?.create(
        this.state.workspace,
        attachments,
        this.state.routeCache,
      );
      if (snapshot) this.acceptDisk(snapshot);
    } finally {
      this.emit({ loading: false });
    }
  }
  async addAttachment(file: File): Promise<Attachment> {
    const id = uid();
    const attachment = {
      id,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      path: `attachments/${id}`,
    };
    if (this.state.directory && window.desktop)
      await window.desktop.putAttachment(
        attachment.path,
        Array.from(new Uint8Array(await file.arrayBuffer())),
      );
    else await browser.putBlob(this.state.workspace.id, attachment.path, file);
    return attachment;
  }
  readAttachment = async (path: string): Promise<Blob> => {
    if (this.state.directory && window.desktop)
      return new Blob([new Uint8Array(await window.desktop.getAttachment(path))]);
    const blob = await browser.getBlob(this.state.workspace.id, path);
    if (!blob) throw new Error(`找不到附件 ${path}`);
    return blob;
  };
  clearNotice() {
    this.emit({ notice: null });
  }
}
export const session = new WorkspaceSession();
