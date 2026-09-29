export type Focus =
  | { kind: 'candidate' | 'block' | 'edge' | 'status' | 'break'; id: string }
  | { kind: 'trip' | 'issues' }
  | null;
