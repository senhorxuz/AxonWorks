/**
 * Ensaio de recuperação: abre o backup mais recente numa cópia separada e confere
 * se ele está íntegro. Não toca nos dados reais.
 *
 * Uso: npx tsx scripts/vps/ensaio-de-backup.ts
 */
import { BackupEngine } from '../../server/backup/index.js';
import { backupDir, backupEncryptionKey, backupMaxCopies, dbPath } from '../../server/config.js';
import { WorkspaceStore } from '../../server/store.js';

const store = new WorkspaceStore(dbPath);
try {
  const engine = new BackupEngine(store, { backupDir, maxCopies: backupMaxCopies, encryptionKey: backupEncryptionKey });
  const relatorio = await engine.runRecoveryDrill();
  if (relatorio.status === 'passed') {
    console.log(`Ensaio passou. Projetos conferidos na cópia: ${relatorio.verifiedProjectCount}`);
  } else {
    console.error(`Ensaio FALHOU: ${(relatorio.errors ?? []).join(' | ') || relatorio.details || 'sem detalhes'}`);
    process.exitCode = 1;
  }
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exitCode = 1;
} finally {
  store.close();
}
