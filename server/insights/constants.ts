/**
 * Limites de tempo e contagem usados pelas regras de `server/insights/compute.ts`.
 *
 * Cada um é uma escolha de critério, não um valor mágico — o comentário ao lado
 * explica por quê, para quem for ajustar amanhã.
 */

/**
 * Tolerância depois do vencimento do lease de uma tarefa antes de marcá-la como
 * "sumida". Um agente pode estar terminando de gravar o checkpoint no instante
 * exato em que o prazo expira; 5 minutos é menos que o menor lease permitido
 * (30s a 3600s, ver DEFAULT_LEASE_SECONDS em server/store.ts) e evita alarme
 * falso por um atraso de poucos segundos.
 */
export const STALLED_LEASE_GRACE_MS = 5 * 60 * 1000

/**
 * Janela em que a conclusão de uma dependência ainda é "notícia" para quem
 * poderia começar a tarefa liberada por ela. Depois de 24h, a liberação deixa
 * de ser uma novidade acionável — vira apenas o estado normal do backlog.
 */
export const DEPENDENCY_UNLOCK_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Tempo sem desfecho que transforma uma pergunta, um pedido de revisão ou uma
 * passagem pendente em algo que exige atenção. Abaixo disso é normal ainda não
 * ter resposta — ninguém está de plantão 24 horas. 6 horas cobre um turno de
 * trabalho inteiro sem sinalizar como problema uma pergunta feita há 20 minutos.
 */
export const ATTENTION_AGING_MS = 6 * 60 * 60 * 1000

/**
 * A partir de quantas reaberturas no histórico de uma tarefa o padrão deixa de
 * ser um ajuste pontual (a primeira reabertura é normal: bloqueou, resolveu,
 * retomou) e passa a indicar retrabalho.
 */
export const REWORK_REOPEN_THRESHOLD = 2

export const DAY_MS = 24 * 60 * 60 * 1000
export const WEEK_MS = 7 * DAY_MS
