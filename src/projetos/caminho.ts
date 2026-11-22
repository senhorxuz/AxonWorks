const BARRA = '\\'

/** Caminhos gravados com barras invertidas dobradas (C:\\Users\\...) aparecem com barras simples. */
export function caminhoParaExibir(caminho: string): string {
  const grupos = caminho.match(/\\+/g)
  const todosDobrados = grupos !== null && grupos.every(grupo => grupo.length % 2 === 0)
  return todosDobrados ? caminho.replace(/\\{2}/g, BARRA) : caminho
}
