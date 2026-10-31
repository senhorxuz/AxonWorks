// O que a retomada compacta leva além da carta (spec 7.4 e 13.5): decisões vigentes, mensagens e
// passagens não lidas para o Claude, tarefas do Claude, evidências desatualizadas, lições (lote 2, D4)
// e o aviso de trabalho não registrado (D1, do estado do git lido antes). Só leitura.
import { fraseDoTrabalhoNaoRegistrado } from '../carta/avisos.js'
import type { ExtrasRetomada } from '../carta/retomada-compacta.js'
import type { WorkspaceStore } from '../store.js'
import type { ProjectDetail, TaskStatus } from '../../shared/types.js'
import type { EstadoDoGit } from './git.js'

/**
 * Identidade do Claude: todo agente cujo nome começa com "claude", sem diferenciar maiúsculas.
 * Sem nome (`null`, tarefa sem responsável) nunca é o Claude: `String(null)` é "null".
 */
export function ehClaude(nome: string | null): nome is string {
  return /^claude/i.test(String(nome))
}

/** Tarefas reservadas pelo Claude: as que ele pegou (em andamento) ou declarou travadas mantendo a reserva. */
const ESTADO_DA_TAREFA: Partial<Record<TaskStatus, string>> = {
  in_progress: 'em andamento',
  blocked: 'travada',
}

/** "Claude" sempre (é por ele que chegam os avisos gerais) e todo outro nome de Claude que aparece no projeto. */
function nomesDoClaude(detalhe: ProjectDetail): string[] {
  const nomes = [
    'Claude',
    ...detalhe.messages.map((mensagem) => mensagem.to),
    ...detalhe.tasks.map((tarefa) => tarefa.assignee),
  ]
  return [...new Set(nomes.filter(ehClaude))]
}

type Mensagem = ExtrasRetomada['mensagensNaoLidas'][number]

interface Recebido {
  id: string
  de: string
  para: string
  texto: string
}

function mensagensNaoLidas(store: WorkspaceStore, projectId: string, nomes: string[]): Mensagem[] {
  const vistas = new Set<string>()
  const saida: Mensagem[] = []
  const acrescentar = (recebido: Recebido): void => {
    // O aviso geral que o próprio Claude mandou não é novidade para ele.
    if (vistas.has(recebido.id) || (recebido.para === '*' && ehClaude(recebido.de))) return
    vistas.add(recebido.id)
    saida.push({ de: recebido.de, texto: recebido.texto })
  }
  for (const nome of nomes) {
    for (const { message: m } of store.getInbox(projectId, nome, { unreadOnly: true })) {
      acrescentar({ id: m.id, de: m.from, para: m.to, texto: m.body })
    }
    for (const d of store.getHandoffDeliveries(projectId, nome, { unreadOnly: true })) {
      acrescentar({ id: d.id, de: d.from, para: d.to, texto: d.message || d.checkpoint.summary })
    }
  }
  return saida
}

function tarefasDoClaude(detalhe: ProjectDetail): ExtrasRetomada['tarefasDoClaude'] {
  return detalhe.tasks
    .filter((tarefa) => ESTADO_DA_TAREFA[tarefa.status] !== undefined && ehClaude(tarefa.assignee))
    .map((tarefa) => ({ titulo: tarefa.title, estado: ESTADO_DA_TAREFA[tarefa.status]! }))
}

/** D1: sem estado do git (não lido, falhou ou demorou), nenhum aviso. */
function avisosDoGit(git: EstadoDoGit | null): string[] {
  const frase = git === null ? null : fraseDoTrabalhoNaoRegistrado(git)
  return frase === null ? [] : [frase]
}

export function lerExtrasDaRetomada(
  store: WorkspaceStore,
  projectId: string,
  posCompactacao: boolean,
  git: EstadoDoGit | null = null,
): ExtrasRetomada {
  const detalhe = store.getProject(projectId)
  return {
    // Sem `includeHistory`, o store devolve só as aceitas; as propostas já vão em "precisa do dono".
    decisoesVigentes: store.listDecisions(projectId).map((decisao) => ({ titulo: decisao.title })),
    // Bloqueios abertos já vão na carta, em "travado"; repetir aqui gastaria espaço com o mesmo item.
    bloqueiosAbertos: [],
    mensagensNaoLidas: mensagensNaoLidas(store, projectId, nomesDoClaude(detalhe)),
    tarefasDoClaude: tarefasDoClaude(detalhe),
    evidenciasDesatualizadas: store.listEvidence(projectId, { staleOnly: true }).length,
    posCompactacao,
    // Sem `incluirAposentadas`: só as ativas, do projeto e as globais. O store devolve da mais antiga
    // para a mais nova (data e, no empate, ordem de gravação); a retomada quer a mais nova primeiro,
    // porque leva só as `LICOES_NA_RETOMADA` primeiras.
    licoes: store
      .listarLicoes(projectId)
      .reverse()
      .map((licao) => ({ texto: licao.texto })),
    avisos: avisosDoGit(git),
  }
}
