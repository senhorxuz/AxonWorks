/**
 * Da diretriz escrita à diretriz desenhada: as contas, sem tela.
 *
 * Uma linha só em MAIÚSCULAS é o título de uma seção; o que vem depois é o corpo dela. Cada frase (ou cada
 * item de lista) vira uma linha da seção; o título dá o tom (o que nunca se faz, quando está pronto...).
 */

export interface Secao { titulo: string; texto: string }
export type Tom = 'nunca' | 'pronto' | 'risco' | 'como' | ''

/** Linha só com maiúsculas (e espaços, vírgulas, acentos), com letra e sem pontuação final. */
export function ehTitulo(linha: string): boolean {
  const l = linha.trim()
  return l.length >= 3 && /\p{L}/u.test(l) && l === l.toLocaleUpperCase('pt-BR') && !/[.:;!?]$/.test(l)
}

export function secoesDe(texto: string): Secao[] {
  const grupos: { titulo: string; linhas: string[] }[] = []
  let atual: { titulo: string; linhas: string[] } | null = null
  for (const linha of texto.split(/\r?\n/)) {
    if (ehTitulo(linha)) {
      atual = { titulo: linha.trim(), linhas: [] }
      grupos.push(atual)
      continue
    }
    if (!atual) {
      atual = { titulo: '', linhas: [] }
      grupos.push(atual)
    }
    atual.linhas.push(linha)
  }
  return grupos.map(g => ({ titulo: g.titulo, texto: g.linhas.join('\n').trim() })).filter(s => s.texto || s.titulo)
}

/** "O QUE A AXON NUNCA FAZ" vira "O que a Axon nunca faz": as palavras do nome do projeto mantêm a maiúscula. */
export function tituloLegivel(titulo: string, nomeDoProjeto: string): string {
  const doNome = new Set([...nomeDoProjeto.toLocaleLowerCase('pt-BR').matchAll(/\p{L}+/gu)].map(m => m[0]))
  const minusculo = titulo.toLocaleLowerCase('pt-BR')
  const primeira = minusculo.search(/\p{L}/u)
  return minusculo.replace(/\p{L}+/gu, (palavra, posicao) => (posicao === primeira || doNome.has(palavra) ? palavra[0].toLocaleUpperCase('pt-BR') + palavra.slice(1) : palavra))
}

const ABREVIACOES = /(?:^|\s)(?:Sr|Sra|Srta|Dr|Dra|Prof|Profa|Av|Eng|Exmo|Ilmo|Mr|Mrs|Ms|St|p|ex|art|n|pág|cap|fig)\.$/
const NUMERO_DE_ITEM = /^\d+\.$/

/** O pedaço termina numa abreviação ("Sr.") ou é só o número de uma enumeração ("1."): a frase continua. */
function frasePendente(pedaco: string): boolean {
  return ABREVIACOES.test(pedaco) || NUMERO_DE_ITEM.test(pedaco)
}

/** Itens com "- ", "• " ou "* "; senão, frases terminadas em . ! ? e seguidas de espaço e maiúscula. */
export function frasesDe(texto: string): string[] {
  const comQuebra = `\n${texto}`
  if (/\n\s*[-•*]\s/.test(comQuebra)) return comQuebra.split(/\n\s*[-•*]\s/).map(s => s.trim()).filter(Boolean)
  const pedacos = texto.replace(/\s+/g, ' ').split(/(?<=[.!?]["”)]?)\s(?=[\p{Lu}\d"“(])/u).map(s => s.trim()).filter(Boolean)
  const frases: string[] = []
  let juntar = false
  for (const pedaco of pedacos) {
    if (juntar) frases[frases.length - 1] += ` ${pedaco}`
    else frases.push(pedaco)
    juntar = frasePendente(frases[frases.length - 1])
  }
  return frases
}

/** O tom da seção pelo que o título diz: o que nunca se faz, como saber que está pronto, riscos, como trabalhar. */
export function tomDe(titulo: string): Tom {
  const t = titulo.toLocaleLowerCase('pt-BR')
  if (/nunca|fora de escopo|proibid|não faz/.test(t)) return 'nunca'
  if (/pronto|aceite|crit[eé]rio/.test(t)) return 'pronto'
  if (/risco/.test(t)) return 'risco'
  if (/como trabalhar|regras|restri/.test(t)) return 'como'
  return ''
}

/** A primeira seção, se for o "Objetivo" ou não tiver título, vira a manchete; o resto são os artigos. */
export function separarObjetivo(secoes: Secao[]): { objetivo: Secao | null; resto: Secao[] } {
  const [primeira, ...resto] = secoes
  if (primeira && (!primeira.titulo || /objetivo/i.test(primeira.titulo))) return { objetivo: primeira, resto }
  return { objetivo: null, resto: secoes }
}

export interface Artigo { titulo: string; tom: Tom; itens: string[] | null; texto: string }

/** Como a seção é desenhada: com duas frases ou mais vira lista de itens; com menos, um parágrafo só. */
export function artigoDe(secao: Secao, nomeDoProjeto: string): Artigo {
  const frases = frasesDe(secao.texto)
  return {
    titulo: secao.titulo ? tituloLegivel(secao.titulo, nomeDoProjeto) : 'Sem título',
    tom: tomDe(secao.titulo),
    itens: frases.length >= 2 ? frases : null,
    texto: secao.texto,
  }
}

export interface Manchete { rotulo: string; lide: string; resto: string }

/** O objetivo em manchete: a primeira frase em letra grande e o resto logo abaixo. */
export function mancheteDe(objetivo: Secao, nomeDoProjeto: string): Manchete {
  const frases = frasesDe(objetivo.texto)
  return {
    rotulo: objetivo.titulo ? tituloLegivel(objetivo.titulo, nomeDoProjeto) : 'Objetivo',
    lide: frases[0] ?? objetivo.texto,
    resto: frases.slice(1).join(' '),
  }
}
