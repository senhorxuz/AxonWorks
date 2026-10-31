/**
 * Salvamento de compactação (D5): o checkpoint que o Claude grava quando o dono avisa que a conversa
 * vai compactar. É um checkpoint como outro qualquer (imutável, com revisão e chave de idempotência,
 * gravado pelo mesmo caminho de `saveCheckpoint`), marcado com `kind = 'compactacao'` e com os extras
 * em `extras_json`: pedidos do dono, pendências, perguntas abertas e arquivos mexidos.
 *
 * Aqui mora só a regra (validar a entrada, montar as colunas e a carga canônica, ler a linha de volta);
 * `store.ts` recebe a ligação.
 */
import type { Checkpoint, CheckpointInput, CheckpointKind, ExtrasDoSalvamento } from '../../shared/types.js'
import { DomainError } from './errors.js'
import type { SqlRow, SqlValue } from './sql.js'
import { asRecord, requireString, requireStringArray } from './validation.js'

export const KIND_COMPACTACAO = 'compactacao' satisfies CheckpointKind

export interface SalvamentoValidado {
  /** A parte comum, que segue para a validação e a gravação de sempre do checkpoint. */
  checkpoint: CheckpointInput
  extras: ExtrasDoSalvamento
}

/** Lista que precisa vir (pode vir vazia: não haver pendência é uma resposta honesta). */
function listaObrigatoria(valor: unknown, campo: string): string[] {
  if (valor === undefined) throw new DomainError(400, 'invalid_input', `Campo ${campo} inválido.`)
  return requireStringArray(valor, campo)
}

/**
 * Separa a entrada de `save_compaction_snapshot` em checkpoint comum e extras. Os extras e o
 * `humanSummary` (obrigatório aqui) são validados agora; o resto é validado pelo caminho do
 * `saveCheckpoint`. Bloqueios, evidências e tarefa não fazem parte do salvamento e ficam de fora.
 */
export function validarSalvamento(input: unknown): SalvamentoValidado {
  const rec = asRecord(input, 'salvamento')
  const extras: ExtrasDoSalvamento = {
    pedidosDoDono: listaObrigatoria(rec.pedidosDoDono, 'pedidosDoDono'),
    pendencias: listaObrigatoria(rec.pendencias, 'pendencias'),
    perguntasAbertas: requireStringArray(rec.perguntasAbertas, 'perguntasAbertas'),
    arquivosMexidos: requireStringArray(rec.arquivosMexidos, 'arquivosMexidos'),
  }
  const checkpoint = {
    expectedRevision: rec.expectedRevision,
    idempotencyKey: rec.idempotencyKey,
    agent: rec.agent,
    summary: rec.summary,
    humanSummary: requireString(rec.humanSummary, 'humanSummary', 1, 280),
    nextStep: rec.nextStep,
    decisions: rec.decisions,
  } as CheckpointInput
  return { checkpoint, extras }
}

/** Valores das colunas `kind` e `extras_json`. `null` = checkpoint comum. */
export function colunasDoSalvamento(extras: ExtrasDoSalvamento | null): { kind: CheckpointKind; extrasJson: string | null } {
  if (extras === null) return { kind: 'normal', extrasJson: null }
  return { kind: KIND_COMPACTACAO, extrasJson: JSON.stringify(extras) }
}

/**
 * O que o salvamento acrescenta à carga canônica (a base da idempotência). O checkpoint comum não
 * acrescenta nada: a carga dele continua igual à de antes, e um replay antigo nunca vira conflito.
 */
export function canonicoDoSalvamento(extras: ExtrasDoSalvamento | null): Record<string, unknown> {
  return extras === null ? {} : { kind: KIND_COMPACTACAO, extras }
}

function soTextos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === 'string') : []
}

function extrasDe(dados: Record<string, unknown> | null): ExtrasDoSalvamento {
  return {
    pedidosDoDono: soTextos(dados?.pedidosDoDono),
    pendencias: soTextos(dados?.pendencias),
    perguntasAbertas: soTextos(dados?.perguntasAbertas),
    arquivosMexidos: soTextos(dados?.arquivosMexidos),
  }
}

/**
 * Salvamento vindo de um pacote ou de um snapshot importado (`registro` = o checkpoint cru, `rotulo` =
 * onde ele está, para a mensagem de recusa). `null` = checkpoint comum: sem `kind`, ou `normal`. Só o
 * `kind` compactacao carrega extras; listas que não vêm são vazias, como na leitura do banco.
 */
export function extrasImportados(registro: Record<string, unknown>, rotulo: string): ExtrasDoSalvamento | null {
  const { kind } = registro
  if (kind === undefined || kind === 'normal') return null
  if (kind !== KIND_COMPACTACAO) throw new DomainError(400, 'invalid_input', `Campo ${rotulo}.kind inválido.`)
  const extras = registro.extras === undefined ? {} : asRecord(registro.extras, `${rotulo}.extras`)
  return {
    pedidosDoDono: requireStringArray(extras.pedidosDoDono, `${rotulo}.extras.pedidosDoDono`),
    pendencias: requireStringArray(extras.pendencias, `${rotulo}.extras.pendencias`),
    perguntasAbertas: requireStringArray(extras.perguntasAbertas, `${rotulo}.extras.perguntasAbertas`),
    arquivosMexidos: requireStringArray(extras.arquivosMexidos, `${rotulo}.extras.arquivosMexidos`),
  }
}

/** `extras_json` ausente (NULL vira o JSON `null`) ou ilegível: listas vazias, nunca erro na leitura. */
function lerExtras(json: SqlValue | undefined): ExtrasDoSalvamento {
  try {
    return extrasDe(JSON.parse(json as string) as Record<string, unknown> | null)
  } catch {
    return extrasDe(null)
  }
}

/**
 * Campos do checkpoint lidos das colunas novas. Checkpoint comum (ou linha de banco antigo, sem a
 * coluna) não ganha campo nenhum: o formato de saída dele fica exatamente como era.
 */
export function camposDoSalvamento(row: SqlRow): Pick<Checkpoint, 'kind' | 'extras'> {
  if (row.kind !== KIND_COMPACTACAO) return {}
  return { kind: KIND_COMPACTACAO, extras: lerExtras(row.extras_json) }
}
