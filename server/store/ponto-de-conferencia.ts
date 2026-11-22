import { DomainError } from './errors.js'
import { asRecord, requireString } from './validation.js'

export interface PontoDeConferencia {
  commit?: string
  ambiente?: string
  onde?: string
  comoConferir: string
  seNaoBater?: string
}

export type ComPontoDeConferencia<T> = T & { pontoDeConferencia?: PontoDeConferencia }

export function normalizarPontoDeConferencia(valor: unknown): PontoDeConferencia | undefined {
  if (valor === undefined) return undefined
  const entrada = asRecord(valor, 'pontoDeConferencia')
  if (entrada.comoConferir === undefined || (typeof entrada.comoConferir === 'string' && entrada.comoConferir.trim() === '')) {
    throw new DomainError(400, 'como_conferir_obrigatorio', 'O ponto de conferência exige o campo comoConferir.')
  }
  const ponto: PontoDeConferencia = {
    comoConferir: requireString(entrada.comoConferir, 'pontoDeConferencia.comoConferir', 1, 8000),
  }
  for (const campo of ['commit', 'ambiente', 'onde', 'seNaoBater'] as const) {
    if (entrada[campo] !== undefined) ponto[campo] = requireString(entrada[campo], `pontoDeConferencia.${campo}`, 1, 8000)
  }
  return ponto
}

export function campoDoPontoDeConferencia(pontoDeConferencia: PontoDeConferencia | undefined): ComPontoDeConferencia<object> {
  return pontoDeConferencia === undefined ? {} : { pontoDeConferencia }
}

export function gravarPontoDeConferencia(ponto: PontoDeConferencia | undefined): string | null {
  return JSON.stringify(ponto) ?? null
}

export function lerPontoDeConferencia(json: string | null): ComPontoDeConferencia<object> {
  if (json === null) return {}
  return { pontoDeConferencia: JSON.parse(json) as PontoDeConferencia }
}

export function anteporPontoDeConferencia(ponto: PontoDeConferencia | undefined, narrativa: string): string {
  if (ponto === undefined) return narrativa
  const partida = [
    ponto.commit === undefined ? undefined : `commit ${ponto.commit}`,
    ponto.ambiente,
    ponto.onde,
  ].filter((parte) => parte !== undefined)
  const linhas: string[] = []
  if (partida.length > 0) linhas.push(`Ponto de partida: ${partida.join(' · ')}.`)
  linhas.push(`Para conferir: ${ponto.comoConferir}`)
  if (ponto.seNaoBater !== undefined) linhas.push(`Se não bater: ${ponto.seNaoBater}`)
  if (narrativa !== '') linhas.push('', narrativa)
  return linhas.join('\n')
}

export function passagemParaLeitura<T extends { message: string; checkpoint: { nextStep: string } }>(
  passagem: ComPontoDeConferencia<T>,
): ComPontoDeConferencia<T> {
  if (passagem.pontoDeConferencia === undefined) return passagem
  return {
    ...passagem,
    message: anteporPontoDeConferencia(passagem.pontoDeConferencia, passagem.message || passagem.checkpoint.nextStep),
  }
}
