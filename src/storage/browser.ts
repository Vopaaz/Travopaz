import { get, set } from 'idb-keyval';
import JSZip from 'jszip';
import { migrateWorkspace, type Workspace } from '../domain/schema';
export async function loadActive(): Promise<Workspace | null> {
  const id = await get<string>('active');
  if (!id) return null;
  const data = await get<Workspace>(`workspace:${id}`);
  return data ? migrateWorkspace(data) : null;
}
export async function saveBrowser(w: Workspace) {
  await set(`workspace:${w.id}`, w);
  const recent = (await get<{ id: string; name: string }[]>('recent')) ?? [];
  await set('recent', [{ id: w.id, name: w.trip.name }, ...recent.filter((r) => r.id !== w.id)]);
  await set('active', w.id);
}
export const recentBrowser = async () =>
  (await get<{ id: string; name: string }[]>('recent')) ?? [];
export async function getBrowser(id: string) {
  return migrateWorkspace(await get(`workspace:${id}`));
}
export const putBlob = (workspaceId: string, path: string, blob: Blob) =>
  set(`blob:${workspaceId}:${path}`, blob);
export const getBlob = (workspaceId: string, path: string) =>
  get<Blob>(`blob:${workspaceId}:${path}`);
export async function makeBundle(
  w: Workspace,
  read: (path: string) => Promise<Blob>,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file('workspace.json', JSON.stringify(w, null, 2));
  for (const attachment of w.attachments)
    zip.file(attachment.path, await (await read(attachment.path)).arrayBuffer());
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
export async function readBundle(
  file: File,
): Promise<{ workspace: Workspace; blobs: Map<string, Blob> }> {
  if (file.name.toLowerCase().endsWith('.json')) {
    const workspace = migrateWorkspace(JSON.parse(await file.text()));
    if (workspace.attachments.length)
      throw new Error('该 JSON 引用了附件，请导入包含附件的完整 Workspace ZIP。');
    return { workspace, blobs: new Map() };
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const canonical = zip.file('workspace.json');
  if (!canonical) throw new Error('压缩包缺少 workspace.json。');
  const workspace = migrateWorkspace(JSON.parse(await canonical.async('string')));
  const blobs = new Map<string, Blob>();
  let total = 0;
  for (const attachment of workspace.attachments) {
    const entry = zip.file(attachment.path);
    if (!entry) throw new Error(`压缩包缺少附件：${attachment.name}`);
    if (attachment.size > 250 * 1024 * 1024 || total + attachment.size > 500 * 1024 * 1024)
      throw new Error('附件超过单文件 250 MB / 工作区 500 MB 导入上限。');
    const bytes = await entry.async('arraybuffer');
    if (bytes.byteLength !== attachment.size) throw new Error(`附件大小不一致：${attachment.name}`);
    total += bytes.byteLength;
    blobs.set(attachment.path, new Blob([bytes], { type: attachment.mime }));
  }
  return { workspace, blobs };
}
export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
