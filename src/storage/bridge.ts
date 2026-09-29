import type { Workspace } from '../domain/schema';
import type { RouteCache } from '../domain/routeCache';
export type DiskSnapshot = {
  workspace: Workspace;
  revision: string;
  directory: string;
  routeCache: RouteCache;
};
export type DiskEvent = { snapshot: DiskSnapshot } | { error: string };
export interface DesktopBridge {
  open(): Promise<DiskSnapshot | null>;
  reopen(): Promise<DiskSnapshot | null>;
  useBrowser(): Promise<void>;
  create(
    workspace: Workspace,
    attachments: { path: string; data: number[] }[],
    routeCache?: RouteCache,
  ): Promise<DiskSnapshot | null>;
  save(workspace: Workspace, revision: string): Promise<DiskSnapshot>;
  saveRouteCache(routeCache: RouteCache, directory: string): Promise<void>;
  putAttachment(path: string, data: number[]): Promise<void>;
  getAttachment(path: string): Promise<number[]>;
  subscribe(callback: (event: DiskEvent) => void): () => void;
}
declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
