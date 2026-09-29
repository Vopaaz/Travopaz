import JSZip from 'jszip';
import { DateTime } from 'luxon';
import type { Block, Metadata, Workspace } from '../domain/schema';
import { blockTitle, bounds } from '../domain/operations';
import { formatTime, daysBetween, ms } from '../domain/time';
import { navigationUrl, modeLabel } from '../domain/routing';
import type { Derived } from '../domain/derive';
import { edgeTiming } from '../domain/edgeTiming';

function itineraryDays(w: Workspace, zone: string) {
  const spans = w.blocks.map(bounds).filter((b): b is { start: number; end: number } => b !== null);
  const start = Math.min(ms(w.trip.displayStart), ...spans.flatMap((b) => [b.start, b.end]));
  const end = Math.max(ms(w.trip.displayEnd), ...spans.flatMap((b) => [b.start, b.end]));
  return daysBetween(
    { instant: new Date(start).toISOString(), timezone: zone },
    { instant: new Date(end).toISOString(), timezone: zone },
    zone,
  );
}

function blockContext(w: Workspace, b: Block, zone: string): unknown {
  const span = bounds(b);
  const placement = span
    ? {
        start: DateTime.fromMillis(span.start).setZone(zone).toISO(),
        end: DateTime.fromMillis(span.end).setZone(zone).toISO(),
      }
    : null;
  if (b.kind === 'option')
    return {
      id: b.id,
      type: 'option',
      title: b.title,
      placement,
      metadata: b.metadata,
      semantics: '所有方案均保留并参与检查；没有默认或选定方案。外框仅由内部事件推导。',
      variants: b.variants.map((v) => ({
        id: v.id,
        title: v.title,
        events: v.blocks.map((child) => blockContext(w, child, zone)),
      })),
    };
  return {
    id: b.id,
    type: b.kind,
    title: blockTitle(w, b),
    placement,
    originalPlacement: { start: b.start, end: b.end },
    ...(b.kind === 'candidate'
      ? { definition: w.candidates.find((c) => c.id === b.candidateId) }
      : { metadata: b.metadata, location: '由当时有效酒店状态推导，详见状态与派生信息' }),
  };
}
export function aiContext(w: Workspace, d: Derived, zone: string) {
  return {
    format: 'Travopaz itinerary context v1',
    exportedAt: new Date().toISOString(),
    purpose:
      '用于旅行执行辅助的只读背景；不是应用恢复文件。不要假定尚未定案的 Option 已做决定；unknown 耗时不能视为 0。',
    trip: w.trip,
    displayTimezone: zone,
    dailyPlan: itineraryDays(w, zone).map((day) => ({
      date: day.toISODate(),
      timezone: zone,
      events: w.blocks
        .filter((b) => {
          const span = bounds(b);
          return (
            span &&
            Math.min(span.start, span.end) < day.plus({ days: 1 }).toMillis() &&
            Math.max(span.start, span.end) >= day.toMillis()
          );
        })
        .sort((a, b) => bounds(a)!.start - bounds(b)!.start)
        .map((b) => blockContext(w, b, zone)),
    })),
    allTimelineItems: w.blocks.map((b) => blockContext(w, b, zone)),
    candidateLibrary: w.candidates,
    hotelAndRentalReservations: w.statuses,
    activeStatusIntervals: d.statuses,
    unknownStatuses: d.unknownStatuses,
    travelEdges: d.edges,
    derivedOvernightsAndEndpoints: d.blocks,
    consistencyIssues: d.issues,
    attachments: w.attachments.map((a) => ({ ...a, exportedName: `${a.id}-${a.name}` })),
    timeEncoding:
      'canonical instant 为绝对 ISO 时间，timezone 为原始输入时区；派生数值时间为 UTC Unix 毫秒。dailyPlan 包含 displayTimezone 的 ISO offset。',
  };
}
export function aiReadme(w: Workspace, d: Derived, zone: string) {
  return `# ${w.trip.name} — 旅行辅助 AI 背景\n\n请同时读取 itinerary-context.json；核心信息为明文，不需要解压。\n\n显示时区：${zone}\n主时区：${w.trip.primaryTimezone}\n起点：${w.trip.startLocation.name} ${w.trip.startLocation.address}\n终点：${w.trip.endLocation.name} ${w.trip.endLocation.address}\n\n当前 ${d.issues.filter((i) => i.severity === 'error').length} 项冲突、${d.issues.filter((i) => i.severity === 'warning').length} 项待确认。不要把未知路线耗时当作零。\n\nOption 的每个 Variant 都是尚保留的方案，没有隐含选中项。用户通过删除方案决定采用哪一个。请保留不确定性。\n\nJSON 的 dailyPlan 按日期列出完整安排；allTimelineItems 保留跨日项目和 Option 结构；activeStatusIntervals / travelEdges / derivedOvernightsAndEndpoints 是只读推导；酒店、租车与预订资料在 hotelAndRentalReservations。附件通过 metadata.attachmentIds 关联到 attachments；单独下载的附件文件名为 exportedName。\n`;
}
const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export async function humanItinerary(
  w: Workspace,
  d: Derived,
  zone: string,
  read: (path: string) => Promise<Blob>,
) {
  const zip = new JSZip();
  for (const a of w.attachments) zip.file(a.path, await (await read(a.path)).arrayBuffer());
  const metadata = (m: Metadata) =>
    `${m.reservation ? `<p><b>预订：</b>${escape(m.reservation)}</p>` : ''}${m.notes ? `<p class="notes">${escape(m.notes)}</p>` : ''}${m.links
      .filter((l) => /^https?:\/\//i.test(l.url))
      .map((l) => `<a href="${escape(l.url)}">${escape(l.label || l.url)}</a>`)
      .join(' · ')}${m.attachmentIds
      .map((id) => {
        const a = w.attachments.find((a) => a.id === id);
        return a
          ? `<p>附件：<a href="${escape(a.path)}" download="${escape(a.name)}">${escape(a.name)}</a></p>`
          : '<p>附件缺失</p>';
      })
      .join('')}`;
  const event = (b: Block): string => {
    const span = bounds(b),
      c = b.kind === 'candidate' ? w.candidates.find((c) => c.id === b.candidateId) : undefined;
    const times = span
      ? `${formatTime(span.start, zone, 'MM/dd HH:mm')} → ${formatTime(span.end, zone, 'MM/dd HH:mm')}`
      : '尚无时间';
    const issues = d.issues.filter((i) => i.targetIds.includes(b.id));
    const locations =
      c?.kind === 'transport'
        ? [c.origin, c.destination]
        : c
          ? [c.location]
          : b.kind === 'hotelRest'
            ? (d.restLocations[b.id] ?? [])
            : [];
    return `<article><div class="time">${escape(times)} · ${escape(zone)}</div><h3>${escape(blockTitle(w, b))}</h3>${locations.map((l) => `<p>${escape(l.name)} · ${escape(l.address)} <a href="${escape(navigationUrl(l, 'google'))}">Google Maps</a> / <a href="${escape(navigationUrl(l, 'apple'))}">Apple Maps</a></p>`).join('')}${c?.kind === 'transport' ? `<p>${escape(c.operator)} ${escape(c.serviceNumber)} · 时刻表 ${formatTime(c.departure, zone, 'MM/dd HH:mm')}–${formatTime(c.arrival, zone, 'MM/dd HH:mm')} · 提前 ${c.preBuffer} 分 / 到达后 ${c.postBuffer} 分</p>` : ''}${metadata(c?.metadata ?? (b.kind !== 'candidate' ? b.metadata : { notes: '', reservation: '', links: [], tags: [], attachmentIds: [] }))}${b.kind === 'option' ? `<p class="warning">保留 ${b.variants.length} 个方案，均参与检查。</p>${b.variants.map((v) => `<section class="variant"><h4>${escape(v.title)}</h4>${v.blocks.map(event).join('')}</section>`).join('')}` : ''}${issues.map((i) => `<p class="warning">${escape(i.message)}</p>`).join('')}</article>`;
  };
  const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(w.trip.name)}</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#23362f;background:#f6f5ef;max-width:900px;margin:40px auto;padding:0 24px}h1{font-size:34px}h2{border-bottom:1px solid #bbc9bd;padding-top:24px}h3{margin:5px 0}article{background:white;border:1px solid #dedfd4;border-radius:12px;padding:18px;margin:12px 0;break-inside:avoid}.time{color:#617566;font-size:13px}.warning{color:#ad482f;background:#fcf0e7;padding:8px;border-radius:5px}.notes{white-space:pre-wrap}.variant{border-left:3px solid #b4a1cd;padding-left:15px}a{color:#267963}small{color:#627467}@media print{body{margin:0;background:white}article{border-color:#ccc}}</style><h1>${escape(w.trip.name)}</h1><p>${escape(zone)} · ${formatTime(w.trip.displayStart, zone, 'yyyy/MM/dd')}—${formatTime(w.trip.displayEnd, zone, 'yyyy/MM/dd')}</p><p>起点：${escape(w.trip.startLocation.name)} ${escape(w.trip.startLocation.address)}<br>终点：${escape(w.trip.endLocation.name)} ${escape(w.trip.endLocation.address)}</p><p>导出时 ${d.issues.length} 项待处理检查结果。所有时间都使用 ${escape(zone)}。</p>${itineraryDays(
    w,
    zone,
  )
    .map(
      (day) =>
        `<h2>${day.setLocale('zh-CN').toFormat('M 月 d 日 · cccc')}</h2>${w.blocks
          .filter((b) => {
            const span = bounds(b);
            return (
              span &&
              Math.min(span.start, span.end) < day.plus({ days: 1 }).toMillis() &&
              Math.max(span.start, span.end) >= day.toMillis()
            );
          })
          .sort((a, b) => bounds(a)!.start - bounds(b)!.start)
          .map(event)
          .join('')}`,
    )
    .join('')}${
    w.blocks.some((b) => !bounds(b))
      ? `<h2>尚无具体时间的方案</h2>${w.blocks
          .filter((b) => !bounds(b))
          .map(event)
          .join('')}`
      : ''
  }<h2>酒店与租车</h2>${w.statuses
    .map(
      (s) =>
        `<article><h3>${escape(s.title)}</h3><p>${escape(s.location.address)}</p>${metadata(s.metadata)}${d.statuses
          .filter((i) => i.status.id === s.id)
          .map(
            (i) =>
              `<p>${formatTime(i.start, zone, 'MM/dd HH:mm')}–${formatTime(i.end, zone, 'MM/dd HH:mm')}${i.context ? ` · ${escape(i.context)}` : ''}</p>`,
          )
          .join('')}</article>`,
    )
    .join(
      '',
    )}<h2>交通路线与出发／住宿提示</h2>${d.blocks.map((b) => `<p>${escape(b.title)} · ${escape(b.location.name)}：${b.start === null ? '时间未知' : formatTime(b.start, zone, 'MM/dd HH:mm')}${b.kind === 'overnight' ? ` → ${b.end === null ? '未知' : formatTime(b.end, zone, 'MM/dd HH:mm')}` : ''}</p>`).join('')}${d.edges.map((e) => `<p>${escape(e.fromTitle)} → ${escape(e.toTitle)}：${escape(modeLabel[e.mode])}，总耗时 ${edgeTiming(e).requiredText}${e.context ? ` · ${escape(e.context)}` : ''}</p>`).join('')}<h2>一致性检查</h2>${d.issues.map((i) => `<p class="warning">[${escape(i.severity)}] ${escape(i.message)} ${escape(i.contexts.join('；'))}</p>`).join('')}<small>由 Travopaz 导出。此文档可独立阅读，可使用浏览器打印为 PDF；附件位于同目录 attachments 内。</small></html>`;
  zip.file('行程.html', html);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
