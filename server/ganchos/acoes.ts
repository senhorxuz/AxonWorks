// As quatro ações do programa dos ganchos do Claude Code (spec 7.2 e 13.2 a 13.6). Cada uma devolve o
// texto para a saída padrão ('' quando nada). Pasta não conectada: nada é lido além da lista de
// projetos, nada é gravado. Falha com o projeto conhecido vira evento de saúde; a última rede contra
// qualquer erro é `principal.ts`.
import { AGENTE_AUTOMATICO, PROXIMO_PASSO_AUTOMATICO } from '../../shared/carta.js'
import type { Project } from '../../shared/types.js'
import { lerDadosDaCarta } from '../carta/ler.js'
import { montarCarta } from '../carta/montar.js'
import { renderizarRetomadaCompacta } from '../carta/retomada-compacta.js'
import type { WorkspaceStore } from '../store.js'
import { DomainError } from '../store/errors.js'
import type { EventoDeIntegracao } from '../store/integracao.js'
import { acharProjetoPorPasta } from './achar-projeto.js'
import { lerExtrasDaRetomada } from './extras.js'
import type { EstadoDoGit } from './git.js'
import { apagarMarcador, gravarMarcador, listarMarcadores, type MarcadorDeSessao } from './marcadores.js'
import { juntarComPedidos } from './pedidos-do-dono.js'
import { dataDaConversa, sessaoParada } from './sessao-parada.js'
import { cortarFimSemPartir, cortarInicioSemPartir, lerFimDaConversa, type FimDaConversa } from './transcricao.js'

export interface EntradaDoGancho {
  hook_event_name: string
  session_id: string
  transcript_path?: string
  cwd?: string
  source?: string
  compact_summary?: string
}

export interface Ambiente {
  store: WorkspaceStore
  /** Pasta da sessão (`CLAUDE_PROJECT_DIR`, ou `cwd` da entrada). */
  pastaDoProjeto: string
  dirMarcadores: string
  agora: () => Date
  /**
   * D1: o estado do git da pasta, lido antes da abertura (`gitDaAbertura`). Ausente ou `null` (não
   * lido, falhou ou demorou): a retomada sai sem o aviso de trabalho não registrado.
   */
  git?: EstadoDoGit | null
}

/** Quem lê o git da pasta (ver `git.ts`): nunca lança, e devolve `null` em qualquer falha ou demora. */
export type LerGit = (pasta: string, desde: string) => Promise<EstadoDoGit | null>

/** Os rascunhos aceitam até 8.000 caracteres por campo. */
export const LIMITE_DO_RESUMO = 8000
/** Spec 13.3: sessão quase vazia não gera rascunho. */
const MINIMO_DE_PEDIDOS = 2
const MINIMO_DE_FERRAMENTAS = 1
/** O prazo de uma sessão parada (marcador e conversa) vive em `sessao-parada.ts`. */
export { MINUTOS_PARA_RECUPERAR } from './sessao-parada.js'

// ---------------------------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------------------------

function projetoDaPasta(a: Ambiente, projetos: Project[] = a.store.listProjects()): Project | null {
  return acharProjetoPorPasta(projetos, a.pastaDoProjeto)
}

function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

/** O registro de saúde nunca pode tirar da sessão o que já deu certo. */
function registrarSemAtrapalhar(store: WorkspaceStore, projectId: string, evento: EventoDeIntegracao): void {
  try {
    store.registrarEventoDeIntegracao(projectId, evento)
  } catch {
    // sem registro desta vez; a próxima ação tenta de novo
  }
}

/**
 * Spec 13.2: o automático tem agente próprio, então nunca toca o rascunho deliberado do Claude;
 * um automático novo substitui o anterior do mesmo projeto (a versão sobe).
 *
 * O texto vem do próprio gancho (resumo da compactação, fim da conversa), não foi digitado pelo dono:
 * um acento que já chegou quebrado (U+FFFD) vira `?`. Sem isso a validação da Axon recusa o texto
 * inteiro e o rascunho se perde. A validação continua a mesma para todo o resto.
 */
function gravarRascunhoAutomatico(store: WorkspaceStore, projectId: string, resumo: string): boolean {
  const summary = cortarInicioSemPartir(resumo.replaceAll('\uFFFD', '?').trim(), LIMITE_DO_RESUMO)
  if (summary === '') return false
  const atual = store.getWorkDraft(projectId, AGENTE_AUTOMATICO, null)
  store.saveWorkDraft(projectId, {
    agent: AGENTE_AUTOMATICO,
    expectedVersion: atual?.version ?? 0,
    summary,
    nextAction: PROXIMO_PASSO_AUTOMATICO,
    changedAreas: [],
    openIssues: [],
  })
  return true
}

