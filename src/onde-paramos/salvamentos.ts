// Helpers puros da seção "Salvamentos de compactação" da tela "Onde paramos" (D5).
// Sem React, sem relógio e sem rede. As horas aparecem no horário do navegador de quem lê.
// O que é para o dono (a frase, os pedidos, as pendências, as perguntas) fica à vista; o resumo técnico
// e os arquivos mexidos ficam na parte recolhida "Detalhes técnicos".
import type { SalvamentoResumo } from '../../shared/carta.ts'
import { diaEMes } from './texto.ts'

/** Sem frase para o dono (dado importado), o texto principal diz isso e aponta os detalhes técnicos. */
const SEM_FRASE = 'Este salvamento não tem um resumo escrito para você. O estado completo está em “Detalhes técnicos”.'

export interface ListaDoSalvamento {
  titulo: string
  itens: string[]
}

function doisDigitos(numero: number): string {
  return String(numero).padStart(2, '0')
}

/** "25/10 às 14:05": dois salvamentos do mesmo dia se distinguem pela hora. */
export function horaDoSalvamento(iso: string): string {
  const data = new Date(iso)
  return `${diaEMes(iso)} às ${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`
}

/** Linha do salvamento recolhido: quando foi salvo e a frase para o dono; sem frase (nula ou vazia), só a data. */
export function rotuloDoSalvamento(salvamento: SalvamentoResumo): string {
  const hora = horaDoSalvamento(salvamento.criadoEm)
  return salvamento.humanSummary ? `${hora} · ${salvamento.humanSummary}` : `Salvamento de ${hora}`
}

/** O texto principal do salvamento aberto: a frase para o dono. */
export function fraseDoSalvamento(salvamento: SalvamentoResumo): string {
  return salvamento.humanSummary || SEM_FRASE
}

/** As listas do dono no salvamento aberto, na ordem de leitura dele; lista vazia não aparece. */
export function listasDoSalvamento(salvamento: SalvamentoResumo): ListaDoSalvamento[] {
  const listas: ListaDoSalvamento[] = [
    { titulo: 'Pedidos do dono', itens: salvamento.pedidosDoDono },
    { titulo: 'Pendências', itens: salvamento.pendencias },
    { titulo: 'Perguntas abertas', itens: salvamento.perguntasAbertas },
  ]
  return listas.filter((lista) => lista.itens.length > 0)
}
