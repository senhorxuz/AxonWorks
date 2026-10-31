import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { ehClaude, lerExtrasDaRetomada } from '../server/ganchos/extras.ts'
import { WorkspaceStore } from '../server/store.ts'
import { lerDadosDaCarta } from '../server/carta/ler.ts'
import { montarCarta } from '../server/carta/montar.ts'
import { renderizarRetomadaCompacta } from '../server/carta/retomada-compacta.ts'

/** O que a retomada compacta leva além da carta (spec 7.4 e 13.5). */

const stores: WorkspaceStore[] = []
const pastas: string[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true })
})

function novaAxon(workspacePath = ''): { store: WorkspaceStore; projectId: string } {
  let instante = Date.parse('2026-10-25T10:00:00.000Z')
  const store = new WorkspaceStore(':memory:', { now: () => new Date((instante += 60_000)) })
  stores.push(store)
  const projectId = store.createProject({ name: 'Alfa', objective: 'Vender cursos', workspacePath }).id
  return { store, projectId }
}

function checkpoint(store: WorkspaceStore, projectId: string, agent = 'Claude', evidence: unknown[] = []) {
  return store.saveCheckpoint(projectId, {
    expectedRevision: store.getProject(projectId).project.revision,
    idempotencyKey: `cp-${Math.random()}`,
    agent,
    summary: 'Resumo do registro',
    nextStep: 'Seguir',
    evidence: evidence as never,
  })
}

describe('ehClaude', () => {
  it('todo nome que começa com claude, sem diferenciar maiúsculas', () => {
    for (const nome of ['Claude', 'claude', 'CLAUDE-orquestrador', 'Claude (automático)']) assert.equal(ehClaude(nome), true, nome)
    for (const nome of ['Grok', 'Astra', '*', ' Claude', 'O Claude', '']) assert.equal(ehClaude(nome), false, nome)
    assert.equal(ehClaude(null), false)
  })
})

