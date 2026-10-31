import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../server/store.js';
import { BackupEngine, BackupError } from '../server/backup/index.js';
import { createApp } from '../server/app.js';
import { createMcpServer } from '../server/mcp-tools.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('Etapa 2 — Backup e Restauração Automática com Teste Periódico de Recuperação (Drill)', () => {
  const cleanups: Array<() => void> = [];

  function createTempEnv() {
    const dir = mkdtempSync(path.join(tmpdir(), 'axon-backup-test-'));
    const dbPath = path.join(dir, 'live.sqlite');
    const backupDir = path.join(dir, 'backups');
    cleanups.push(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });
    return { dir, dbPath, backupDir };
  }

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()!();
    }
  });

  test('cria backup consistente via SQLite VACUUM INTO com integridade verificada e manifesto SHA-256', async () => {
    const { dbPath, backupDir } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    // Popula o banco com entidades reais
    const project = store.createProject({
      name: 'Projeto Para Backup',
      objective: 'Validar snapshot consistente e manifesto',
    });
    const task = store.createTask(project.id, { title: 'Tarefa de Teste' });
    store.claimTask(project.id, task.id, { agent: 'Astra', expectedVersion: 0 });
    store.saveCheckpoint(project.id, {
      expectedRevision: 0,
      idempotencyKey: 'cp-backup-1',
      taskId: task.id,
      agent: 'Astra',
      summary: 'Marco gravado antes do backup',
      nextStep: 'Testar snapshot',
    });

    const engine = new BackupEngine(store, { backupDir, maxCopies: 5 });
    const manifest = await engine.createBackup({ label: 'Snapshot Manual' });

    assert.equal(manifest.status, 'ready');
    assert.equal(manifest.projectCount, 1);
    assert.equal(manifest.encrypted, false);
    assert.equal(manifest.label, 'Snapshot Manual');
    assert.ok(manifest.sizeBytes > 0);
    assert.ok(manifest.sha256.length === 64);

    const backupFilePath = path.join(backupDir, manifest.fileName);
    assert.ok(existsSync(backupFilePath));

    const fileBuffer = readFileSync(backupFilePath);
    assert.equal(fileBuffer.length, manifest.sizeBytes);

    const list = engine.listBackups();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.backupId, manifest.backupId);

    const retrieved = engine.getBackup(manifest.backupId);
    assert.ok(retrieved);
    assert.equal(retrieved.backupId, manifest.backupId);
  });

  test('política de retenção expurga automaticamente cópias e manifestos excedentes', async () => {
    const { dbPath, backupDir } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    store.createProject({ name: 'Projeto Rotativo', objective: 'Testar retenção' });

    // maxCopies = 2
    const engine = new BackupEngine(store, { backupDir, maxCopies: 2 });

    const b1 = await engine.createBackup({ label: 'Cópia 1' });
    // Pequeno atraso para garantir timestamps distintos
    await new Promise((r) => setTimeout(r, 20));
    const b2 = await engine.createBackup({ label: 'Cópia 2' });
    await new Promise((r) => setTimeout(r, 20));
    const b3 = await engine.createBackup({ label: 'Cópia 3' });

    const remaining = engine.listBackups();
    assert.equal(remaining.length, 2);

    // O backup mais antigo (b1) deve ter sido expurgado
    assert.equal(remaining.some((b) => b.backupId === b1.backupId), false);
    assert.ok(remaining.some((b) => b.backupId === b2.backupId));
    assert.ok(remaining.some((b) => b.backupId === b3.backupId));

    assert.equal(existsSync(path.join(backupDir, b1.fileName)), false);
    assert.equal(existsSync(path.join(backupDir, `manifest-${b1.backupId}.json`)), false);
    assert.ok(existsSync(path.join(backupDir, b3.fileName)));
  });

  test('drill periódico de recuperação valida integridade em base isolada com sucesso', async () => {
    const { dbPath, backupDir } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const p1 = store.createProject({ name: 'Projeto Alpha', objective: 'Testar drill' });
    const p2 = store.createProject({ name: 'Projeto Beta', objective: 'Segundo projeto no drill' });

    const engine = new BackupEngine(store, { backupDir });
    const backup = await engine.createBackup({ label: 'Para Drill' });

    const drillReport = await engine.runRecoveryDrill(backup.backupId);
    assert.equal(drillReport.status, 'passed');
    assert.equal(drillReport.backupId, backup.backupId);
    assert.equal(drillReport.integrityCheck, 'ok');
    assert.equal(drillReport.foreignKeyCheck, 'ok');
    assert.equal(drillReport.verifiedProjectCount, 2);
    assert.ok(drillReport.durationMs >= 0);
    assert.equal(drillReport.errors, undefined);

    const reports = engine.listDrillReports();
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.drillId, drillReport.drillId);
  });

  test('drill periódico detecta corrupção de arquivo e relata falha sem comprometer o sistema', async () => {
    const { dbPath, backupDir } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    store.createProject({ name: 'Projeto Saudável', objective: 'Corrupção simulada' });

    const engine = new BackupEngine(store, { backupDir });
    const backup = await engine.createBackup({ label: 'Suscetível a Corrupção' });

    // Corrompe propositalmente o arquivo de backup no disco (substituindo bytes por zeros)
    const backupPath = path.join(backupDir, backup.fileName);
    const corrupted = Buffer.from(readFileSync(backupPath));
    // Sobrescreve trecho intermediário com lixo
    corrupted.fill(0xff, 100, 300);
    writeFileSync(backupPath, corrupted);

    const drillReport = await engine.runRecoveryDrill(backup.backupId);
    assert.equal(drillReport.status, 'failed');
    assert.ok(drillReport.errors && drillReport.errors.length > 0);
  });

  test('criptografia AES-256-GCM protege o backup em repouso e autentica na recuperação', async () => {
    const { dbPath, backupDir } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    store.createProject({ name: 'Segredo Confidencial', objective: 'Dados sensíveis' });

    const secretKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const engine = new BackupEngine(store, {
      backupDir,
      encryptionKey: secretKey,
    });

    const manifest = await engine.createBackup({ label: 'Backup Criptografado' });
    assert.equal(manifest.encrypted, true);
    assert.ok(manifest.fileName.endsWith('.sqlite.enc'));

    // O conteúdo bruto do arquivo não deve conter strings do SQLite em texto claro
    const rawFile = readFileSync(path.join(backupDir, manifest.fileName));
    assert.ok(!rawFile.includes(Buffer.from('SQLite format 3')));

    // Drill com a chave correta descriptografa e passa
    const drill = await engine.runRecoveryDrill(manifest.backupId);
    assert.equal(drill.status, 'passed');
    assert.equal(drill.verifiedProjectCount, 1);

    // Instância com chave errada deve falhar na autenticação
    const badEngine = new BackupEngine(store, {
      backupDir,
      encryptionKey: 'chave-completamente-incorreta-e-invalida',
    });
    const badDrill = await badEngine.runRecoveryDrill(manifest.backupId);
    assert.equal(badDrill.status, 'failed');
    assert.ok(badDrill.errors?.some((e) => e.includes('descriptografia')));
  });

  test('restauração atômica com confirmação prévia recupera o estado e cria cópia pre-restore', async () => {
    const { dbPath, backupDir } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    const p1 = store.createProject({ name: 'Projeto Original', objective: 'Estado a ser restaurado' });
    const task = store.createTask(p1.id, { title: 'Tarefa Inicial' });

    const engine = new BackupEngine(store, { backupDir });
    const backup = await engine.createBackup({ label: 'Ponto de Restauração 1' });

    // Modifica o banco (adiciona outro projeto e altera tarefas)
    store.createProject({ name: 'Projeto Temporário Descartável', objective: 'Não deve existir após restore' });
    store.createTask(p1.id, { title: 'Tarefa Criada Depois' });
    assert.equal(store.listProjects().length, 2);

    // Tentar restaurar sem confirm: true deve falhar
    await assert.rejects(
      async () => engine.restoreBackup(backup.backupId, { confirm: false }),
      (err: unknown) => {
        assert.ok(err instanceof BackupError);
        assert.equal(err.code, 'confirm_required');
        return true;
      },
    );

    // Restauração com confirmação explícita
    const restoreResult = await engine.restoreBackup(backup.backupId, { confirm: true });
    assert.equal(restoreResult.backupId, backup.backupId);
    assert.equal(restoreResult.projectCount, 1);
    assert.ok(restoreResult.preRestoreBackupPath);
    assert.ok(existsSync(restoreResult.preRestoreBackupPath!));

    // Abre um novo store sobre o banco restaurado para conferência
    const restoredStore = new WorkspaceStore(dbPath);
    try {
      const projects = restoredStore.listProjects();
      assert.equal(projects.length, 1);
      assert.equal(projects[0]?.id, p1.id);
      assert.equal(projects[0]?.name, 'Projeto Original');

      const fullProj = restoredStore.getProject(p1.id);
      assert.equal(fullProj.tasks.length, 1);
      assert.equal(fullProj.tasks[0]?.id, task.id);
    } finally {
      restoredStore.close();
    }
  });

  test('endpoints HTTP: POST /api/backups, GET /api/backups, drill e restore', async () => {
    const { dbPath, backupDir } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    store.createProject({ name: 'Projeto HTTP', objective: 'Testar rotas de backup' });

    process.env.AXON_BACKUP_DIR = backupDir;
    cleanups.push(() => { delete process.env.AXON_BACKUP_DIR; });
    const app = createApp(store);

    const server = app.listen(0, '127.0.0.1');
    cleanups.push(() => server.close());
    await new Promise((r) => server.once('listening', r));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    const headers = {
      'Content-Type': 'application/json',
      'X-Workspace-Client': 'local',
      Origin: base,
    };

    // 1. POST /api/backups
    const createRes = await fetch(`${base}/api/backups`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'Backup Via HTTP' }),
    });
    assert.equal(createRes.status, 201);
    const manifest = await createRes.json();
    assert.equal(manifest.status, 'ready');
    assert.equal(manifest.projectCount, 1);

    // 2. GET /api/backups
    const listRes = await fetch(`${base}/api/backups`, { headers: { Origin: base } });
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].backupId, manifest.backupId);

    // 3. GET /api/backups/:id
    const getRes = await fetch(`${base}/api/backups/${manifest.backupId}`, { headers: { Origin: base } });
    assert.equal(getRes.status, 200);
    const fetched = await getRes.json();
    assert.equal(fetched.backupId, manifest.backupId);

    // 4. POST /api/backups/drill
    const drillRes = await fetch(`${base}/api/backups/drill`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    assert.equal(drillRes.status, 200);
    const drill = await drillRes.json();
    assert.equal(drill.status, 'passed');

    // 5. GET /api/backups/drills
    const listDrillsRes = await fetch(`${base}/api/backups/drills`, { headers: { Origin: base } });
    assert.equal(listDrillsRes.status, 200);
    const drills = await listDrillsRes.json();
    assert.equal(drills.length, 1);

    // 6. POST /api/backups/:id/restore
    const restoreRes = await fetch(`${base}/api/backups/${manifest.backupId}/restore`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(restoreRes.status, 200);
    const restored = await restoreRes.json();
    assert.equal(restored.backupId, manifest.backupId);
  });

  test('ferramentas MCP: create_backup, list_backups, run_recovery_drill e restore_backup', async () => {
    const { dbPath, backupDir } = createTempEnv();
    const store = new WorkspaceStore(dbPath);
    cleanups.push(() => store.close());

    store.createProject({ name: 'Projeto MCP', objective: 'Testar ferramentas de backup' });

    process.env.AXON_BACKUP_DIR = backupDir;
    cleanups.push(() => { delete process.env.AXON_BACKUP_DIR; });
    const server = createMcpServer(store);
    const client = new Client({ name: 'backup-tester', version: '1.0.0' }, { capabilities: {} });
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((t) => t.name));
    assert.ok(toolNames.has('create_backup'));
    assert.ok(toolNames.has('list_backups'));
    assert.ok(toolNames.has('run_recovery_drill'));
    assert.ok(toolNames.has('get_backup_drills'));
    assert.ok(toolNames.has('restore_backup'));

    // 1. create_backup
    const createCall = await client.callTool({
      name: 'create_backup',
      arguments: { label: 'MCP Backup Test' },
    });
    assert.equal(createCall.isError, undefined);
    const manifest = JSON.parse((createCall.content as Array<{ text: string }>)[0]!.text);
    assert.equal(manifest.status, 'ready');

    // 2. list_backups
    const listCall = await client.callTool({ name: 'list_backups', arguments: {} });
    const list = JSON.parse((listCall.content as Array<{ text: string }>)[0]!.text);
    assert.equal(list.length, 1);

    // 3. run_recovery_drill
    const drillCall = await client.callTool({
      name: 'run_recovery_drill',
      arguments: { backupId: manifest.backupId },
    });
    const drill = JSON.parse((drillCall.content as Array<{ text: string }>)[0]!.text);
    assert.equal(drill.status, 'passed');

    // 4. get_backup_drills
    const drillsCall = await client.callTool({ name: 'get_backup_drills', arguments: {} });
    const drills = JSON.parse((drillsCall.content as Array<{ text: string }>)[0]!.text);
    assert.equal(drills.length, 1);

    // 5. restore_backup
    const restoreCall = await client.callTool({
      name: 'restore_backup',
      arguments: { backupId: manifest.backupId, confirm: true },
    });
    assert.equal(restoreCall.isError, undefined);
    const restored = JSON.parse((restoreCall.content as Array<{ text: string }>)[0]!.text);
    assert.equal(restored.backupId, manifest.backupId);
  });
});
