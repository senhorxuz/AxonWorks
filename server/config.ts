import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export const dbPath = process.env.AXON_DB_PATH ?? path.join(projectRoot, '.axon', 'workspace.sqlite');
export const backupDir = process.env.AXON_BACKUP_DIR ?? path.join(projectRoot, '.axon', 'backups');
export const backupEncryptionKey = process.env.AXON_BACKUP_KEY;
export const backupMaxCopies = Number(process.env.AXON_BACKUP_MAX_COPIES ?? 10);