/** Spec 7.2: a sessão que terminou com um registro gravado depois do último pedido não precisa de rede de segurança. */
function terminouComRegistro(store: WorkspaceStore, projectId: string, fim: FimDaConversa): boolean {
  // Sem hora do último pedido, `Date.parse('')` é NaN e nenhuma comparação passa: o registro não impede.
  const ultimoPedido = Date.parse(fim.ultimoPedidoEm)
  return store.getProject(projectId).checkpoints.some((c) => Date.parse(c.createdAt) >= ultimoPedido)
}

/** Guarda o fim da conversa se a sessão passou do mínimo (spec 13.3). Devolve se gravou. */
function guardarConversa(store: WorkspaceStore, projectId: string, transcriptPath: string | undefined): boolean {
  const fim = lerFimDaConversa(transcriptPath, LIMITE_DO_RESUMO)
  if (fim.pedidosDoDono < MINIMO_DE_PEDIDOS || fim.usosDeFerramenta < MINIMO_DE_FERRAMENTAS) return false
  if (terminouComRegistro(store, projectId, fim)) return false
  // D6: o fim da conversa cede espaço para a seção dos pedidos do dono (guarda o final da conversa).
  return gravarRascunhoAutomatico(store, projectId, juntarComPedidos(fim.texto, fim.pedidos, LIMITE_DO_RESUMO, cortarFimSemPartir))
}

/** Recusa da validação (400) não muda tentando de novo: insistir faria cada abertura repetir a mesma recusa. */
function ehRecusaPermanente(erro: unknown): boolean {
  return erro instanceof DomainError && erro.status === 400
}

/**
 * Guarda o fim da conversa de uma sessão e apaga o marcador dela. Recusa permanente: o marcador sai
 * também e a recusa fica registrada com o motivo. Outro erro sobe e o marcador fica para a próxima.
 */
function guardarEApagarMarcador(
  a: Ambiente,
  projeto: Project,
  tipo: 'fechar' | 'recuperar',
  sessionId: string,
  transcriptPath: string | undefined,
): void {
  let gravou: boolean
  try {
    gravou = guardarConversa(a.store, projeto.id, transcriptPath)
  } catch (erro) {
    if (!ehRecusaPermanente(erro)) throw erro
    apagarMarcador(a.dirMarcadores, sessionId)
    registrarSemAtrapalhar(a.store, projeto.id, { tipo, ok: false, detalhe: mensagemDoErro(erro) })
    return
  }
  apagarMarcador(a.dirMarcadores, sessionId)
  if (gravou) registrarSemAtrapalhar(a.store, projeto.id, { tipo, ok: true, detalhe: null })
}

// ---------------------------------------------------------------------------------------------
// Recuperar sessões que fecharam sem SessionEnd (spec 13.4)
// ---------------------------------------------------------------------------------------------

function ehDeOutraSessaoDoProjeto(m: MarcadorDeSessao, e: EntradaDoGancho, projetos: Project[], projeto: Project): boolean {
  return m.sessionId !== e.session_id && acharProjetoPorPasta(projetos, m.pasta)?.id === projeto.id
}

function recuperar(a: Ambiente, projeto: Project, m: MarcadorDeSessao): void {
  try {
    guardarEApagarMarcador(a, projeto, 'recuperar', m.sessionId, m.transcriptPath)
  } catch (erro) {
    // O marcador fica: a próxima abertura tenta de novo.
    registrarSemAtrapalhar(a.store, projeto.id, { tipo: 'recuperar', ok: false, detalhe: mensagemDoErro(erro) })
  }
}

