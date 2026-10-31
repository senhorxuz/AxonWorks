/**
 * Cria um backup criptografado da Axon direto no banco, sem passar pela tela.
 * É isso que o timer diário roda, e é o que a atualização roda antes de mexer no código.
 *
 * Uso: npx tsx scripts/vps/fazer-backup.ts "diario"
 */
import { BackupEngine } from '../../server/backup/index.js';
import { backupDir, backupEncryptionKey, backupMaxCopies, dbPath } from '../../server/config.js';
import { WorkspaceStore } from '../../server/store.js';

const rotulo = process.argv[2] ?? 'manual';
const store = new WorkspaceStore(dbPath);
try {
  const engine = new BackupEngine(store, { backupDir, maxCopies: backupMaxCopies, encryptionKey: backupEncryptionKey });
  const manifesto = await engine.createBackup({ label: rotulo });
  console.log(`Backup criado: ${manifesto.backupId} (${rotulo})`);
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exitCode = 1;
} finally {
  store.close();
}
