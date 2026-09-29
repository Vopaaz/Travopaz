import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';

const id = z.string().min(1);
const zone = z.string().refine((v) => IANAZone.isValidZone(v) || v === 'UTC', '无效 IANA 时区');
export const timeSchema = z
  .object({
    instant: z
      .string()
      .refine(
        (v) => /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && DateTime.fromISO(v).isValid,
        '时间必须是带 offset 的 ISO 8601',
      ),
    timezone: zone,
  })
  .strict();
export const locationSchema = z
  .object({
    name: z.string(),
    address: z.string(),
    googleMapsUrl: z.string(),
    appleMapsUrl: z.string(),
  })
  .strict();
export const metadataSchema = z
  .object({
    notes: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() }).strict()),
    attachmentIds: z.array(id),
    tags: z.array(z.string()),
    reservation: z.string(),
  })
  .strict();
const constraintSchema = z
  .object({
    intervals: z.array(
      z
        .object({ relation: z.enum(['within', 'covers']), start: timeSchema, end: timeSchema })
        .strict(),
    ),
    minMinutes: z.number().nonnegative().nullable(),
    maxMinutes: z.number().nonnegative().nullable(),
  })
  .strict();
const base = { id, title: z.string(), metadata: metadataSchema };
export const candidateSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('activity'),
      location: locationSchema,
      constraints: constraintSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('transport'),
      subtype: z.enum(['flight', 'train', 'ferry', 'bus', 'other']),
      origin: locationSchema,
      destination: locationSchema,
      departure: timeSchema,
      arrival: timeSchema,
      preBuffer: z.number().nonnegative(),
      postBuffer: z.number().nonnegative(),
      operator: z.string(),
      serviceNumber: z.string(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('boundary'),
      statusId: id,
      role: z.enum(['start', 'end']),
      location: locationSchema,
      defaultStart: timeSchema,
      defaultEnd: timeSchema,
    })
    .strict(),
]);
const placement = { id, start: timeSchema, end: timeSchema };
export const concreteBlockSchema = z.discriminatedUnion('kind', [
  z.object({ ...placement, kind: z.literal('candidate'), candidateId: id }).strict(),
  z
    .object({
      ...placement,
      kind: z.literal('hotelRest'),
      title: z.string(),
      metadata: metadataSchema,
    })
    .strict(),
]);
export const optionSchema = z
  .object({
    id,
    kind: z.literal('option'),
    title: z.string(),
    metadata: metadataSchema,
    variants: z.array(
      z.object({ id, title: z.string(), blocks: z.array(concreteBlockSchema) }).strict(),
    ),
  })
  .strict();
export const blockSchema = z.union([concreteBlockSchema, optionSchema]);
export const modeSchema = z.enum(['WALK', 'DRIVE', 'RIDESHARE']);
export const configSchema = z
  .object({
    home: locationSchema,
    preBuffer: z.number().nonnegative(),
    postBuffer: z.number().nonnegative(),
    overhead: z
      .object({
        WALK: z.number().nonnegative(),
        DRIVE: z.number().nonnegative(),
        RIDESHARE: z.number().nonnegative(),
      })
      .strict(),
    walkingThreshold: z.number().nonnegative(),
    routingProvider: z.enum(['google', 'unavailable']),
    navigation: z.enum(['google', 'apple']),
  })
  .strict();
export const workspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    trip: z
      .object({
        name: z.string(),
        startLocation: locationSchema,
        endLocation: locationSchema,
        displayStart: timeSchema,
        displayEnd: timeSchema,
        timezones: z.array(zone).min(1),
        primaryTimezone: zone,
        overnightBreaks: z.array(z.object({ id, time: timeSchema }).strict()),
        config: configSchema.omit({ home: true }).partial(),
      })
      .strict()
      .refine((t) => t.timezones.includes(t.primaryTimezone), '主时区必须包含于时区列表'),
    globalConfig: configSchema,
    candidates: z.array(candidateSchema),
    statuses: z.array(
      z
        .object({
          id,
          kind: z.enum(['hotel', 'rentalCar']),
          title: z.string(),
          location: locationSchema,
          metadata: metadataSchema,
        })
        .strict(),
    ),
    blocks: z.array(blockSchema),
    edgeOverrides: z.record(z.string(), modeSchema),
    attachments: z.array(
      z
        .object({
          id,
          name: z.string(),
          mime: z.string(),
          path: z
            .string()
            .regex(/^attachments\/[a-zA-Z0-9_-]+$/, '附件必须是安全的 Workspace 相对路径'),
          size: z.number().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((w, ctx) => {
    const allIds = [
      w.id,
      ...w.candidates.map((x) => x.id),
      ...w.statuses.map((x) => x.id),
      ...w.attachments.map((x) => x.id),
      ...w.trip.overnightBreaks.map((x) => x.id),
      ...w.blocks.flatMap((b) =>
        b.kind === 'option'
          ? [b.id, ...b.variants.flatMap((v) => [v.id, ...v.blocks.map((x) => x.id)])]
          : [b.id],
      ),
    ];
    if (new Set(allIds).size !== allIds.length)
      ctx.addIssue({ code: 'custom', message: '所有对象 ID 必须全局唯一' });
  });

export type ZonedTime = z.infer<typeof timeSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Metadata = z.infer<typeof metadataSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type Activity = Extract<Candidate, { kind: 'activity' }>;
export type Transport = Extract<Candidate, { kind: 'transport' }>;
export type Boundary = Extract<Candidate, { kind: 'boundary' }>;
export type ConcreteBlock = z.infer<typeof concreteBlockSchema>;
export type OptionBlock = z.infer<typeof optionSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Status = Workspace['statuses'][number];
export type Config = z.infer<typeof configSchema>;
export type Mode = z.infer<typeof modeSchema>;
export type Attachment = Workspace['attachments'][number];

export const uid = () => crypto.randomUUID();
export const emptyLocation = (): Location => ({
  name: '',
  address: '',
  googleMapsUrl: '',
  appleMapsUrl: '',
});
export const emptyMetadata = (): Metadata => ({
  notes: '',
  links: [],
  attachmentIds: [],
  tags: [],
  reservation: '',
});
export const defaultConfig = (): Config => ({
  home: emptyLocation(),
  preBuffer: 90,
  postBuffer: 30,
  overhead: { WALK: 0, DRIVE: 10, RIDESHARE: 8 },
  walkingThreshold: 20,
  routingProvider: 'google',
  navigation: 'google',
});
export const effectiveConfig = (w: Workspace): Config => ({ ...w.globalConfig, ...w.trip.config });

export function parseWorkspace(value: unknown): Workspace {
  // Version 1 is the first public format. Future migrations belong here; never repair invalid files.
  const parsed = workspaceSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'workspace'}: ${i.message}`).join('\n'),
    );
  return parsed.data;
}
export function migrateWorkspace(value: unknown): Workspace {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value))
    throw new Error('缺少 schemaVersion；不能安全迁移未知文件。');
  if (value.schemaVersion !== 1)
    throw new Error(`不支持 schemaVersion=${String(value.schemaVersion)}；原文件未修改。`);
  return parseWorkspace(value);
}
