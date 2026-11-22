/**
 * Leitor mínimo de Markdown para os documentos da Biblioteca. Devolve uma árvore de dados (nunca HTML):
 * quem desenha monta elementos React a partir dela, então o texto de uma IA nunca vira marcação.
 *
 * Suporta: títulos (#), parágrafos, listas com marcador e numeradas, bloco de código (```), citação (>),
 * linha divisória (---) e, dentro do texto, **negrito**, *itálico* e `código`. Todo o resto (links, imagens,
 * HTML, tabelas) fica como texto simples, de propósito.
 */

export type Trecho =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'negrito'; texto: string }
  | { tipo: 'italico'; texto: string }
  | { tipo: 'codigo'; texto: string };

export type Bloco =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3 | 4 | 5 | 6; trechos: Trecho[] }
  | { tipo: 'paragrafo'; trechos: Trecho[] }
  | { tipo: 'lista'; numerada: boolean; itens: Trecho[][] }
  | { tipo: 'codigo'; linguagem: string; texto: string }
  | { tipo: 'citacao'; trechos: Trecho[] }
  | { tipo: 'divisoria' };

const MARCA_DE_CODIGO = '```';

/** Onde cada marca pode ocorrer; a dupla conta também as ocorrências coladas (em "***" há duas). */
const OCORRENCIAS = { '*': /\*/g, '**': /(?=\*\*)/g } as const;

/** As posições onde a marca pode fechar (texto de verdade, sem espaço, antes dela), calculadas uma vez por linha. */
function posicoesDeFecho(texto: string, marca: keyof typeof OCORRENCIAS): number[] {
  return Array.from(texto.matchAll(OCORRENCIAS[marca]), achado => achado.index).filter(posicao => /\S/.test(texto.charAt(posicao - 1)));
}

/** A primeira posição maior que `limite` (busca binária: o tempo não cresce com o número de marcas). */
function primeiraDepois(posicoes: readonly number[], limite: number): number {
  let de = 0;
  let ate = posicoes.length;
  while (de < ate) {
    const meio = (de + ate) >> 1;
    if (posicoes[meio]! > limite) ate = meio; else de = meio + 1;
  }
  return posicoes[de] ?? -1;
}

/** Procura o fecho de uma marca, exigindo texto de verdade dentro (sem espaço colado à marca). */
function acharFecho(texto: string, posicoes: readonly number[], inicio: number): number {
  if (!/\S/.test(texto.charAt(inicio))) return -1;
  return primeiraDepois(posicoes, inicio);
}

/** Quebra uma linha em trechos. Marca sem fecho vira texto, como veio. */
export function lerTrechos(texto: string): Trecho[] {
  const trechos: Trecho[] = [];
  let corrido = '';
  const fecharCorrido = () => { if (corrido !== '') { trechos.push({ tipo: 'texto', texto: corrido }); corrido = ''; } };
  // Calculadas só quando a primeira marca aparece, e uma vez só: é isso que mantém a leitura linear.
  let fechosDupla: number[] | undefined;
  let fechosSimples: number[] | undefined;
  let i = 0;
  while (i < texto.length) {
    if (texto.startsWith('`', i)) {
      const fim = texto.indexOf('`', i + 1);
      if (fim > i + 1) { fecharCorrido(); trechos.push({ tipo: 'codigo', texto: texto.slice(i + 1, fim) }); i = fim + 1; continue; }
    } else if (texto.startsWith('**', i)) {
      fechosDupla ??= posicoesDeFecho(texto, '**');
      const fim = acharFecho(texto, fechosDupla, i + 2);
      if (fim !== -1) { fecharCorrido(); trechos.push({ tipo: 'negrito', texto: texto.slice(i + 2, fim) }); i = fim + 2; continue; }
      corrido += '**'; // marca dupla sem fecho: as duas ficam como texto e não viram um itálico por engano
      i += 2;
      continue;
    } else if (texto.startsWith('*', i)) {
      fechosSimples ??= posicoesDeFecho(texto, '*');
      const fim = acharFecho(texto, fechosSimples, i + 1);
      if (fim !== -1 && texto[fim + 1] !== '*') { fecharCorrido(); trechos.push({ tipo: 'italico', texto: texto.slice(i + 1, fim) }); i = fim + 1; continue; }
    }
    corrido += texto[i];
    i += 1;
  }
  fecharCorrido();
  return trechos;
}