describe('lerExtrasDaRetomada', () => {
  it('projeto vazio: tudo vazio e zero; pós-compactação passa como veio', () => {
    const { store, projectId } = novaAxon()
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false), {
      decisoesVigentes: [],
      bloqueiosAbertos: [],
      mensagensNaoLidas: [],
      tarefasDoClaude: [],
      evidenciasDesatualizadas: 0,
      posCompactacao: false,
      licoes: [],
      avisos: [],
    })
    assert.equal(lerExtrasDaRetomada(store, projectId, true).posCompactacao, true)
  })

  it('decisões vigentes são só as aceitas (as propostas já vão em "precisa do dono")', () => {
    const { store, projectId } = novaAxon()
    const aceita = store.proposeDecision(projectId, { agent: 'Claude', title: 'Usar SQLite', body: 'a' })
    store.acceptDecision(projectId, aceita.id, { actor: 'Dono', expectedVersion: aceita.version })
    store.proposeDecision(projectId, { agent: 'Claude', title: 'Só proposta', body: 'b' })
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).decisoesVigentes, [{ titulo: 'Usar SQLite' }])
  })

  it('bloqueio aberto não se repete aqui: já vai na carta, em "travado"', () => {
    const { store, projectId } = novaAxon()
    store.openBlocker(projectId, { agent: 'Claude', title: 'Cobrança do GitHub', body: 'cartão recusado' })
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).bloqueiosAbertos, [])
  })

  it('mensagens não lidas para qualquer Claude ou para todos; lidas, de outros e o próprio aviso geral do Claude ficam fora', () => {
    const { store, projectId } = novaAxon()
    store.postMessage(projectId, { from: 'Grok', to: 'Claude', kind: 'note', body: 'Para o Claude' })
    store.postMessage(projectId, { from: 'Grok', to: 'Claude-orquestrador', kind: 'question', body: 'Para o orquestrador' })
    store.postMessage(projectId, { from: 'Astra', to: '*', kind: 'note', body: 'Para todos' })
    store.postMessage(projectId, { from: 'Claude', to: '*', kind: 'note', body: 'Aviso geral do próprio Claude' })
    store.postMessage(projectId, { from: 'Claude', to: 'Grok', kind: 'note', body: 'Para o Grok' })
    store.postMessage(projectId, { from: 'Claude-orquestrador', to: 'Claude', kind: 'note', body: 'Do orquestrador' })
    const lida = store.postMessage(projectId, { from: 'Grok', to: 'Claude', kind: 'note', body: 'Já lida' })
    store.acknowledgeMessage(projectId, lida.id, { agent: 'Claude' })

    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).mensagensNaoLidas, [
      { de: 'Grok', texto: 'Para o Claude' },
      { de: 'Astra', texto: 'Para todos' },
      { de: 'Claude-orquestrador', texto: 'Do orquestrador' },
      { de: 'Grok', texto: 'Para o orquestrador' },
    ])
  })

  it('passagem para um nome de Claude que só aparece como responsável de tarefa também chega', () => {
    const { store, projectId } = novaAxon()
    const tarefa = store.createTask(projectId, { title: 'Revisar' })
    store.claimTask(projectId, tarefa.id, { agent: 'Claude-revisor', expectedVersion: 0 })
    const doGrok = checkpoint(store, projectId, 'Grok')
    store.createHandoffDelivery(projectId, { checkpointId: doGrok.id, from: 'Grok', to: 'Claude-revisor', message: 'Revise o login' })
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).mensagensNaoLidas, [{ de: 'Grok', texto: 'Revise o login' }])
  })

  it('passagens não lidas para o Claude entram, com a mensagem ou, sem ela, o resumo do registro', () => {
    const { store, projectId } = novaAxon()
    const doGrok = checkpoint(store, projectId, 'Grok')
    store.createHandoffDelivery(projectId, { checkpointId: doGrok.id, from: 'Grok', to: 'Claude', message: 'Assume o login' })
    store.createHandoffDelivery(projectId, { checkpointId: doGrok.id, from: 'Grok', to: 'Claude' })
    const lida = store.createHandoffDelivery(projectId, { checkpointId: doGrok.id, from: 'Grok', to: 'Claude', message: 'Lida' })
    store.acknowledgeHandoffDelivery(projectId, lida.id, { agent: 'Claude' })
    store.createHandoffDelivery(projectId, { checkpointId: doGrok.id, from: 'Grok', to: 'Astra', message: 'Para a Astra' })

    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).mensagensNaoLidas, [
      { de: 'Grok', texto: 'Assume o login' },
      { de: 'Grok', texto: 'Resumo do registro' },
    ])
  })

  it('aviso geral aparece uma vez só, mesmo com vários nomes de Claude no projeto', () => {
    const { store, projectId } = novaAxon()
    store.postMessage(projectId, { from: 'Grok', to: 'claude-revisor', kind: 'note', body: 'Para o revisor' })
    store.postMessage(projectId, { from: 'Astra', to: '*', kind: 'note', body: 'Para todos' })
    const extras = lerExtrasDaRetomada(store, projectId, false)
    assert.deepEqual(extras.mensagensNaoLidas, [
      { de: 'Astra', texto: 'Para todos' },
      { de: 'Grok', texto: 'Para o revisor' },
    ])
  })

  it('tarefas do Claude: abertas, de qualquer nome de Claude, com o estado em português', () => {
    const { store, projectId } = novaAxon()
    const fazendo = store.createTask(projectId, { title: 'Arrumar login' })
    store.claimTask(projectId, fazendo.id, { agent: 'Claude-orquestrador', expectedVersion: 0 })
    const travada = store.createTask(projectId, { title: 'Pagar domínio' })
    store.claimTask(projectId, travada.id, { agent: 'Claude', expectedVersion: 0 })
    store.finalizeWork(projectId, {
      agent: 'Claude',
      expectedRevision: store.getProject(projectId).project.revision,
      idempotencyKey: 'trava',
      summary: 'Parei',
      nextStep: 'Esperar o cartão',
      taskId: travada.id,
      taskTransition: { kind: 'declare_blocked', reason: 'Falta o cartão', retainLease: true },
    })
    const concluida = store.createTask(projectId, { title: 'Já feita' })
    store.claimTask(projectId, concluida.id, { agent: 'Claude', expectedVersion: 0 })
    store.finalizeWork(projectId, {
      agent: 'Claude',
      expectedRevision: store.getProject(projectId).project.revision,
      idempotencyKey: 'feita',
      summary: 'Terminei',
      nextStep: 'Nada',
      taskId: concluida.id,
      taskTransition: { kind: 'declare_done' },
    })
    const doGrok = store.createTask(projectId, { title: 'Do Grok' })
    store.claimTask(projectId, doGrok.id, { agent: 'Grok', expectedVersion: 0 })
    store.createTask(projectId, { title: 'Sem dono' })
    // Reserva do Claude em estado que não é reserva (só por importação ou banco antigo): fica fora.
    for (const [titulo, estado] of [['Fora a fazer', 'todo'], ['Fora feita', 'done']]) {
      const t = store.createTask(projectId, { title: titulo! })
      store.claimTask(projectId, t.id, { agent: 'Claude', expectedVersion: 0 })
      const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => unknown } } }).db
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(estado, t.id)
    }

    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).tarefasDoClaude, [
      { titulo: 'Arrumar login', estado: 'em andamento' },
      { titulo: 'Pagar domínio', estado: 'travada' },
    ])
  })

  it('evidências que deixaram de cobrir a versão atual: a contagem', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'axon-extras-'))
    pastas.push(pasta)
    const { store, projectId } = novaAxon(pasta)
    const sha = (texto: string) => createHash('sha256').update(texto).digest('hex')
    writeFileSync(join(pasta, 'a.txt'), 'A')
    writeFileSync(join(pasta, 'b.txt'), 'B')
    checkpoint(store, projectId, 'Claude', [
      { command: 'a', outcome: 'passed', details: '', artifacts: [{ path: 'a.txt', sha256: sha('A') }] },
      { command: 'b', outcome: 'passed', details: '', artifacts: [{ path: 'b.txt', sha256: sha('B') }] },
    ])
    assert.equal(lerExtrasDaRetomada(store, projectId, false).evidenciasDesatualizadas, 0)
    writeFileSync(join(pasta, 'b.txt'), 'B mudou')
    assert.equal(lerExtrasDaRetomada(store, projectId, false).evidenciasDesatualizadas, 1)
  })
})

