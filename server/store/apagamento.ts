/**
 * O dono apaga de verdade um trecho de um registro (checkpoint) ou o registro inteiro (27/10/2026).
 *
 * Pela tela (HTTP) só o dono apaga: token de agente recebe 403. As IAs apagam só pelas ferramentas
 * `redact_checkpoint_excerpt` e `redact_checkpoint` do MCP, a pedido do dono: o pedido (1 a 500 caracteres,
 * nas palavras dele) vai para a auditoria junto com o nome do agente, e a marca diz quem apagou.
 * O registro continua imutável para todo o resto: os gatilhos `trg_checkpoints_immutable` e
 * `trg_evidence_records_immutable` só deixam passar um UPDATE quando existe, na mesma transação, uma
 * licença de apagamento para aquele registro (`licencas_de_apagamento`), e mesmo com licença só o texto
 * muda: id, projeto, tarefa, agente, revisão, data, chave e tipo continuam travados. A licença é gravada e
 * removida dentro da transação do apagamento; se algo falhar, o ROLLBACK leva as duas coisas.
 *
 * O texto apagado vira a marca `[trecho apagado pelo dono em dd/mm/aaaa]` (ou `[registro apagado …]`) em
 * todos os campos de texto, na carga canônica do registro, nos detalhes das evidências e na carga da
 * finalização de trabalho que gravou o registro. O índice da busca na memória acompanha pelo gatilho de
 * edição que ele já tem. Backups feitos antes guardam o texto antigo.
 *
 * As regras são puras (marca, contagem, troca); as funções de banco só leem, chamam a regra e gravam.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { ActorType, AuthContext } from '../../shared/auth.js'
import type { Evidence, ExtrasDoSalvamento } from '../../shared/types.js'
import { DomainError } from './errors.js'
import { asRecord } from './validation.js'

export const TRECHO_MAXIMO = 8000

export type ModoDoApagamento = 'trecho' | 'inteiro'

/** Os campos de texto de um registro que o apagamento alcança. `detalhes` = um por evidência, na ordem. */
export interface TextosDoRegistro {
  summary: string
  humanSummary: string | null
  nextStep: string
  decisions: string[]
  blockers: string[]
  detalhes: string[]
  extras: ExtrasDoSalvamento | null
}

export interface ResultadoDoApagamento {
  checkpointId: string
  modo: ModoDoApagamento
  ocorrencias: number
  marca: string
}

/** Quem apaga, como entra na auditoria. */
export interface QuemApaga {
  actorType: ActorType
  actorId: string
  /** Só quando uma IA apaga: o nome dela na marca e o pedido do dono na auditoria. */
  pedidoDoDono?: string
}

export const PEDIDO_MAXIMO = 500

/** Como cada tipo de campo muda: texto solto, frase do dono (pode faltar) e lista. */
export interface Troca {
  texto: (valor: string) => string
  humano: (valor: string | null) => string | null
  lista: (valores: string[]) => string[]
}

const LISTAS_DOS_EXTRAS = ['pedidosDoDono', 'pendencias', 'perguntasAbertas', 'arquivosMexidos'] as const

const DATA_DO_DONO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** dd/mm/aaaa no fuso do dono (America/Sao_Paulo). */
export function dataDoDono(agora: Date): string {
  return DATA_DO_DONO.format(agora)
}

/** "pelo dono" na tela; "pelo <agente> a pedido do dono" quando uma IA apaga. */
function quemNaMarca(agente: string | undefined): string {
  return agente === undefined ? 'pelo dono' : `pelo ${agente} a pedido do dono`
}

export function marcaDoTrecho(agora: Date, agente?: string): string {
  return `[trecho apagado ${quemNaMarca(agente)} em ${dataDoDono(agora)}]`
}

export function marcaDoRegistro(agora: Date, agente?: string): string {
  return `[registro apagado ${quemNaMarca(agente)} em ${dataDoDono(agora)}]`
}

/** O trecho é o texto exato que o dono colou: não é aparado, mas não pode ser vazio nem só espaços. */
export function validarTrecho(valor: unknown): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new DomainError(400, 'trecho_vazio', 'Cole o trecho que você quer apagar.')
  }
  if (valor.length > TRECHO_MAXIMO) {
    throw new DomainError(400, 'trecho_longo', `O trecho passa de ${TRECHO_MAXIMO} caracteres.`)
  }
  return valor
}

export function exigirConfirmacao(valor: unknown): void {
  if (valor !== true) {
    throw new DomainError(400, 'confirmacao_obrigatoria', 'Para apagar o registro inteiro, confirme o pedido.')
  }
}

