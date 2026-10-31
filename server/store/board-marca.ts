import type { DatabaseSync } from 'node:sqlite'
import { DomainError } from './errors.js'

/**
 * Marca "depende de você" do cartão: o cartão espera uma decisão ou uma ação do dono.
 * Regra própria, fora de `board.ts`, para o arquivo do quadro receber só ligação.
 */

export const FRASE_MARCOU = 'Marcou como dependente do dono'
export const FRASE_DESMARCOU = 'Tirou a marca de dependente do dono'

/** Coluna criada em bancos que já tinham cartões; bancos novos recebem a mesma coluna pelo mesmo caminho. */
export function garantirColunaDaMarca(db: DatabaseSync): void {
  const colunas = db.prepare('PRAGMA table_info(board_cards)').all() as Array<{ name: string }>
  if (colunas.some((coluna) => coluna.name === 'needs_owner')) return
  db.exec('ALTER TABLE board_cards ADD COLUMN needs_owner INTEGER NOT NULL DEFAULT 0')
}

/**
 * Valor da marca depois do pedido. Campo ausente mantém o valor atual (`atual`);
 * qualquer coisa que não seja verdadeiro ou falso é recusada.
 */
export function resolverMarca(valor: unknown, atual: boolean): boolean {
  if (valor === undefined) return atual
  if (typeof valor !== 'boolean') {
    throw new DomainError(400, 'invalid_input', 'Campo needsOwner inválido. Use true ou false.')
  }
  return valor
}

/** Frase para o histórico do cartão: vazia quando a marca não mudou. */
export function frasesDaMarca(antes: boolean, depois: boolean): string[] {
  if (antes === depois) return []
  return [depois ? FRASE_MARCOU : FRASE_DESMARCOU]
}
