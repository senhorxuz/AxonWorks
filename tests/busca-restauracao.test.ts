import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'node:test'
import { BackupEngine } from '../server/backup/index.ts'
import { WorkspaceStore } from '../server/store.ts'

/**
 * Restaurar um backup antigo (de antes do lote 2) pelo caminho de sempre (`BackupEngine.restoreBackup`,
 * que fecha o banco, troca o arquivo e chama `WorkspaceStore.reopen()`): o banco restaurado ganha as
 * tabelas e colunas novas (lições, tipo do checkpoint, índice da busca) sem reiniciar o servidor.
 * Nenhum teste usa o banco real: cada um tem a própria pasta temporária.
 */

const pastas: string[] = []
const stores: WorkspaceStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function ambiente() {
  const pasta = mkdtempSync(path.join(tmpdir(), 'axon-busca-restauracao-'))
  pastas.push(pasta)
  let instante = Date.parse('2026-10-25T10:00:00.000Z')
  const arquivo = path.join(pasta, 'vivo.sqlite')
  const store = new WorkspaceStore(arquivo, { now: () => new Date((instante += 60_000)) })
  stores.push(store)
  const engine = new BackupEngine(store, { backupDir: path.join(pasta, 'backups'), maxCopies: 5 })
  return { arquivo, store, engine }
}

/** Deixa o banco como era antes do lote 2: sem o índice da busca, sem lições e sem o tipo do checkpoint. */
function envelhecer(arquivo: string): void {
  const cru = new DatabaseSync(arquivo)
  try {
    const gatilhos = cru.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memoria%'").all() as Array<{ name: string }>
    for (const { name } of gatilhos) cru.exec(`DROP TRIGGER ${name}`)
    cru.exec('DROP TABLE memoria_fts; DROP TABLE memoria_itens; DROP TABLE licoes')
    // Antes de 27/10/2026 o gatilho de imutabilidade não conhecia a licença de apagamento (nem o `kind`).
    cru.exec(`DROP TRIGGER trg_checkpoints_immutable; DROP TRIGGER trg_evidence_records_immutable;
      DROP TABLE licencas_de_apagamento;
      CREATE TRIGGER trg_checkpoints_immutable BEFORE UPDATE ON checkpoints
      BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;
      CREATE TRIGGER trg_evidence_records_immutable BEFORE UPDATE ON evidence_records
      BEGIN SELECT RAISE(ABORT, 'evidence records are immutable'); END;`)
    cru.exec('ALTER TABLE checkpoints DROP COLUMN extras_json; ALTER TABLE checkpoints DROP COLUMN kind')
  } finally {
    cru.close()
  }
}

function existe(arquivo: string, tabela: string): boolean {
  const cru = new DatabaseSync(arquivo)
  try {
    return cru.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela) !== undefined
  } finally {
    cru.close()
  }
}

describe('restaurar backup antigo atualiza o banco sem reiniciar', () => {
  it('busca, lições e salvamento funcionam logo depois da restauração', async () => {
    const { arquivo, store, engine } = ambiente()
    const projeto = store.createProject({ name: 'Alfa', objective: 'Vender bolos com entrega na cidade' }).id
    store.postMessage(projeto, { from: 'claude', to: 'dono', kind: 'note', body: 'O checkout com Pix ficou pronto.' })
    const conteudo = store.createContent(projeto, {
      title: 'Guia de atendimento', kind: 'note', body: 'Dúvidas sobre entrega.', createdBy: 'claude', sourceKind: 'agent_report',
    })
    envelhecer(arquivo)
    assert.equal(existe(arquivo, 'memoria_itens'), false)
    const backup = await engine.createBackup({ label: 'Antigo' })

    await engine.restoreBackup(backup.backupId, { confirm: true })

    assert.deepEqual(store.searchMemory(projeto, { query: 'entrega' }).map((x) => x.tipo).sort(), ['biblioteca', 'diretriz'])
    assert.deepEqual(store.searchMemory(projeto, { query: 'pix' }).map((x) => x.tipo), ['mensagem'])
    assert.equal(store.searchMemory(projeto, { query: 'atendimento' })[0].id, conteudo.item.id)
    assert.deepEqual(store.listarLicoes(projeto), [])
    const licao = store.registrarLicao(projeto, { texto: 'Conferir o Pix antes de publicar.', agent: 'claude' })
    assert.deepEqual(store.listarLicoes(projeto).map((l) => l.id), [licao.id])
    const revisao = store.getProject(projeto).project.revision
    const salvo = store.saveCompactionSnapshot(projeto, {
      expectedRevision: revisao,
      idempotencyKey: 'restaurado-1',
      agent: 'claude',
      summary: 'Depois da restauração.',
      humanSummary: 'Banco restaurado e atualizado.',
      nextStep: 'Seguir.',
      pedidosDoDono: ['Manter a entrega na cidade.'],
      pendencias: [],
    })
    assert.equal(salvo.kind, 'compactacao')
    assert.deepEqual(store.searchMemory(projeto, { query: 'restauração' }).map((x) => x.id), [salvo.id])
  })
})
