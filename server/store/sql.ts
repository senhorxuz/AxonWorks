/**
 * Forma bruta de um valor e de uma linha devolvidos por `node:sqlite`. Usado
 * pelos 33 helpers de validação/leitura (`text`, `nullableText`, `numberish`),
 * pelos 21 mappers (`map*(row: SqlRow)`) e pelos 95 métodos de domínio de
 * `WorkspaceStore` ao converter resultado de query em tipo de domínio.
 *
 * Vive em módulo próprio, sem depender de nada, para que `validation.ts` e
 * `mappers.ts` não precisem importar de `store.ts` só para tipar uma linha.
 */
export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlRow = Record<string, SqlValue>
