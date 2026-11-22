/**
 * O resumo da diretriz na Visão geral: a primeira frase do objetivo, a versão vigente e o aviso de conferência.
 * As contas são puras; quem desenha é ./ResumoDaDiretriz.tsx.
 */
import type { CharterRevision } from '../../shared/continuity'
import { mancheteDe, secoesDe, separarObjetivo } from './secoes'
import { dataPorExtenso, estadoDaDiretriz } from './versoes'

type Vigente = Pick<CharterRevision, 'revision' | 'createdAt' | 'sourceKind' | 'body' | 'vistoPeloDonoEm'>

export interface ResumoDaDiretriz { frase: string; versao: string; pendente: boolean; aviso: string }

export const SEM_DIRETRIZ = 'Nenhuma diretriz definida ainda.'
export const DIRETRIZ_EM_BRANCO = 'A diretriz está em branco.'

/** A primeira frase do objetivo; sem seção de objetivo, a da primeira seção. */
function primeiraFrase(body: string, nomeDoProjeto: string): string {
  const secoes = secoesDe(body)
  const { objetivo } = separarObjetivo(secoes)
  const base = objetivo ?? secoes[0]
  if (!base) return DIRETRIZ_EM_BRANCO
  return mancheteDe(base, nomeDoProjeto).lide || DIRETRIZ_EM_BRANCO
}

export function resumoDaDiretriz(vigente: Vigente | null, nomeDoProjeto: string): ResumoDaDiretriz {
  if (!vigente) return { frase: SEM_DIRETRIZ, versao: '', pendente: false, aviso: '' }
  const estado = estadoDaDiretriz(vigente)
  return {
    frase: primeiraFrase(vigente.body, nomeDoProjeto),
    versao: `Versão ${vigente.revision} · vigente desde ${dataPorExtenso(vigente.createdAt)}`,
    pendente: estado.pendente,
    aviso: estado.pendente ? estado.texto : '',
  }
}
