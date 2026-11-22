/** Textos do fio que vêm das regras: a frase-resumo, o rótulo para leitor de tela, "Daqui em diante" e a miniatura. */
import type { Carta, GrupoFalta } from '../../shared/carta';
import { diaDe, diasEntre, type CoisaFeita } from './coisas';
import { diaEMes } from './datas';
import { contarIAs } from './trilhos';

const SEM_COISAS = 'Nada feito ainda: o fio começa no primeiro registro';
const MAX_SIMBOLOS_NA_MINIATURA = 8;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "Passou por 3 IAs", "Sempre com a mesma IA" ou '' (sem nenhuma IA com nome). Sem ponto final. */
function iasDoFio(coisas: CoisaFeita[]): string {
  const ias = contarIAs(coisas);
  if (ias === 0) return '';
  return ias === 1 ? 'Sempre com a mesma IA' : `Passou por ${ias} IAs`;
}

/** Os dias de trabalho (com atividade) e o tempo de vida do projeto (do primeiro ao último dia, contando os dois). */
function diasDoFio(coisas: CoisaFeita[]): { trabalho: number; vida: number; ultimo: string } {
  const dias = [...new Set(coisas.map(c => diaDe(c.quando)))].sort();
  return { trabalho: dias.length, vida: diasEntre(dias[0]!, dias.at(-1)!) + 1, ultimo: dias.at(-1)! };
}

/** "28 coisas feitas" · " em 9 dias de trabalho, ao longo de 68." · "Passou por 3 IAs." Conta o projeto inteiro, não só o desenhado. */
export function fraseDoFio(coisas: CoisaFeita[]): { coisas: string; resto: string; ias: string } {
  if (coisas.length === 0) return { coisas: SEM_COISAS, resto: '', ias: '' };
  const { trabalho, vida } = diasDoFio(coisas);
  const aoLongoDe = vida > trabalho ? `, ao longo de ${vida}` : '';
  const ias = iasDoFio(coisas);
  return {
    coisas: `${plural(coisas.length, 'coisa', 'coisas')} ${coisas.length === 1 ? 'feita' : 'feitas'}`,
    resto: ` em ${plural(trabalho, 'dia', 'dias')} de trabalho${aoLongoDe}.`,
    ias: ias === '' ? '' : `${ias}.`,
  };
}

/** O resumo para o leitor de tela: "28 coisas feitas em 9 dias, passou por 3 IAs; onde paramos: 21 nov". */
export function rotuloAcessivelDoFio(coisas: CoisaFeita[]): string {
  if (coisas.length === 0) return SEM_COISAS;
  const { trabalho, ultimo } = diasDoFio(coisas);
  const ias = iasDoFio(coisas);
  const dasIas = ias === '' ? '' : `, ${ias[0]!.toLowerCase()}${ias.slice(1)}`;
  const feitas = `${plural(coisas.length, 'coisa', 'coisas')} ${coisas.length === 1 ? 'feita' : 'feitas'}`;
  return `${feitas} em ${plural(trabalho, 'dia', 'dias')}${dasIas}; onde paramos: ${diaEMes(ultimo)}`;
}

const GRUPOS: { grupo: GrupoFalta; um: string; varios: string; pede: boolean }[] = [
  { grupo: 'precisa_de_voce', um: 'precisa de você', varios: 'precisam de você', pede: true },
  { grupo: 'travado', um: 'travado', varios: 'travados', pede: false },
  { grupo: 'em_andamento', um: 'em andamento', varios: 'em andamento', pede: false },
  { grupo: 'a_fazer', um: 'a fazer', varios: 'a fazer', pede: false },
  { grupo: 'ideias', um: 'ideia', varios: 'ideias', pede: false },
];

/** A linha "Daqui em diante": só os grupos com itens, do que mais pede ao que menos pede. */
export function daquiEmDiante(falta: Carta['falta']): { grupo: GrupoFalta; quantidade: number; texto: string; pede: boolean }[] {
  return GRUPOS.filter(g => falta[g.grupo].length > 0).map(g => {
    const quantidade = falta[g.grupo].length;
    return { grupo: g.grupo, quantidade, texto: plural(quantidade, g.um, g.varios), pede: g.pede };
  });
}

/** A miniatura da lista de projetos: `├` e um `○` por versão (até 8 símbolos), o último `◉`. */
export function simbolosDaMiniatura(versoes: number): string {
  const quantas = Math.min(MAX_SIMBOLOS_NA_MINIATURA, Math.max(0, Math.floor(versoes) || 0));
  return quantas === 0 ? '├' : `├${'○'.repeat(quantas - 1)}◉`;
}
