// Acha o projeto da Axon ligado à pasta da sessão do Claude Code (spec 7.1).
// "Conectado" = existe projeto cuja pasta de trabalho é a pasta da sessão ou uma pasta acima dela.
import type { Project } from '../../shared/types.js'

/** Minúsculas, `/` no lugar de `\`, barras repetidas viram uma, sem barra no fim. */
export function normalizarPasta(pasta: string): string {
  return pasta.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()
}

function casa(pastaDoProjeto: string, pastaDaSessao: string): boolean {
  return pastaDaSessao === pastaDoProjeto || pastaDaSessao.startsWith(`${pastaDoProjeto}/`)
}

/** A pasta mais específica vence; pasta de trabalho vazia nunca casa; empate fica com o primeiro. */
export function acharProjetoPorPasta(projetos: Project[], pasta: string): Project | null {
  const sessao = normalizarPasta(pasta)
  let melhor: { projeto: Project; tamanho: number } | null = null
  for (const projeto of projetos) {
    const doProjeto = normalizarPasta(projeto.workspacePath)
    if (doProjeto === '' || !casa(doProjeto, sessao)) continue
    if (melhor === null || doProjeto.length > melhor.tamanho) melhor = { projeto, tamanho: doProjeto.length }
  }
  return melhor?.projeto ?? null
}
