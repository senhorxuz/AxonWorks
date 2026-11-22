import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthContext } from '../../shared/auth.js'
import type { BoardCard } from '../../shared/board.js'
import type { AprovacaoDaEntrega, EstadoDaEntrega, OrigemDoDesfazimento, ResumoDaEntrega } from '../../shared/entrega.js'
import { maskSecrets } from '../handoff.js'
import type { WorkspaceStore } from '../store.js'
import { DomainError } from './errors.js'
import { naoEstaNaLixeira, recusarSeNaLixeira } from './lixeira.js'
import { asRecord, optionalUuid, requireString, requireUuid } from './validation.js'

export const ESTADOS_DOS_TESTES = ['passando', 'falhando', 'nao_rodado'] as const
export const ESTADOS_DO_CODIGO = ['nao_feito', 'local', 'enviado'] as const
export const TIPOS_DE_APROVACAO = ['visual', 'publicacao'] as const

type Aprovacao = AprovacaoDaEntrega
type Publicacao = EstadoDaEntrega['publicacoes'][number]
type Testes = EstadoDaEntrega['testes']
type Codigo = EstadoDaEntrega['codigo']

function lerEstado(linha: { estado_json: unknown }): EstadoDaEntrega {
  return JSON.parse(linha.estado_json as string) as EstadoDaEntrega
}

export function listarEntregas(db: DatabaseSync, projectId: string): EstadoDaEntrega[] {
  const linhas = db.prepare(`
    SELECT e.estado_json FROM entregas e JOIN board_cards c ON c.id = e.card_id
    WHERE c.project_id = ? AND ${naoEstaNaLixeira("'cartao'", 'c.id')}
    ORDER BY e.atualizado_em DESC, e.card_id
  `).all(projectId)
  return (linhas as Array<{ estado_json: string }>).map(lerEstado)
}

export function lerEntrega(db: DatabaseSync, projectId: string, cardId: string): EstadoDaEntrega | null {
  recusarSeNaLixeira(db, projectId, 'cartao', cardId)
  const linha = db.prepare(`
    SELECT COALESCE(e.estado_json, 'null') AS estado_json FROM board_cards c LEFT JOIN entregas e ON c.id = e.card_id
    WHERE c.project_id = ? AND c.id = ?
  `).get(projectId, cardId) as { estado_json: string } | undefined
  if (linha === undefined) throw new DomainError(404, 'not_found', 'Cartão não encontrado no projeto.')
  return JSON.parse(linha.estado_json) as EstadoDaEntrega | null
}

function entregaInicial(cardId: string, em: string): EstadoDaEntrega {
  return {
    cardId,
    testes: { estado: 'nao_rodado', evidenciaId: null, em: null },
    codigo: { onde: 'nao_feito', commit: null, ramo: null, em: null },
    publicacoes: [],
    aprovacoes: [],
    atualizadoEm: em,
  }
}

function gravar(db: DatabaseSync, estado: EstadoDaEntrega, em: string): EstadoDaEntrega {
  const atualizado = { ...estado, atualizadoEm: em }
  db.prepare(`
    INSERT INTO entregas (card_id, estado_json, atualizado_em) VALUES (?, ?, ?)
    ON CONFLICT (card_id) DO UPDATE SET estado_json = excluded.estado_json, atualizado_em = excluded.atualizado_em
  `).run(estado.cardId, JSON.stringify(atualizado), em)
  return atualizado
}

function valorDaLista<T extends string>(valores: readonly T[], valor: unknown, campo: string): T {
  if (!valores.includes(valor as T)) {
    throw new DomainError(400, 'invalid_input', `Campo ${campo} inválido. Valores aceitos: ${valores.join(', ')}.`)
  }
  return valor as T
}

function textoObrigatorio(valor: unknown, campo: string, maximo: number, code: string, mensagem: string): string {
  if (valor == null || (typeof valor === 'string' && valor.trim() === '')) {
    throw new DomainError(400, code, mensagem)
  }
  return requireString(valor, campo, 1, maximo)
}

function ambienteObrigatorio(valor: unknown): string {
  return textoObrigatorio(valor, 'ambiente', 100, 'ambiente_obrigatorio', 'Informe o ambiente de publicação.')
}

