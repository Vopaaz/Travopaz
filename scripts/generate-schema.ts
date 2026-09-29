import { writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { workspaceSchema } from '../src/domain/schema';
import { createDemo } from '../src/domain/factory';
await mkdir('schemas', { recursive: true });
await mkdir('examples', { recursive: true });
await writeFile(
  'schemas/workspace-v1.schema.json',
  JSON.stringify(
    z.toJSONSchema(workspaceSchema, {
      unrepresentable: 'any',
      target: 'draft-2020-12',
      io: 'input',
    }),
    null,
    2,
  ) + '\n',
);
await writeFile('examples/kyoto-workspace.json', JSON.stringify(createDemo(), null, 2) + '\n');
