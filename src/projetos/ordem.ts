/**
 * A ordem dos projetos: a mesma na lista da tela de Projetos e na barra lateral (favoritos primeiro, depois o critério).
 * Os favoritos ficam neste computador, na chave `axon-pins`.
 */
export const CHAVE_DOS_FAVORITOS = 'axon-pins'

export type CriterioDeOrdem = 'recent' | 'name'

export interface ArmazemDeLeitura { getItem(chave: string): string | null }

export function lerFavoritos(armazem: ArmazemDeLeitura | undefined): string[] {
  try {
    const valor: unknown = JSON.parse(armazem?.getItem(CHAVE_DOS_FAVORITOS) || '[]')
    return Array.isArray(valor) ? valor.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function alternarFavorito(favoritos: readonly string[], id: string): string[] {
  return favoritos.includes(id) ? favoritos.filter(item => item !== id) : [...favoritos, id]
}

export function ordenarProjetos<T extends { id: string; name: string; updatedAt: string }>(projetos: readonly T[], favoritos: readonly string[], criterio: CriterioDeOrdem): T[] {
  return [...projetos].sort((a, b) => {
    const favoritoPrimeiro = Number(favoritos.includes(b.id)) - Number(favoritos.includes(a.id))
    if (favoritoPrimeiro) return favoritoPrimeiro
    return criterio === 'name' ? a.name.localeCompare(b.name, 'pt-BR') : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
}