function referenciaOpcional(valor: unknown, campo: string): string | null {
  return valor === undefined || valor === null ? null : requireString(valor, campo, 1, 200)
}

function evidenciaDoProjeto(db: DatabaseSync, projectId: string, valor: unknown): string | null {
  const id = optionalUuid(valor, 'evidenciaId')
  if (id !== null && !db.prepare('SELECT 1 FROM evidence_records WHERE id = ? AND project_id = ?').get(id, projectId)) {
    throw new DomainError(404, 'not_found', 'Evidência não encontrada no projeto.')
  }
  return id
}

function atualizarTestes(db: DatabaseSync, projectId: string, atuais: Testes, input: unknown, em: string): Testes {
  if (input === undefined) return atuais
  const rec = asRecord(input, 'testes')
  const estado = valorDaLista(ESTADOS_DOS_TESTES, rec.estado, 'testes.estado')
  const evidenciaId = evidenciaDoProjeto(db, projectId, rec.evidenciaId)
  if (atuais.estado === estado && atuais.evidenciaId === evidenciaId) return atuais
  return { estado, evidenciaId, em }
}

function atualizarCodigo(atual: Codigo, input: unknown, em: string): Codigo {
  if (input === undefined) return atual
  const rec = asRecord(input, 'codigo')
  const onde = valorDaLista(ESTADOS_DO_CODIGO, rec.onde, 'codigo.onde')
  const commit = referenciaOpcional(rec.commit, 'codigo.commit')
  const ramo = referenciaOpcional(rec.ramo, 'codigo.ramo')
  if (atual.onde === onde && atual.commit === commit && atual.ramo === ramo) return atual
  return { onde, commit, ramo, em }
}

function autoriza(aprovacao: Aprovacao, ambiente: string): boolean {
  // Só aprovações de publicação têm ambiente.
  return aprovacao.ambiente === ambiente && aprovacao.desfeitaEm === null
}

function registrarPublicacao(
  db: DatabaseSync, projectId: string, estado: EstadoDaEntrega, input: unknown, registradoPor: string, em: string,
): Publicacao[] {
  if (input === undefined) return estado.publicacoes
  const rec = asRecord(input, 'publicacao')
  const ambiente = ambienteObrigatorio(rec.ambiente)
  const commit = referenciaOpcional(rec.commit, 'publicacao.commit')
  const evidenciaId = evidenciaDoProjeto(db, projectId, rec.evidenciaId)
  if (estado.publicacoes.some((p) => p.ambiente === ambiente && p.commit === commit && p.evidenciaId === evidenciaId)) {
    return estado.publicacoes
  }
  if (!estado.aprovacoes.some((a) => autoriza(a, ambiente))) {
    throw new DomainError(409, 'publicacao_sem_autorizacao', `O dono precisa autorizar a publicação em ${ambiente}.`)
  }
  return [...estado.publicacoes, { ambiente, commit, evidenciaId, publicadoEm: em, registradoPor }]
}

export function atualizarEntrega(db: DatabaseSync, projectId: string, cardId: string, input: unknown, em: string): EstadoDaEntrega | null {
  const anterior = lerEntrega(db, projectId, cardId)
  const atual = anterior ?? entregaInicial(cardId, em)
  const rec = asRecord(input, 'entrega')
  const agente = requireString(rec.agent, 'agent', 1, 80)
  const testes = atualizarTestes(db, projectId, atual.testes, rec.testes, em)
  const codigo = atualizarCodigo(atual.codigo, rec.codigo, em)
  const publicacoes = registrarPublicacao(db, projectId, atual, rec.publicacao, agente, em)
  if (testes === atual.testes && codigo === atual.codigo && publicacoes === atual.publicacoes) return anterior
  return gravar(db, { ...atual, testes, codigo, publicacoes }, em)
}

function chaveDaAprovacao(a: Omit<Aprovacao, 'id' | 'em' | 'desfeitaEm'>): string {
  return JSON.stringify([a.tipo, a.ambiente, a.origem, a.fraseDoDono, a.registradaPor, a.versao])
}

