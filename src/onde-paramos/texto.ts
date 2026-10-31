// Helpers puros da tela "Onde paramos": datas, frases e arrumação dos grupos.
// Sem React, sem relógio e sem rede: quem decide "agora" é o servidor (a carta já traz `diasParado`).
// As datas aparecem no horário do navegador de quem lê.
import { DIAS_PARA_ABRIR_CARTA, type Carta, type GrupoFalta, type ItemFalta, type MesFeito, type OrigemItem } from '../../shared/carta.ts'

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]
const MS_POR_DIA = 86_400_000
/** O projeto andou, mas a conexão ficou calada por tantos dias: a linha de saúde avisa. */
const DIAS_SEM_REGISTRO_PARA_AVISAR = 2
/** O servidor só aceita nome de ator de até 80 caracteres. */
const LIMITE_DO_ATOR = 80
const LIMITE_DO_ERRO = 160

const ROTULO_DA_ORIGEM: Record<OrigemItem, string> = {
  cartao: 'Cartão do quadro',
  tarefa: 'Tarefa',
  backlog: 'Backlog',
  aprovacao: 'Aprovação pendente',
  decisao: 'Decisão proposta',
  bloqueio: 'Bloqueio',
}

/** Os cinco grupos de "O que falta", na ordem em que o dono lê. Ideias ficam recolhidas (só a contagem). */
const GRUPOS: ReadonlyArray<{ id: GrupoFalta; titulo: string; recolhido: boolean }> = [
  { id: 'precisa_de_voce', titulo: 'Precisa de você', recolhido: false },
  { id: 'travado', titulo: 'Travado', recolhido: false },
  { id: 'em_andamento', titulo: 'Em andamento', recolhido: false },
  { id: 'a_fazer', titulo: 'A fazer', recolhido: false },
  { id: 'ideias', titulo: 'Ideias guardadas', recolhido: true },
]

export interface GrupoDaTela {
  id: GrupoFalta
  titulo: string
  recolhido: boolean
  itens: ItemFalta[]
}

// ---------------------------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------------------------

export function formatarHaDias(dias: number): string {
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}

/** 'YYYY-MM' (UTC, como vem da carta) vira "outubro de 2026". O que não for assim volta como veio. */
export function nomeDoMes(mes: string): string {
  const partes = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes)
  if (partes === null) return mes
  return `${MESES[Number(partes[2]) - 1]} de ${partes[1]}`
}

function ehData(data: Date): boolean {
  return !Number.isNaN(data.getTime())
}

/** "17 de outubro de 2026". Texto que não é data volta como veio. */
export function dataPorExtenso(iso: string): string {
  const data = new Date(iso)
  if (!ehData(data)) return iso
  return `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`
}

function doisDigitos(numero: number): string {
  return String(numero).padStart(2, '0')
}

/** "25/10". */
export function diaEMes(iso: string): string {
  const data = new Date(iso)
  return `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}`
}

/** Linha "Última vez aqui: ..." do alto da carta. */
export function ultimaVezAqui(ultimaAtividade: string | null, diasParado: number | null): string {
  if (ultimaAtividade === null) return 'Ainda não há atividade registrada neste projeto.'
  const quando = diasParado === null ? '' : ` (${formatarHaDias(diasParado)})`
  return `Última vez aqui: ${dataPorExtenso(ultimaAtividade)}${quando}`
}

/** Projeto parado há 7 dias ou mais abre pela carta; antes disso, na aba de sempre. Sem atividade, conta como 0 dias. */
export function abaInicial(diasParado: number | null): 'carta' | 'overview' {
  return (diasParado ?? 0) >= DIAS_PARA_ABRIR_CARTA ? 'carta' : 'overview'
}

// ---------------------------------------------------------------------------------------------
// Frases
// ---------------------------------------------------------------------------------------------

export function fraseParaContinuar(nomeDoProjeto: string): string {
  return `Retome o projeto ${nomeDoProjeto} de onde paramos.`
}

export function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`
}

/** Texto que cabe em `limite` volta inteiro; o resto sai cortado, com reticências, em no máximo `limite` caracteres. */
export function cortarTexto(texto: string, limite: number): string {
  if (texto.length <= limite) return texto
  return `${texto.slice(0, limite - 1).trimEnd()}…`
}

function fechaComPontuacao(texto: string): string {
  return /[.!?…]$/.test(texto) ? texto : `${texto}.`
}

function fraseDoRegistro(registro: string | null, ultimaAtividade: string | null): string | null {
  if (registro === null) return null
  // Sem atividade registrada, nada andou depois do registro: a diferença é zero e não há aviso.
  const depoisDoRegistro = Date.parse(ultimaAtividade ?? registro) - Date.parse(registro)
  if (depoisDoRegistro >= DIAS_SEM_REGISTRO_PARA_AVISAR * MS_POR_DIA) return `A conexão com o Claude não registrou nada desde ${diaEMes(registro)}.`
  return `Último registro automático em ${diaEMes(registro)}, ${new Date(registro).getHours()}h.`
}

function fraseDoErro(erro: string | null): string | null {
  if (erro === null) return null
  return `Último erro da conexão: ${fechaComPontuacao(cortarTexto(erro, LIMITE_DO_ERRO))}`
}

/** Linha de saúde da conexão com o Claude. Sem nenhum dado, `null`: a linha não aparece. */
export function linhaDeSaude(saude: Carta['saude'], ultimaAtividade: string | null): string | null {
  const frases = [fraseDoRegistro(saude.ultimoRegistroAutomatico, ultimaAtividade), fraseDoErro(saude.ultimoErro)]
  const presentes = frases.filter((frase) => frase !== null)
  return presentes.length === 0 ? null : presentes.join(' ')
}

// ---------------------------------------------------------------------------------------------
// Grupos e itens
// ---------------------------------------------------------------------------------------------

/** Só os grupos com itens, na ordem do produto. */
export function gruposDaFalta(falta: Carta['falta']): GrupoDaTela[] {
  return GRUPOS.filter((grupo) => falta[grupo.id].length > 0).map((grupo) => ({ ...grupo, itens: falta[grupo.id] }))
}

export function rotuloDaOrigem(origem: OrigemItem): string {
  return ROTULO_DA_ORIGEM[origem]
}

/** Aprovação não se responde por aqui: a dica diz onde. */
export function dicaDoItem(item: ItemFalta): string | null {
  return item.origem === 'aprovacao' ? 'Responda na Visão geral, em "Esperando por você".' : null
}

/** A etapa do cartão só importa em "Em andamento" (nos outros grupos ela repete o nome do grupo). */
export function etapaDoItem(grupo: GrupoFalta, item: ItemFalta): string | null {
  return grupo === 'em_andamento' ? item.etapa : null
}

export function rotuloDoMes(mes: MesFeito): string {
  return `${nomeDoMes(mes.mes)} · ${contar(mes.itens.length, 'item', 'itens')}`
}

// ---------------------------------------------------------------------------------------------
// Confirmação de decisão
// ---------------------------------------------------------------------------------------------

/** O botão "Confirmar decisão" é só das decisões propostas (com a versão que o servidor exige). */
export function podeConfirmar(item: ItemFalta): item is ItemFalta & { versao: number } {
  return item.origem === 'decisao' && item.versao !== null
}

/** Quem assina a confirmação: a conta logada (modo servidor); sem conta, "Dono". */
export function atorDaConfirmacao(conta: { displayName: string; username: string } | null): string {
  const nome = conta?.displayName.trim() || conta?.username.trim() || 'Dono'
  return nome.slice(0, LIMITE_DO_ATOR)
}
