import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { createDemo } from '../../src/domain/factory';
import { derive } from '../../src/domain/derive';
import { emptyMetadata, uid } from '../../src/domain/schema';
import { shiftTime } from '../../src/domain/time';
import { aiContext, humanItinerary } from '../../src/storage/exports';
import { routesWorkspace } from '../fixtures/routes';

it('自定义 buffer 同步到 AI 和人类行程的总耗时', async () => {
  const w = routesWorkspace();
  w.edgeOverheadOverrides['A>B'] = 12;
  const d = derive(w, () => ({ status: 'ok', minutes: 8, distanceMeters: 800, source: 'test' }));
  const context = aiContext(w, d, w.trip.primaryTimezone);
  expect(context.travelEdges.find((e) => e.key === 'A>B')).toMatchObject({
    overhead: 12,
    overheadOverridden: true,
    effectiveMinutes: 20,
  });
  const bundle = await humanItinerary(w, d, w.trip.primaryTimezone, async () => new Blob());
  const zip = await JSZip.loadAsync(await bundle.arrayBuffer());
  expect(await zip.file('行程.html')!.async('string')).toContain('总耗时 20 分钟');
});

it('最终导出包含显示范围之外的用户项目、空 Option、转义内容和独立附件', async () => {
  const w = createDemo(),
    attachmentId = uid();
  w.attachments.push({
    id: attachmentId,
    path: `attachments/${attachmentId}`,
    name: 'ticket.txt',
    mime: 'text/plain',
    size: 6,
  });
  const b = {
    id: uid(),
    kind: 'hotelRest' as const,
    title: '<script>不执行</script>范围外',
    start: shiftTime(w.trip.displayEnd, 1500),
    end: shiftTime(w.trip.displayEnd, 1560),
    metadata: { ...emptyMetadata(), attachmentIds: [attachmentId] },
  };
  w.blocks.push(b);
  w.blocks.push({
    id: uid(),
    kind: 'option',
    title: '待安排的空 Option',
    metadata: emptyMetadata(),
    variants: [],
  });
  const d = derive(w),
    context = aiContext(w, d, w.trip.primaryTimezone);
  expect(JSON.stringify(context.dailyPlan)).toContain('范围外');
  const exported = await humanItinerary(
    w,
    d,
    w.trip.primaryTimezone,
    async () => new Blob(['ticket']),
  );
  const zip = await JSZip.loadAsync(await exported.arrayBuffer()),
    html = await zip.file('行程.html')!.async('string');
  expect(html).toContain('&lt;script&gt;不执行&lt;/script&gt;范围外');
  expect(html).not.toContain('<script>不执行');
  expect(html).toContain('待安排的空 Option');
  expect(await zip.file(`attachments/${attachmentId}`)!.async('string')).toBe('ticket');
});