/** Só o dono (papel owner, que não seja uma IA com token de agente) apaga. */
export function quemApaga(auth: AuthContext | undefined): QuemApaga {
  if (auth === undefined || auth.actorType === 'agent' || auth.role !== 'owner') {
    throw new DomainError(403, 'so_o_dono', 'Só o dono pode apagar registros, e só pela tela.')
  }
  return { actorType: auth.actorType, actorId: auth.actorId }
}

/** Uma IA só apaga com o pedido do dono, nas palavras dele: obrigatório, de 1 a 500 caracteres. */
export function quemApagaPelaIa(agente: string, pedidoDoDono: unknown): QuemApaga {
  if (typeof pedidoDoDono !== 'string' || pedidoDoDono.trim() === '') {
    throw new DomainError(400, 'pedido_do_dono_obrigatorio', 'Para apagar, informe o pedido do dono, nas palavras dele.')
  }
  if (pedidoDoDono.length > PEDIDO_MAXIMO) {
    throw new DomainError(400, 'pedido_do_dono_longo', `O pedido do dono passa de ${PEDIDO_MAXIMO} caracteres.`)
  }
  return { actorType: 'agent', actorId: agente, pedidoDoDono }
}

/** O nome que entra na marca: só quando é uma IA (a que veio com o pedido do dono). */
export function agenteDaMarca(quem: QuemApaga): string | undefined {
  return quem.pedidoDoDono === undefined ? undefined : quem.actorId
}

/** Ocorrências exatas (diferencia maiúsculas), sem sobreposição. */
export function contarOcorrencias(texto: string, trecho: string): number {
  return texto.split(trecho).length - 1
}

function listasDosExtras(extras: ExtrasDoSalvamento | null): string[] {
  return extras === null ? [] : LISTAS_DOS_EXTRAS.flatMap((campo) => extras[campo])
}

function textosSoltos(t: TextosDoRegistro): string[] {
  const humano = t.humanSummary === null ? [] : [t.humanSummary]
  return [t.summary, ...humano, t.nextStep, ...t.decisions, ...t.blockers, ...t.detalhes, ...listasDosExtras(t.extras)]
}

export function contarNoRegistro(t: TextosDoRegistro, trecho: string): number {
  return textosSoltos(t).reduce((soma, texto) => soma + contarOcorrencias(texto, trecho), 0)
}

/** Quantos pedaços de texto o registro inteiro perde (a frase do dono conta mesmo ausente: ela ganha a marca). */
function pedacosDoRegistro(t: TextosDoRegistro): number {
  return textosSoltos({ ...t, humanSummary: '' }).length
}

export function trocaDoTrecho(trecho: string, marca: string): Troca {
  const texto = (valor: string) => valor.split(trecho).join(marca)
  return {
    texto,
    humano: (valor) => (valor === null ? null : texto(valor)),
    lista: (valores) => valores.map(texto),
  }
}

/** Registro inteiro: todo texto vira a marca; lista cheia vira uma marca só, lista vazia continua vazia. */
export function trocaDoRegistroInteiro(marca: string): Troca {
  return {
    texto: () => marca,
    humano: () => marca,
    lista: (valores) => (valores.length === 0 ? [] : [marca]),
  }
}

/** Troca nas quatro listas sem mudar a ordem das chaves (a carga canônica guarda as chaves em ordem). */
function trocarExtras(extras: ExtrasDoSalvamento, troca: Troca): ExtrasDoSalvamento {
  const novos = { ...extras }
  for (const campo of LISTAS_DOS_EXTRAS) novos[campo] = troca.lista(extras[campo])
  return novos
}

export function trocarNosTextos(t: TextosDoRegistro, troca: Troca): TextosDoRegistro {
  return {
    summary: troca.texto(t.summary),
    humanSummary: troca.humano(t.humanSummary),
    nextStep: troca.texto(t.nextStep),
    decisions: troca.lista(t.decisions),
    blockers: troca.lista(t.blockers),
    // Uma por evidência, sempre: a evidência continua existindo, só o detalhe muda.
    detalhes: t.detalhes.map(troca.texto),
    extras: t.extras === null ? null : trocarExtras(t.extras, troca),
  }
}

/** A carga canônica (do checkpoint ou da finalização) como ela é gravada: chaves já em ordem. */
interface CargaDoRegistro {
  summary: string
  humanSummary?: string
  nextStep: string
  decisions: string[]
  blockers: string[]
  evidence: Array<{ details: string }>
  extras?: ExtrasDoSalvamento
}