function recuperarSessoesAbertas(e: EntradaDoGancho, a: Ambiente, projetos: Project[], projeto: Project): void {
  const agora = a.agora()
  for (const m of listarMarcadores(a.dirMarcadores)) {
    // `&&` curto-circuita: a conversa só é consultada no disco para marcador de outra sessão do projeto.
    if (ehDeOutraSessaoDoProjeto(m, e, projetos, projeto) && sessaoParada(m, dataDaConversa(m.transcriptPath), agora)) {
      recuperar(a, projeto, m)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// As quatro ações
// ---------------------------------------------------------------------------------------------

/**
 * Com o projeto já conhecido, uma falha vira evento de saúde (a tela mostra) e a sessão recebe ''.
 * Antes de conhecer o projeto (lista de projetos ilegível), o erro sobe e `principal.ts` o engole.
 */
function protegido(a: Ambiente, projeto: Project, tipo: EventoDeIntegracao['tipo'], fazer: () => string): string {
  try {
    return fazer()
  } catch (erro) {
    registrarSemAtrapalhar(a.store, projeto.id, { tipo, ok: false, detalhe: mensagemDoErro(erro) })
    return ''
  }
}

function retomada(e: EntradaDoGancho, a: Ambiente, projetos: Project[], projeto: Project): string {
  recuperarSessoesAbertas(e, a, projetos, projeto)
  const carta = montarCarta(lerDadosDaCarta(a.store, projeto.id), a.agora())
  const texto = renderizarRetomadaCompacta(carta, lerExtrasDaRetomada(a.store, projeto.id, e.source === 'compact', a.git ?? null))
  registrarSemAtrapalhar(a.store, projeto.id, { tipo: 'abrir', ok: true, detalhe: null })
  return texto
}

/**
 * D1: onde e desde quando olhar o git. Pasta não conectada ou projeto sem registro: `null`, e o git
 * nem roda (sem registro não há "depois do registro mais recente").
 */
export function alvoDoGit(a: Ambiente): { pasta: string; desde: string } | null {
  const projeto = projetoDaPasta(a)
  if (projeto === null) return null
  // O store devolve os registros em ordem de revisão: o último é o mais recente.
  const ultimo = a.store.getProject(projeto.id).checkpoints.at(-1)
  return ultimo === undefined ? null : { pasta: a.pastaDoProjeto, desde: ultimo.createdAt }
}

/** D1: o estado do git para a abertura. Qualquer falha (banco, git) vira `null`: nunca atrapalha a sessão. */
export async function gitDaAbertura(a: Ambiente, lerGit: LerGit): Promise<EstadoDoGit | null> {
  let alvo: { pasta: string; desde: string } | null
  try {
    alvo = alvoDoGit(a)
  } catch {
    return null
  }
  return alvo === null ? null : lerGit(alvo.pasta, alvo.desde).catch(() => null)
}

/** SessionStart (startup, resume, clear e compact): imprime a retomada do projeto da pasta. */
export function aoAbrir(e: EntradaDoGancho, a: Ambiente): string {
  const projetos = a.store.listProjects()
  const projeto = projetoDaPasta(a, projetos)
  if (projeto === null) return ''
  return protegido(a, projeto, 'abrir', () => retomada(e, a, projetos, projeto))
}

/** PostCompact: guarda o resumo da compactação como rascunho automático, com os pedidos do dono no fim. */
export function aoCompactar(e: EntradaDoGancho, a: Ambiente): string {
  const projeto = projetoDaPasta(a)
  if (projeto === null) return ''
  return protegido(a, projeto, 'compactar', () => {
    // D6: os pedidos do dono vêm da conversa (se o caminho veio); o resumo guarda o começo e cede o fim.
    const { pedidos } = lerFimDaConversa(e.transcript_path, LIMITE_DO_RESUMO)
    const resumo = juntarComPedidos(e.compact_summary ?? '', pedidos, LIMITE_DO_RESUMO, cortarInicioSemPartir)
    if (gravarRascunhoAutomatico(a.store, projeto.id, resumo)) {
      registrarSemAtrapalhar(a.store, projeto.id, { tipo: 'compactar', ok: true, detalhe: null })
    }
    return ''
  })
}

/** Stop (a cada resposta): só o marcador em arquivo; nunca escreve no banco. */
export function aoResponder(e: EntradaDoGancho, a: Ambiente): string {
  if (!e.transcript_path || projetoDaPasta(a) === null) return ''
  gravarMarcador(a.dirMarcadores, {
    sessionId: e.session_id,
    transcriptPath: e.transcript_path,
    pasta: a.pastaDoProjeto,
    atualizadoEm: a.agora().toISOString(),
  })
  return ''
}

/** O caminho da conversa vem na entrada; se faltar, vale o que o `Stop` desta sessão guardou no marcador. */
function caminhoDaConversa(e: EntradaDoGancho, a: Ambiente): string | undefined {
  const doMarcador = listarMarcadores(a.dirMarcadores).find((m) => m.sessionId === e.session_id)
  return e.transcript_path || doMarcador?.transcriptPath
}

/**
 * SessionEnd: guarda o fim da conversa se passou do mínimo e apaga o marcador. Falha que pode passar:
 * o marcador fica; recusa permanente da validação: o marcador sai e a recusa fica registrada.
 */
export function aoFechar(e: EntradaDoGancho, a: Ambiente): string {
  const projeto = projetoDaPasta(a)
  if (projeto === null) return ''
  return protegido(a, projeto, 'fechar', () => {
    guardarEApagarMarcador(a, projeto, 'fechar', e.session_id, caminhoDaConversa(e, a))
    return ''
  })
}
