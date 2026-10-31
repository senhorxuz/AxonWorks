import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync,
  renameSync,
  copyFileSync,
} from 'node:fs';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceStore } from '../store.js';
import type {
  BackupEngineConfig,
  BackupManifest,
  DrillReport,
  RestoreResult,
} from '../../shared/backup.js';

export class BackupError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export class BackupEngine {
  private readonly store: WorkspaceStore;
  private readonly backupDir: string;
  private readonly maxCopies: number;
  private readonly encryptionKeyBuffer?: Buffer;
  private backupTimer?: NodeJS.Timeout;
  private drillTimer?: NodeJS.Timeout;
  private isOperating = false;

  constructor(store: WorkspaceStore, config: BackupEngineConfig) {
    this.store = store;
    this.backupDir = path.resolve(config.backupDir);
    this.maxCopies = Math.max(1, config.maxCopies ?? 10);

    if (config.encryptionKey) {
      this.encryptionKeyBuffer = this.deriveKey(config.encryptionKey);
    }

    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
    }

    if (config.autoSchedule) {
      this.startScheduler(config.backupIntervalMs, config.drillIntervalMs);
    }
  }

  private deriveKey(key: string): Buffer {
    const trimmed = key.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) {
      return Buffer.from(trimmed, 'base64');
    }
    return crypto.createHash('sha256').update(trimmed).digest();
  }

  private encryptBuffer(data: Buffer): Buffer {
    if (!this.encryptionKeyBuffer) return data;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKeyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
  }

  private decryptBuffer(data: Buffer): Buffer {
    if (!this.encryptionKeyBuffer) {
      throw new BackupError(400, 'encryption_key_required', 'Chave de descriptografia não configurada.');
    }
    if (data.length < 28) {
      throw new BackupError(400, 'corrupted_payload', 'Tamanho do arquivo criptografado inválido.');
    }
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKeyBuffer, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new BackupError(400, 'decryption_failed', 'Falha na autenticação/descriptografia do backup. Chave incorreta ou dados adulterados.');
    }
  }

  async createBackup(options?: { label?: string }): Promise<BackupManifest> {
    if (this.isOperating) {
      throw new BackupError(409, 'backup_busy', 'Outra operação de backup ou restauração está em andamento.');
    }
    this.isOperating = true;

    const backupId = randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempDbPath = path.join(this.backupDir, `temp-${backupId}.sqlite`);

    try {
      // 1. Snapshot consistente via VACUUM INTO do SQLite
      this.store.vacuumInto(tempDbPath);

      // 2. Verificação de integridade imediata sobre o snapshot gerado
      const testDb = new DatabaseSync(tempDbPath, { enableForeignKeyConstraints: true });
      let projectCount = 0;
      try {
        const integrityRows = testDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
        const ok = integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok';
        if (!ok) {
          throw new BackupError(500, 'snapshot_integrity_failed', 'O snapshot gerado falhou na verificação de integridade SQLite.');
        }

        const fkRows = testDb.prepare('PRAGMA foreign_key_check').all();
        if (fkRows.length > 0) {
          throw new BackupError(500, 'snapshot_fk_failed', 'O snapshot gerado falhou na verificação de chaves estrangeiras.');
        }

        const countRow = testDb.prepare('SELECT count(*) as count FROM projects').get() as { count: number };
        projectCount = countRow ? Number(countRow.count) : 0;
      } finally {
        testDb.close();
      }

      // 3. Criptografia opcional
      const isEncrypted = Boolean(this.encryptionKeyBuffer);
      const finalFileName = isEncrypted
        ? `backup-${timestamp}-${backupId}.sqlite.enc`
        : `backup-${timestamp}-${backupId}.sqlite`;
      const finalFilePath = path.join(this.backupDir, finalFileName);

      const rawBuffer = readFileSync(tempDbPath);
      const finalBuffer = isEncrypted ? this.encryptBuffer(rawBuffer) : rawBuffer;
      writeFileSync(finalFilePath, finalBuffer);

      // Remove o arquivo temporário
      if (existsSync(tempDbPath)) {
        unlinkSync(tempDbPath);
      }

      // 4. Cálculo de hash SHA-256 e manifest
      const sha256 = crypto.createHash('sha256').update(finalBuffer).digest('hex');
      const sizeBytes = statSync(finalFilePath).size;

      const manifest: BackupManifest = {
        backupId,
        createdAt: new Date().toISOString(),
        fileName: finalFileName,
        sizeBytes,
        sha256,
        projectCount,
        status: 'ready',
        encrypted: isEncrypted,
        version: 3,
        label: options?.label,
      };

      const manifestPath = path.join(this.backupDir, `manifest-${backupId}.json`);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      // 5. Aplicação da política de retenção
      this.applyRetentionPolicy();

      return manifest;
    } catch (err) {
      if (existsSync(tempDbPath)) {
        try { unlinkSync(tempDbPath); } catch { /* ignore */ }
      }
      throw err;
    } finally {
      this.isOperating = false;
    }
  }

  listBackups(): BackupManifest[] {
    const manifests: BackupManifest[] = [];
    if (!existsSync(this.backupDir)) return manifests;

    const files = readdirSync(this.backupDir);
    for (const file of files) {
      if (file.startsWith('manifest-') && file.endsWith('.json')) {
        try {
          const content = readFileSync(path.join(this.backupDir, file), 'utf-8');
          const parsed = JSON.parse(content) as BackupManifest;
          manifests.push(parsed);
        } catch {
          // Ignora arquivos corrompidos
        }
      }
    }

    // Ordena do mais recente para o mais antigo
    return manifests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getBackup(backupId: string): BackupManifest | null {
    const manifestPath = path.join(this.backupDir, `manifest-${backupId}.json`);
    if (!existsSync(manifestPath)) return null;
    try {
      const content = readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content) as BackupManifest;
    } catch {
      return null;
    }
  }

  private applyRetentionPolicy(): void {
    const backups = this.listBackups();
    if (backups.length <= this.maxCopies) return;

    // Mantém os `maxCopies` mais recentes e expurga os excedentes
    const toPrune = backups.slice(this.maxCopies);
    for (const b of toPrune) {
      const filePath = path.join(this.backupDir, b.fileName);
      const manifestPath = path.join(this.backupDir, `manifest-${b.backupId}.json`);
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
        if (existsSync(manifestPath)) unlinkSync(manifestPath);
      } catch {
        // Ignora erro ao expurgar cópia antiga
      }
    }
  }

  async runRecoveryDrill(backupId?: string): Promise<DrillReport> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const drillId = randomUUID();

    let targetManifest: BackupManifest | null = null;
    if (backupId) {
      targetManifest = this.getBackup(backupId);
      if (!targetManifest) {
        throw new BackupError(404, 'backup_not_found', `Backup '${backupId}' não encontrado.`);
      }
    } else {
      const list = this.listBackups();
      targetManifest = list.find((b) => b.status === 'ready') ?? null;
      if (!targetManifest) {
        throw new BackupError(404, 'no_ready_backup', 'Nenhum backup com status ready disponível para teste.');
      }
    }

    const backupFilePath = path.join(this.backupDir, targetManifest.fileName);
    if (!existsSync(backupFilePath)) {
      const report: DrillReport = {
        drillId,
        backupId: targetManifest.backupId,
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        integrityCheck: 'failed',
        foreignKeyCheck: 'failed',
        verifiedProjectCount: 0,
        errors: [`Arquivo de backup '${targetManifest.fileName}' não existe no disco.`],
      };
      this.saveDrillReport(report);
      return report;
    }

    const drillDbPath = path.join(this.backupDir, `drill-${drillId}.sqlite`);
    const errors: string[] = [];
    let integrityCheck = 'ok';
    let foreignKeyCheck = 'ok';
    let verifiedCount = 0;

    try {
      // 1. Verificação do hash SHA-256 do arquivo no disco
      const fileBuffer = readFileSync(backupFilePath);
      const actualSha = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      if (actualSha !== targetManifest.sha256) {
        errors.push(`Hash SHA-256 divergente: esperado ${targetManifest.sha256}, obtido ${actualSha}`);
      }

      // 2. Descriptografia ou cópia para base temporária do drill
      let plainBuffer: Buffer;
      if (targetManifest.encrypted) {
        try {
          plainBuffer = this.decryptBuffer(fileBuffer);
        } catch (decErr) {
          errors.push(`Falha na descriptografia: ${(decErr as Error).message}`);
          plainBuffer = Buffer.alloc(0);
        }
      } else {
        plainBuffer = fileBuffer;
      }

      if (errors.length === 0) {
        writeFileSync(drillDbPath, plainBuffer);

        // 3. Teste de integridade de baixo nível com PRAGMA
        const testDb = new DatabaseSync(drillDbPath, { enableForeignKeyConstraints: true });
        try {
          const integrityRows = testDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
          const ok = integrityRows.length === 1 && integrityRows[0]?.integrity_check === 'ok';
          if (!ok) {
            integrityCheck = integrityRows.map((r) => r.integrity_check).join('; ');
            errors.push(`Integrity check falhou: ${integrityCheck}`);
          }

          const fkRows = testDb.prepare('PRAGMA foreign_key_check').all();
          if (fkRows.length > 0) {
            foreignKeyCheck = `${fkRows.length} violações de chave estrangeira encontradas.`;
            errors.push(foreignKeyCheck);
          }
        } finally {
          testDb.close();
        }

        // 4. Teste de domínio funcional com WorkspaceStore sobre a base recuperada
        if (errors.length === 0) {
          const testStore = new WorkspaceStore(drillDbPath);
          try {
            const projects = testStore.listProjects();
            verifiedCount = projects.length;
            for (const p of projects) {
              const full = testStore.getProject(p.id);
              if (!full.project.id) {
                errors.push(`Projeto ${p.id} não pôde ser lido corretamente.`);
              }
            }
          } finally {
            testStore.close();
          }
        }
      }
    } catch (drillErr) {
      errors.push(`Erro fatal no drill de recuperação: ${(drillErr as Error).message}`);
    } finally {
      // Limpeza de arquivos temporários do drill
      if (existsSync(drillDbPath)) {
        try { unlinkSync(drillDbPath); } catch { /* ignore */ }
      }
      const walPath = `${drillDbPath}-wal`;
      const shmPath = `${drillDbPath}-shm`;
      if (existsSync(walPath)) try { unlinkSync(walPath); } catch { /* ignore */ }
      if (existsSync(shmPath)) try { unlinkSync(shmPath); } catch { /* ignore */ }
    }

    const status: 'passed' | 'failed' = errors.length === 0 ? 'passed' : 'failed';
    const report: DrillReport = {
      drillId,
      backupId: targetManifest.backupId,
      status,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      integrityCheck,
      foreignKeyCheck,
      verifiedProjectCount: verifiedCount,
      details: status === 'passed' ? `Drill concluído com sucesso: ${verifiedCount} projeto(s) íntegro(s).` : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };

    this.saveDrillReport(report);
    return report;
  }

  private saveDrillReport(report: DrillReport): void {
    const reportPath = path.join(this.backupDir, `drill-${report.drillId}.json`);
    try {
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    } catch {
      // Ignora erro ao salvar histórico de drill
    }
  }

  listDrillReports(): DrillReport[] {
    const reports: DrillReport[] = [];
    if (!existsSync(this.backupDir)) return reports;

    const files = readdirSync(this.backupDir);
    for (const file of files) {
      if (file.startsWith('drill-') && file.endsWith('.json')) {
        try {
          const content = readFileSync(path.join(this.backupDir, file), 'utf-8');
          reports.push(JSON.parse(content) as DrillReport);
        } catch {
          // Ignora
        }
      }
    }

    return reports.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  }

  async restoreBackup(backupId: string, options?: { confirm?: boolean; targetDbPath?: string }): Promise<RestoreResult> {
    if (options?.confirm !== true) {
      throw new BackupError(400, 'confirm_required', 'Para restaurar um backup, envie confirm: true explicitamente.');
    }

    if (this.isOperating) {
      throw new BackupError(409, 'operation_in_progress', 'Outra operação de backup ou restauração já está em andamento.');
    }
    this.isOperating = true;

    try {
      const manifest = this.getBackup(backupId);
      if (!manifest) {
        throw new BackupError(404, 'backup_not_found', `Backup '${backupId}' não encontrado.`);
      }

      // 1. Executa um drill no backup antes de tocar em qualquer dado
      const drill = await this.runRecoveryDrill(backupId);
      if (drill.status !== 'passed') {
        throw new BackupError(400, 'backup_corrupted', `O backup falhou no teste prévio de restauração: ${drill.errors?.join('; ')}`);
      }

      // 2. Determina o caminho de destino da restauração
      const targetDb = options?.targetDbPath ?? this.store.getDatabasePath();
      if (targetDb === ':memory:') {
        throw new BackupError(400, 'memory_db_not_restorable', 'Banco em memória não suporta restauração por arquivo direto.');
      }

      const backupFilePath = path.join(this.backupDir, manifest.fileName);
      const rawBuffer = readFileSync(backupFilePath);
      const plainBuffer = manifest.encrypted ? this.decryptBuffer(rawBuffer) : rawBuffer;

      // 3. Salva cópia pre-restore de salvaguarda do banco atual
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const preRestorePath = path.join(this.backupDir, `pre-restore-${timestamp}.sqlite`);
      if (existsSync(targetDb)) {
        copyFileSync(targetDb, preRestorePath);
      }

      // 4. Escreve a base restaurada em arquivo temporário antes do swap
      const tempRestore = path.join(this.backupDir, `temp-restore-${backupId}.sqlite`);
      writeFileSync(tempRestore, plainBuffer);

      const isLiveStore = targetDb === this.store.getDatabasePath();
      if (isLiveStore) {
        this.store.checkpointAndClose();
      }

      // 5. Substitui o arquivo do banco principal de forma atômica
      try {
        renameSync(tempRestore, targetDb);
      } catch {
        // Fallback para copy se rename entre partições falhar
        copyFileSync(tempRestore, targetDb);
        unlinkSync(tempRestore);
      }

      // Remove arquivos WAL/SHM legados do banco anterior para forçar recarga limpa
      const wal = `${targetDb}-wal`;
      const shm = `${targetDb}-shm`;
      if (existsSync(wal)) try { unlinkSync(wal); } catch { /* ignore */ }
      if (existsSync(shm)) try { unlinkSync(shm); } catch { /* ignore */ }

      if (isLiveStore) {
        this.store.reopen();
      }

      return {
        backupId,
        restoredAt: new Date().toISOString(),
        projectCount: drill.verifiedProjectCount,
        preRestoreBackupPath: preRestorePath,
      };
    } finally {
      this.isOperating = false;
    }
  }

  startScheduler(backupIntervalMs = 24 * 60 * 60 * 1000, drillIntervalMs = 12 * 60 * 60 * 1000): void {
    this.stopScheduler();

    // Timer de backup automático
    this.backupTimer = setInterval(() => {
      this.createBackup({ label: 'Automático Agendado' }).catch(() => {
        // Log de erro interno
      });
    }, backupIntervalMs);
    this.backupTimer.unref();

    // Timer de drill periódico
    this.drillTimer = setInterval(() => {
      this.runRecoveryDrill().catch(() => {
        // Log de erro interno
      });
    }, drillIntervalMs);
    this.drillTimer.unref();
  }

  stopScheduler(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = undefined;
    }
    if (this.drillTimer) {
      clearInterval(this.drillTimer);
      this.drillTimer = undefined;
    }
  }
}