describe('lerExtrasDaRetomada: lições (D4) e trabalho não registrado (D1)', () => {
  it('lições ativas do projeto e as globais, da mais nova para a mais antiga; aposentada e de outro projeto não', () => {
    const { store, projectId } = novaAxon()
    const outro = store.createProject({ name: 'Outro', objective: 'Outro' }).id
    store.registrarLicao(null, { texto: 'No Windows, o git usa barras invertidas.', agent: 'Claude' })
    store.registrarLicao(projectId, { texto: 'O Pix só vale com a conta do banco aprovada.', agent: 'Claude' })
    const velha = store.registrarLicao(projectId, { texto: 'Lição que deixou de valer.', agent: 'Claude' })
    store.aposentarLicao(velha.id, { agent: 'Claude', motivo: 'Mudou o banco.' })
    store.registrarLicao(outro, { texto: 'Lição de outro projeto.', agent: 'Claude' })
    store.registrarLicao(null, { texto: 'O Stryker local fica em node_modules.', agent: 'Claude' })
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).licoes, [
      { texto: 'O Stryker local fica em node_modules.' },
      { texto: 'O Pix só vale com a conta do banco aprovada.' },
      { texto: 'No Windows, o git usa barras invertidas.' },
    ])
  })

  it('40 lições de ~490 caracteres: a retomada leva as 10 mais novas, da mais nova para a mais antiga, e conta as outras 30', () => {
    const { store, projectId } = novaAxon()
    const texto = (i: number) => `Lição ${String(i).padStart(2, '0')}: ${'o caminho do banco no Windows precisa de aspas. '.repeat(10)}`.slice(0, 490).trim()
    for (let i = 0; i < 40; i++) store.registrarLicao(i % 2 === 0 ? projectId : null, { texto: texto(i), agent: 'Claude' })
    const extras = lerExtrasDaRetomada(store, projectId, false)
    assert.equal(extras.licoes!.length, 40)
    const carta = montarCarta(lerDadosDaCarta(store, projectId), new Date('2026-10-25T12:00:00.000Z'))
    const linhas = renderizarRetomadaCompacta(carta, extras).split('\n')
    assert.deepEqual(
      linhas.filter((l) => l.startsWith('- Lição ')),
      Array.from({ length: 10 }, (_, i) => `- ${texto(39 - i)}`),
    )
    assert.match(linhas.at(-1)!, /^Não coube neste texto: mais 30 lições: list_lessons[,.]/)
  })

  it('o estado do git vira o aviso de trabalho não registrado; sem estado, ou sem nada a avisar, nenhum aviso', () => {
    const { store, projectId } = novaAxon()
    const git = { commits: [{ hash: 'a1b2c3d', titulo: 'Corrige o login' }], alterados: 2 }
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false, git).avisos, [
      'Trabalho não registrado na Axon: 1 commit depois do registro mais recente (a1b2c3d Corrige o login) e 2 arquivos alterados sem commit.',
    ])
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false, { commits: [], alterados: 0 }).avisos, [])
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false, null).avisos, [])
    assert.deepEqual(lerExtrasDaRetomada(store, projectId, false).avisos, [])
  })
})
