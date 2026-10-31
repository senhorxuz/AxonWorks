export type BackupStatus = 'ready' | 'corrupted';
export type DrillStatus = 'passed' | 'failed';

export interface BackupManifest {
  backupId: string;
  createdAt: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  projectCount: number;
  status: BackupStatus;
  encrypted: boolean;
  version: number;
  label?: string;
}

export interface DrillReport {
  drillId: string;
  backupId: string;
  status: DrillStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  integrityCheck: string;
  foreignKeyCheck: string;
  verifiedProjectCount: number;
  details?: string;
  errors?: string[];
}

export interface RestoreResult {
  backupId: string;
  restoredAt: string;
  projectCount: number;
  preRestoreBackupPath?: string;
}

export interface BackupEngineConfig {
  backupDir: string;
  maxCopies?: number;
  encryptionKey?: string;
  autoSchedule?: boolean;
  backupIntervalMs?: number;
  drillIntervalMs?: number;
}
