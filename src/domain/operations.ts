import { ms, shiftTime } from './time';
import {
  uid,
  emptyMetadata,
  type Workspace,
  type Block,
  type ConcreteBlock,
  type OptionBlock,
} from './schema';

export function bounds(block: Block): { start: number; end: number } | null {
  if (block.kind !== 'option') return { start: ms(block.start), end: ms(block.end) };
  const blocks = block.variants.flatMap((v) => v.blocks);
  if (!blocks.length) return null;
  return {
    start: Math.min(...blocks.map((b) => ms(b.start))),
    end: Math.max(...blocks.map((b) => ms(b.end))),
  };
}
export function allConcrete(w: Workspace): ConcreteBlock[] {
  return w.blocks.flatMap((b) => (b.kind === 'option' ? b.variants.flatMap((v) => v.blocks) : [b]));
}
export function findBlock(w: Workspace, id: string): Block | undefined {
  return w.blocks.find((b) => b.id === id) ?? allConcrete(w).find((b) => b.id === id);
}
export function blockTitle(w: Workspace, b: Block): string {
  return b.kind === 'candidate'
    ? w.candidates.find((c) => c.id === b.candidateId)?.title || '未命名项目'
    : b.title || '未命名项目';
}
export function blockKind(w: Workspace, b: Block): string {
  return b.kind === 'candidate'
    ? (w.candidates.find((c) => c.id === b.candidateId)?.kind ?? 'activity')
    : b.kind;
}
export function moveBlocks(w: Workspace, ids: string[], minutes: number) {
  const selected = new Set(ids);
  const move = (b: ConcreteBlock) => {
    b.start = shiftTime(b.start, minutes);
    b.end = shiftTime(b.end, minutes);
  };
  for (const b of w.blocks) {
    if (b.kind === 'option')
      for (const v of b.variants)
        for (const child of v.blocks) {
          if (selected.has(b.id) || selected.has(child.id)) move(child);
        }
    else if (selected.has(b.id)) move(b);
  }
}
export function removeBlocks(w: Workspace, ids: string[]) {
  const selected = new Set(ids);
  w.blocks = w.blocks.filter((b) => !selected.has(b.id));
  for (const b of w.blocks)
    if (b.kind === 'option')
      for (const v of b.variants) v.blocks = v.blocks.filter((c) => !selected.has(c.id));
}
export function wrapOption(w: Workspace, ids: string[]): OptionBlock {
  const blocks = w.blocks.filter(
    (b): b is ConcreteBlock => b.kind !== 'option' && ids.includes(b.id),
  );
  w.blocks = w.blocks.filter((b) => !blocks.includes(b as ConcreteBlock));
  const option: OptionBlock = {
    id: uid(),
    kind: 'option',
    title: '待决定的安排',
    metadata: emptyMetadata(),
    variants: [{ id: uid(), title: '方案 A', blocks }],
  };
  w.blocks.push(option);
  return option;
}
export function unwrapOption(w: Workspace, id: string) {
  const option = w.blocks.find((b): b is OptionBlock => b.id === id && b.kind === 'option');
  if (!option || option.variants.length !== 1) return;
  w.blocks = w.blocks.flatMap((b) => (b.id === id ? option.variants[0].blocks : [b]));
}