export function aprovarEntrega(
  db: DatabaseSync, projectId: string, cardId: string, input: unknown, em: string, donoNaTela?: string,
): EstadoDaEntrega {
  const atual = lerEntrega(db, projectId, cardId) ?? entregaInicial(cardId, em)
  const rec = asRecord(input, 'aprovação da entrega')
  const tipo = valorDaLista(TIPOS_DE_APROVACAO, rec.tipo, 'tipo')
  const ambiente = tipo === 'publicacao' ? ambienteObrigatorio(rec.ambiente) : null
  const versao = referenciaOpcional(rec.versao, 'versao')
  const autoria = donoNaTela === undefined
    ? autoriaDoChat(rec)
    : { origem: 'tela' as const, fraseDoDono: null, registradaPor: donoNaTela }
  const nova = { tipo, ambiente, versao, ...autoria }
  const chave = chaveDaAprovacao(nova)
  if (vigentesDaEntrega(atual).some((aprovacao) => chaveDaAprovacao(aprovacao) === chave)) return atual
  const aprovacoes = [...atual.aprovacoes, { ...nova, id: randomUUID(), em, desfeitaEm: null }]
  return gravar(db, { ...atual, aprovacoes }, em)
}

function autoriaDoChat(rec: Record<string, unknown>) {
  textoObrigatorio(rec.fraseDoDono, 'fraseDoDono', 1_000, 'frase_do_dono_obrigatoria', 'Informe a frase do dono como ele a disse no chat.')
  return { origem: 'chat' as const, fraseDoDono: rec.fraseDoDono as string, registradaPor: requireString(rec.agent, 'agent', 1, 80) }
}

function autoriaDoDesfazimento(origem: { chat: unknown } | 'tela'): OrigemDoDesfazimento {
  if (origem === 'tela') return { origem: 'tela' }
  const rec = asRecord(origem.chat, 'pedido do dono')
  const agente = requireString(rec.agent, 'agent', 1, 80)
  textoObrigatorio(rec.pedidoDoDono, 'pedidoDoDono', 500, 'pedido_do_dono_obrigatorio', 'Informe o pedido do dono para desfazer a aprovação.')
  return { origem: 'chat', agente, pedidoDoDono: rec.pedidoDoDono as string }
}

export function desfazerAprovacao(
  db: DatabaseSync, projectId: string, cardId: string, aprovacaoId: string, em: string, origem: { chat: unknown } | 'tela',
  logAudit: WorkspaceStore['logAudit'],
): EstadoDaEntrega {
  const atual = lerEntrega(db, projectId, cardId)
  const id = requireUuid(aprovacaoId, 'aprovacaoId')
  const desfeitaPor = autoriaDoDesfazimento(origem)
  if (atual === null) throw new DomainError(404, 'not_found', 'Aprovação não encontrada neste cartão.')
  const aprovacao = atual.aprovacoes.find((item) => item.id === id)
  if (aprovacao === undefined) throw new DomainError(404, 'not_found', 'Aprovação não encontrada neste cartão.')
  if (aprovacao.desfeitaEm !== null) return atual
  const aprovacoes = atual.aprovacoes.map((item) => item.id === id ? { ...item, desfeitaEm: em, desfeitaPor } : item)
  if (desfeitaPor.origem === 'chat') {
    logAudit({
      actorType: 'agent', actorId: desfeitaPor.agente, action: 'entrega.aprovacao_desfeita',
      resourceType: 'aprovacao', resourceId: id, projectId,
      details: { cardId, origem: desfeitaPor.origem, pedidoDoDono: desfeitaPor.pedidoDoDono },
    })
  }
  return gravar(db, { ...atual, aprovacoes }, em)
}

export function conferirEscopoDaEntrega(auth: AuthContext | undefined, projectId: string): void {
  if (auth?.projectId && auth.projectId !== projectId) {
    throw new DomainError(403, 'forbidden_project_scope', 'Este token não possui permissão para acessar este projeto.')
  }
}

export function donoDaEntrega(auth: AuthContext | undefined, projectId: string): string {
  conferirEscopoDaEntrega(auth, projectId)
  if (auth === undefined || auth.actorType === 'agent' || auth.role !== 'owner') {
    throw new DomainError(403, 'so_o_dono', 'Só o dono pode aprovar ou desfazer a aprovação da entrega pela tela.')
  }
  return auth.actorId
}