/**
 * Recalcula a carga canônica com a troca. Os valores são trocados no lugar, então a ordem das chaves (a
 * da forma canônica) se mantém; chave que não existia (frase do dono, extras) continua não existindo.
 */
export function trocarNaCarga(json: string, troca: Troca): string {
  const carga = JSON.parse(json) as CargaDoRegistro
  carga.summary = troca.texto(carga.summary)
  carga.nextStep = troca.texto(carga.nextStep)
  if (carga.humanSummary !== undefined) carga.humanSummary = troca.humano(carga.humanSummary) as string
  carga.decisions = troca.lista(carga.decisions)
  carga.blockers = troca.lista(carga.blockers)
  for (const evidencia of carga.evidence) evidencia.details = troca.texto(evidencia.details)
  if (carga.extras !== undefined) carga.extras = trocarExtras(carga.extras, troca)
  return JSON.stringify(carga)
}

export function entradaDeAuditoria(resultado: ResultadoDoApagamento, projectId: string, quem: QuemApaga) {
  return {
    actorType: quem.actorType,
    actorId: quem.actorId,
    action: resultado.modo === 'trecho' ? 'checkpoint.apagar_trecho' : 'checkpoint.apagar_inteiro',
    resourceType: 'checkpoint',
    resourceId: resultado.checkpointId,
    projectId,
    // Sem o texto apagado: só o modo e quantas vezes.
    details:
      quem.pedidoDoDono === undefined
        ? { modo: resultado.modo, ocorrencias: resultado.ocorrencias }
        : { modo: resultado.modo, ocorrencias: resultado.ocorrencias, agente: quem.actorId, pedidoDoDono: quem.pedidoDoDono },
  }
}

// ---------------------------------------------------------------------------------------------- banco

const TRAVADAS_DO_REGISTRO = ['id', 'project_id', 'task_id', 'agent', 'revision', 'created_at', 'idempotency_key', 'kind']
const TRAVADAS_DA_EVIDENCIA = ['id', 'project_id', 'checkpoint_id', 'position', 'command', 'outcome', 'reported_by', 'created_at']

function gatilho(nome: string, tabela: string, idDoRegistro: string, travadas: string[], mensagem: string): string {
  const mudou = travadas.map((coluna) => `NEW.${coluna} IS NOT OLD.${coluna}`).join(' OR ')
  return `
    DROP TRIGGER IF EXISTS ${nome};
    CREATE TRIGGER ${nome} BEFORE UPDATE ON ${tabela}
    WHEN NOT EXISTS (SELECT 1 FROM licencas_de_apagamento WHERE checkpoint_id = OLD.${idDoRegistro}) OR ${mudou}
    BEGIN
      SELECT RAISE(ABORT, '${mensagem}');
    END;`
}

/**
 * Cria a tabela das licenças e troca os dois gatilhos de imutabilidade pela versão que aceita a licença.
 * Banco que já tem a versão nova não é tocado (a abertura não escreve no esquema). Tudo numa transação.
 */
