/**
 * Biblioteca — prévia dos cartões, o ex-libris em guilhoché de cada documento e a cor de cada tipo.
 * Funções puras; quem desenha é src/biblioteca/ (componentes) e o painel da Biblioteca.
 */
import { aleatorioDe } from '../fio/desenho';

/** O começo do conteúdo em texto corrido: sem marcação, cortado na palavra, com reticências. */
export function previaDoConteudo(texto: string, limite = 180): string {
  const limpo = texto
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > 0 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

const mdc = (a: number, b: number): number => (b === 0 ? a : mdc(b, a % b));
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Uma camada do guilhoché: epitrocoide (pétalas para fora) ou hipotrocoide (para dentro), fechada. */
function camada(sorte: () => number, raio: number, escala: number, para: 'fora' | 'dentro'): string {
  const r = 2 + Math.floor(sorte() * 4);
  // O raio fixo é sempre maior que o que gira: as duas curvas (para fora e para dentro) ficam bem formadas.
  const R = r + 1 + Math.floor(sorte() * 5);
  const d = r * (0.6 + sorte() * 0.9);
  const giro = sorte() * Math.PI * 2;
  const soma = para === 'fora' ? R + r : R - r;
  const k = soma / r;
  const alcance = Math.abs(soma) + d;
  const voltas = r / mdc(R, r);
  const passos = Math.min(1600, Math.round(240 * voltas));
  const fator = (raio * escala) / alcance;
  const pontos: string[] = [];
  for (let i = 0; i <= passos; i++) {
    const t = (i / passos) * Math.PI * 2 * voltas;
    const x = soma * Math.cos(t) + (para === 'fora' ? -d : d) * Math.cos(k * t);
    const y = soma * Math.sin(t) - d * Math.sin(k * t);
    const xr = x * Math.cos(giro) - y * Math.sin(giro);
    const yr = x * Math.sin(giro) + y * Math.cos(giro);
    pontos.push(`${fmt(raio + xr * fator)} ${fmt(raio + yr * fator)}`);
  }
  return `M${pontos[0]} ${pontos.slice(1).map(p => `L${p}`).join(' ')} Z`;
}

/**
 * Ex-libris: o emblema único de cada documento, com as curvas entrelaçadas das notas de dinheiro
 * e dos certificados antigos. Três camadas, da borda para o miolo, num quadrado de 2 × raio.
 */
export function guilloche(semente: string, raio: number): { camadas: string[] } {
  const sorte = aleatorioDe(`ex-libris:${semente}`);
  return { camadas: [camada(sorte, raio, 0.98, 'fora'), camada(sorte, raio, 0.7, 'dentro'), camada(sorte, raio, 0.42, 'fora')] };
}

const TONS: Record<string, string> = {
  specification: '#e8794a',
  research: '#d9b765',
  reference: '#8fae9c',
  artifact: '#b77d52',
  note: '#b9b2a5',
};

/** A cor de cada tipo de documento, usada no ex-libris; tipo desconhecido usa a da nota. */
export function tomDoTipo(tipo: string): string {
  return TONS[tipo] ?? TONS.note!;
}