const TEXTO_DOS_TESTES: Record<Testes['estado'], string> = {
  passando: 'testes passando (relato)',
  falhando: 'testes falhando (relato)',
  nao_rodado: 'testes ainda não rodados',
}

function resumoDoCodigo(codigo: Codigo): string {
  if (codigo.onde === 'nao_feito') return 'código ainda não feito'
  const local = codigo.onde === 'local' ? 'local' : 'enviado'
  return codigo.commit === null ? `código ${local}` : `commit ${local} ${codigo.commit}`
}

/** Sem nenhum ambiente citado (nem publicação, nem autorização), a entrega não inventa um. */
export const PUBLICACAO_SEM_AMBIENTE = 'publicação pendente: nenhum ambiente autorizado ainda'

/**
 * Ambientes que alguém citou: os publicados e os de qualquer aprovação de publicação, inclusive a desfeita
 * (desfeita volta a ficar pendente). Nenhum ambiente é suposto: antes, "staging" aparecia em toda entrega.
 */
export function ambientesCitados(estado: Pick<EstadoDaEntrega, 'publicacoes' | 'aprovacoes'>): string[] {
  const ambientes = new Set(estado.publicacoes.map((publicacao) => publicacao.ambiente))
  for (const aprovacao of estado.aprovacoes) {
    if (aprovacao.ambiente !== null) ambientes.add(aprovacao.ambiente)
  }
  return [...ambientes]
}

function resumoDasPublicacoes(estado: EstadoDaEntrega, vigentes: Aprovacao[]): string[] {
  const porAmbiente = new Map(estado.publicacoes.map((publicacao) => [publicacao.ambiente, publicacao]))
  const ambientes = ambientesCitados(estado)
  if (ambientes.length === 0) return [PUBLICACAO_SEM_AMBIENTE]
  return ambientes.map((ambiente) => {
    const publicacao = porAmbiente.get(ambiente)
    if (publicacao !== undefined) {
      const commit = publicacao.commit === null ? '' : `, commit ${publicacao.commit}`
      return `publicado em ${ambiente}${commit} (relato de ${publicacao.registradoPor})`
    }
    if (vigentes.some((aprovacao) => autoriza(aprovacao, ambiente))) return `publicação autorizada para ${ambiente}`
    return `publicação pendente: falta autorização para ${ambiente}`
  })
}

function vigentesDaEntrega(estado: EstadoDaEntrega): Aprovacao[] {
  return estado.aprovacoes.filter((aprovacao) => aprovacao.desfeitaEm === null)
}

export function resumoDaEntrega(estado: EstadoDaEntrega): string {
  const vigentes = vigentesDaEntrega(estado)
  const visual = vigentes.some((aprovacao) => aprovacao.tipo === 'visual') ? ['aprovado (visual)'] : []
  return textoParaLeitura([
    ...visual, TEXTO_DOS_TESTES[estado.testes.estado], resumoDoCodigo(estado.codigo), ...resumoDasPublicacoes(estado, vigentes),
  ].join(' · '))
}

function textoParaLeitura(texto: string): string {
  return maskSecrets(texto.replace(/\s+/g, ' ').trim())
}

function autoriaDaAprovacao(aprovacao: Aprovacao): string {
  const escopo = aprovacao.ambiente === null ? 'visual' : `publicação em ${aprovacao.ambiente}`
  const origem = aprovacao.origem === 'tela'
    ? 'dono pela tela'
    : `dito pelo dono no chat, registrado por ${aprovacao.registradaPor} (nome declarado)`
  return textoParaLeitura(`${escopo}: ${origem}`)
}

export function resumirEntregas(estados: EstadoDaEntrega[], cartoes: BoardCard[]): ResumoDaEntrega[] {
  const emAndamento = new Map(cartoes.filter((c) => c.column !== 'done' && c.column !== 'discarded').map((c) => [c.id, c.title]))
  return estados.flatMap((estado) => {
    const titulo = emAndamento.get(estado.cardId)
    if (titulo === undefined) return []
    const autorias = new Set(vigentesDaEntrega(estado).map(autoriaDaAprovacao))
    return [{ cardId: estado.cardId, titulo: textoParaLeitura(titulo), resumo: resumoDaEntrega(estado), autorias: [...autorias] }]
  })
}
