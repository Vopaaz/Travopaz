import { createDemo } from '../domain/factory';
import { parseWorkspace, uid, type Workspace, type Attachment } from '../domain/schema';
import * as browser from './browser';
import type { DiskSnapshot } from './bridge';

type Snapshot = {
  workspace: Workspace;
  loading: boolean;
  saving: boolean;
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
      this.emit({ workspace: saved ?? this.state.workspace, loading: false });
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
  async replaceBrowser(workspace: Workspace, blobs = new Map<string, Blob>()) {
    await this.flush();
    for (const [path, blob] of blobs) await browser.putBlob(workspace.id, path, blob);
    await browser.saveBrowser(workspace);
    this.epoch++;
    this.blocked = false;
    this.past = [];
    this.future = [];
    this.emit({ workspace, directory: null, error: null, notice: null, saving: false });
  }
  async openDesktop() {
    await this.flush();
    const snapshot = await window.desktop?.open();
    if (snapshot) this.acceptDisk(snapshot);
  }
  async saveAsDesktop() {
    await this.flush();
    const attachments = [];
    for (const a of this.state.workspace.attachments)
      attachments.push({
        path: a.path,
        data: Array.from(new Uint8Array(await (await this.readAttachment(a.path)).arrayBuffer())),
      });
    const snapshot = await window.desktop?.create(this.state.workspace, attachments);
    if (snapshot) this.acceptDisk(snapshot);
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
