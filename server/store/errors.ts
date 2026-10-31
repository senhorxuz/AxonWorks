/**
 * Erro de domínio com status HTTP e código estável. Usado por toda a camada de
 * armazenamento — os 33 helpers de validação e os 95 métodos de domínio de
 * `WorkspaceStore` — para sinalizar entrada inválida, conflito de concorrência
 * ou recurso ausente de forma uniforme.
 *
 * Vive em módulo próprio (não em `validation.ts` nem em `store.ts`) porque não
 * é conceito exclusivo de validação: os métodos de domínio o lançam para
 * conflitos de revisão, lease e idempotência, bem além de checagem de entrada.
 * Extraído de server/store.ts para que `validation.ts`, `mappers.ts` e
 * `constants.ts` não precisem importar de volta de `store.ts` — quebra o
 * ciclo de import pela raiz.
 */
export class DomainError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.status = status
    this.code = code
  }
}
