/**
 * O selo da diretriz: um anel por versão, de dentro para fora; o da versão vigente é o de fora.
 * Cada anel é uma curva de guilhoché decidida pela semente (projeto, versão): o mesmo projeto desenha sempre o mesmo selo.
 * As contas ficam aqui; o componente só pinta os caminhos.
 */
import { aleatorioDe } from '../aleatorio';

export interface AnelDoSelo { chave: string; d: string; vigente: boolean; foco: boolean }
export interface SeloDaDiretriz { aneis: AnelDoSelo[]; numero: string; rotulo: 'VIGENTE' | 'ANTIGA'; descricao: string }

export const LADO_DO_SELO = 220;
const CENTRO = LADO_DO_SELO / 2;
const RAIO_DO_MIOLO = 34;
const RAIO_DA_BORDA = 106;
const PASSOS = 720;

/** Uma curva de guilhoché entre os raios `de` e `ate`, com o desenho decidido pela semente. */
export function anelDe(semente: string, centro: number, de: number, ate: number): string {
  const sorte = aleatorioDe(semente);
  const k = 5 + Math.floor(sorte() * 7);
  const voltas = 7 + Math.floor(sorte() * 6);
  const giro = sorte() * Math.PI * 2;
  const meio = (de + ate) / 2;
  const amplitude = (ate - de) / 2;
  const pontos: string[] = [];
  for (let i = 0; i <= PASSOS; i++) {
    const angulo = (i / PASSOS) * Math.PI * 2;
    const raio = meio + amplitude * Math.cos((k * angulo * voltas) / 3);
    pontos.push(`${(centro + raio * Math.cos(angulo + giro)).toFixed(2)} ${(centro + raio * Math.sin(angulo + giro)).toFixed(2)}`);
  }
  return `M${pontos.join(' L')} Z`;
}

/** `revisoes` em ordem crescente; `vendo` é a versão aberta na tela (ou nenhuma, quando se vê a vigente). */
export function montarSelo(revisoes: number[], idDoProjeto: string, vendo: number | null): SeloDaDiretriz {
  const vigente = revisoes.at(-1) ?? 0;
  const passo = (RAIO_DA_BORDA - RAIO_DO_MIOLO) / Math.max(revisoes.length, 1);
  const aneis: AnelDoSelo[] = [];
  revisoes.forEach((revisao, i) => {
    const de = RAIO_DO_MIOLO + i * passo;
    const faixa = passo;
    for (let volta = 0; volta < 2; volta++) {
      aneis.push({
        chave: `${revisao}-${volta}`,
        d: anelDe(`${idDoProjeto}:${revisao}:${volta}`, CENTRO, de + faixa * volta * 0.22, de + faixa - faixa * (1 - volta) * 0.1),
        vigente: revisao === vigente,
        foco: vendo === revisao,
      });
    }
  });
  return {
    aneis,
    numero: `v${vendo ?? vigente}`,
    rotulo: vendo !== null && vendo !== vigente ? 'ANTIGA' : 'VIGENTE',
    descricao: `Selo da diretriz: ${revisoes.length} ${revisoes.length === 1 ? 'versão' : 'versões'}, a vigente é a ${vigente}`,
  };
}
