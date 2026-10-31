/**
 * Busca na memória (lote 2, D7), lado do banco: a consulta no índice da memória (que também guarda a
 * biblioteca) e a leitura do texto só dos resultados finais. A regra (consulta, pesos, título e trecho)
 * mora em `consultar.ts`; o índice, em `indice.ts`.
 *
 * O `CROSS JOIN` fixa a ordem: primeiro o FTS5 acha as linhas, depois cada uma busca o item pelo rowid.
 * Sem ele, o planejador pode inverter a junção e rodar o MATCH uma vez por item (medido: de 18 ms para
 * 19 s com 10 mil itens). A pontuação já sai pesada e ordenada do SQL (maior primeiro; empate: o mais
 * recente; empate total: o gravado primeiro), com `LIMIT`, para não ler 10 mil linhas quando o termo é comum.
 */
import type { DatabaseSync } from 'node:sqlite'
import {
  expressaoFts,
  formasDoTermo,
  paraResultado,
  validarBusca,
  type Candidato,
  type ResultadoDaBusca,
} from './consultar.js'

/**
 * Os resultados da busca no projeto (mais as lições globais), do mais relevante para o menos. Quem chama
 * confere que o projeto existe e abre a transação de leitura.
 */
export function buscarNaMemoria(db: DatabaseSync, projectId: string, input: unknown): ResultadoDaBusca[] {
  const busca = validarBusca(input)
  if (busca.termos.length === 0) return []
  const formas = busca.termos.flatMap(formasDoTermo)
  const candidatos = db
    .prepare(
      `SELECT i.tipo AS tipo, i.fonte_id AS id, i.data AS data,
              -(bm25(memoria_fts) * i.peso) AS pontuacao, memoria_fts.rowid AS linha
       FROM memoria_fts CROSS JOIN memoria_itens i ON i.id = memoria_fts.rowid
       WHERE memoria_fts MATCH ? AND (i.project_id = ? OR i.project_id IS NULL)
         AND i.tipo IN (${busca.tipos.map(() => '?').join(', ')})
       ORDER BY pontuacao DESC, i.data DESC, i.id
       LIMIT ?`,
    )
    .all(expressaoFts(busca.termos), projectId, ...busca.tipos, busca.limite) as unknown as Candidato[]
  const texto = db.prepare('SELECT titulo, corpo FROM memoria_fts WHERE rowid = ?')
  return candidatos.map((candidato) =>
    paraResultado(candidato, texto.get(candidato.linha) as { titulo: string; corpo: string }, formas),
  )
}