export function ensureApagamentoSchema(db: DatabaseSync): void {
  const atual = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_checkpoints_immutable'").get() as
    | { sql: string }
    | undefined
  if (atual?.sql.includes('licencas_de_apagamento')) return
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS licencas_de_apagamento (checkpoint_id TEXT PRIMARY KEY);
      ${gatilho('trg_checkpoints_immutable', 'checkpoints', 'id', TRAVADAS_DO_REGISTRO, 'checkpoints are immutable')}
      ${gatilho('trg_evidence_records_immutable', 'evidence_records', 'checkpoint_id', TRAVADAS_DA_EVIDENCIA, 'evidence records are immutable')}
    `)
    db.exec('COMMIT')
  } catch (erro) {
    db.exec('ROLLBACK')
    throw erro
  }
}

interface RegistroLido {
  textos: TextosDoRegistro
  evidencias: Evidence[]
}

interface LinhaDoRegistro {
  summary: string
  human_summary: string | null
  next_step: string
  decisions_json: string
  blockers_json: string
  evidence_json: string
  extras_json: string | null
}

function lerRegistro(db: DatabaseSync, projectId: string, checkpointId: string): RegistroLido {
  const linha = db
    .prepare(
      `SELECT summary, human_summary, next_step, decisions_json, blockers_json, evidence_json, extras_json
       FROM checkpoints WHERE id = ? AND project_id = ?`,
    )
    .get(checkpointId, projectId) as LinhaDoRegistro | undefined
  if (linha === undefined) throw new DomainError(404, 'not_found', 'Registro não encontrado neste projeto.')
  const evidencias = JSON.parse(linha.evidence_json) as Evidence[]
  return {
    evidencias,
    textos: {
      summary: linha.summary,
      humanSummary: linha.human_summary,
      nextStep: linha.next_step,
      decisions: JSON.parse(linha.decisions_json) as string[],
      blockers: JSON.parse(linha.blockers_json) as string[],
      detalhes: evidencias.map((evidencia) => evidencia.details),
      extras: linha.extras_json === null ? null : (JSON.parse(linha.extras_json) as ExtrasDoSalvamento),
    },
  }
}

/** Grava os textos novos com a licença, e a remove no fim (quem chama abre a transação). */
function gravar(db: DatabaseSync, checkpointId: string, lido: RegistroLido, troca: Troca): void {
  const novos = trocarNosTextos(lido.textos, troca)
  const evidencias = lido.evidencias.map((evidencia, indice) => ({ ...evidencia, details: novos.detalhes[indice] }))
  const { payload_canonical: carga } = db.prepare('SELECT payload_canonical FROM checkpoints WHERE id = ?').get(checkpointId) as {
    payload_canonical: string
  }
  db.prepare('INSERT INTO licencas_de_apagamento (checkpoint_id) VALUES (?)').run(checkpointId)
  db.prepare(
    `UPDATE checkpoints SET summary = ?, human_summary = ?, next_step = ?, decisions_json = ?, blockers_json = ?,
       evidence_json = ?, extras_json = ?, payload_canonical = ? WHERE id = ?`,
  ).run(
    novos.summary,
    novos.humanSummary,
    novos.nextStep,
    JSON.stringify(novos.decisions),
    JSON.stringify(novos.blockers),
    JSON.stringify(evidencias),
    novos.extras === null ? null : JSON.stringify(novos.extras),
    trocarNaCarga(carga, troca),
    checkpointId,
  )
  const evidenciasGravadas = db.prepare('SELECT id, details FROM evidence_records WHERE checkpoint_id = ?').all(checkpointId) as Array<{
    id: string
    details: string
  }>
  const detalhe = db.prepare('UPDATE evidence_records SET details = ? WHERE id = ?')
  for (const { id, details } of evidenciasGravadas) detalhe.run(troca.texto(details), id)
  const finalizacoes = db.prepare('SELECT idempotency_key, payload_canonical FROM finalize_work WHERE checkpoint_id = ?').all(checkpointId) as Array<{
    idempotency_key: string
    payload_canonical: string
  }>
  const finalizacao = db.prepare('UPDATE finalize_work SET payload_canonical = ? WHERE checkpoint_id = ? AND idempotency_key = ?')
  for (const linha of finalizacoes) finalizacao.run(trocarNaCarga(linha.payload_canonical, troca), checkpointId, linha.idempotency_key)
  db.prepare('DELETE FROM licencas_de_apagamento WHERE checkpoint_id = ?').run(checkpointId)
}

/** Quantas vezes o trecho aparece no registro, para a tela mostrar antes de o dono confirmar. */
export function contarTrecho(db: DatabaseSync, projectId: string, checkpointId: string, input: unknown): { ocorrencias: number } {
  const trecho = validarTrecho(asRecord(input, 'apagamento').trecho)
  return { ocorrencias: contarNoRegistro(lerRegistro(db, projectId, checkpointId).textos, trecho) }
}

export function apagarTrecho(db: DatabaseSync, projectId: string, checkpointId: string, input: unknown, agora: Date, agente?: string): ResultadoDoApagamento {
  const trecho = validarTrecho(asRecord(input, 'apagamento').trecho)
  const lido = lerRegistro(db, projectId, checkpointId)
  const ocorrencias = contarNoRegistro(lido.textos, trecho)
  if (ocorrencias === 0) {
    throw new DomainError(404, 'trecho_nao_encontrado', 'Esse trecho não aparece neste registro. Confira se colou o texto exatamente igual.')
  }
  const marca = marcaDoTrecho(agora, agente)
  gravar(db, checkpointId, lido, trocaDoTrecho(trecho, marca))
  return { checkpointId, modo: 'trecho', ocorrencias, marca }
}

export function apagarRegistro(db: DatabaseSync, projectId: string, checkpointId: string, input: unknown, agora: Date, agente?: string): ResultadoDoApagamento {
  exigirConfirmacao(asRecord(input, 'apagamento').confirmar)
  const lido = lerRegistro(db, projectId, checkpointId)
  const marca = marcaDoRegistro(agora, agente)
  gravar(db, checkpointId, lido, trocaDoRegistroInteiro(marca))
  return { checkpointId, modo: 'inteiro', ocorrencias: pedacosDoRegistro(lido.textos), marca }
}