const TITULO = /^(#{1,6})\s+(\S.*)$/;
const MARCADOR = /^\s*[-*+]\s+([^\n]*)/;
const NUMERADO = /^\s*\d+[.)]\s+([^\n]*)/;
const DIVISORIA = /^\s*([-*_])(\s*\1){2,}\s*$/;
const CITACAO = /^\s*>\s?(.*)$/;

type Leitura = { bloco: Bloco; proximo: number };

function lerCodigo(linhas: string[], inicio: number): Leitura {
  const linguagem = linhas[inicio]!.trim().slice(MARCA_DE_CODIGO.length).trim();
  const corpo: string[] = [];
  let i = inicio + 1;
  while (i < linhas.length && !linhas[i]!.trim().startsWith(MARCA_DE_CODIGO)) { corpo.push(linhas[i]!); i += 1; }
  // pula a cerca de fechamento (cerca sem fim vai até o fim do texto)
  return { bloco: { tipo: 'codigo', linguagem, texto: corpo.join('\n') }, proximo: i + 1 };
}

/** O texto do título sem os # (e os espaços) do fim: um laço simples, sem expressão que volte atrás. Só # sobra um #. */
function semHashesDoFim(texto: string): string {
  let fim = texto.length;
  while (texto[fim - 1] === '#') fim -= 1; // antes do começo vem `undefined`, que também para o laço
  return texto.slice(0, fim).trimEnd() || texto.slice(0, 1);
}

/** Linhas seguidas que casam com o padrão: devolve o conteúdo (grupo 1) de cada uma e onde parou. */
function seguidas(linhas: string[], inicio: number, padrao: RegExp): { conteudos: string[]; proximo: number } {
  const conteudos: string[] = [];
  let i = inicio;
  while (i < linhas.length) {
    const achou = padrao.exec(linhas[i]!);
    if (!achou) break;
    conteudos.push(achou[1]!);
    i += 1;
  }
  return { conteudos, proximo: i };
}

/** Tenta ler um bloco de uma linha só (título ou divisória). */
function lerLinhaUnica(linha: string, i: number): Leitura | null {
  const titulo = TITULO.exec(linha.trimEnd());
  if (titulo) return { bloco: { tipo: 'titulo', nivel: titulo[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, trechos: lerTrechos(semHashesDoFim(titulo[2]!)) }, proximo: i + 1 };
  if (DIVISORIA.test(linha)) return { bloco: { tipo: 'divisoria' }, proximo: i + 1 };
  return null;
}

/** Tenta ler um bloco de várias linhas parecidas (lista ou citação). */
function lerAgrupado(linha: string, linhas: string[], i: number): Leitura | null {
  const padrao = MARCADOR.test(linha) ? MARCADOR : NUMERADO.test(linha) ? NUMERADO : null;
  if (padrao) {
    const { conteudos, proximo } = seguidas(linhas, i, padrao);
    return { bloco: { tipo: 'lista', numerada: padrao === NUMERADO, itens: conteudos.map(lerTrechos) }, proximo };
  }
  if (CITACAO.test(linha)) {
    const { conteudos, proximo } = seguidas(linhas, i, CITACAO);
    return { bloco: { tipo: 'citacao', trechos: lerTrechos(conteudos.join(' ')) }, proximo };
  }
  return null;
}

/** Lê o documento inteiro em blocos. Linha em branco separa blocos; uma lista ou citação segue enquanto as linhas seguem o padrão. */
export function lerMarkdown(texto: string): Bloco[] {
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  const blocos: Bloco[] = [];
  let paragrafo: string[] = [];
  const fecharParagrafo = () => {
    if (paragrafo.length > 0) blocos.push({ tipo: 'paragrafo', trechos: lerTrechos(paragrafo.join(' ')) });
    paragrafo = [];
  };
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i]!;
    const leitura = linha.trim().startsWith(MARCA_DE_CODIGO) ? lerCodigo(linhas, i)
      : lerLinhaUnica(linha, i) ?? lerAgrupado(linha, linhas, i);
    if (leitura) { fecharParagrafo(); blocos.push(leitura.bloco); i = leitura.proximo; continue; }
    if (linha.trim() === '') fecharParagrafo(); else paragrafo.push(linha.trim());
    i += 1;
  }
  fecharParagrafo();
  return blocos;
}
