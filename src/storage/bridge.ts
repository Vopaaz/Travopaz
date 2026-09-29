import type { Workspace } from '../domain/schema';
export type DiskSnapshot = { workspace: Workspace; revision: string; directory: string };
export type DiskEvent = { snapshot: DiskSnapshot } | { error: string };
export interface DesktopBridge {
  open(): Promise<DiskSnapshot | null>;
  reopen(): Promise<DiskSnapshot | null>;
  create(
    workspace: Workspace,
    attachments: { path: string; data: number[] }[],
  ): Promise<DiskSnapshot | null>;
  save(workspace: Workspace, revision: string): Promise<DiskSnapshot>;
  putAttachment(path: string, data: number[]): Promise<void>;
  getAttachment(path: string): Promise<number[]>;
  subscribe(callback: (event: DiskEvent) => void): () => void;
}
declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
