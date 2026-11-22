import type { Licao } from '../../shared/licoes';

function limpar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Todas as palavras da busca precisam aparecer no texto ou na linha curta, sem ligar para maiúsculas e acentos. */
export function filtrarLicoes(licoes: readonly Licao[], busca: string): Licao[] {
  const palavras = limpar(busca).match(/\S+/g) ?? [];
  return licoes.filter(licao => {
    const alvo = limpar(`${licao.texto} ${licao.linhaCurta ?? ''}`);
    return palavras.every(palavra => alvo.includes(palavra));
  });
}

/** "40" quando não há busca; "3 de 40" quando há. */
export function rotuloDaContagem(achadas: number, total: number, buscando: boolean): string {
  return buscando ? `${achadas} de ${total}` : String(total);
}
