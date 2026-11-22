/**
 * Os textos da linha do tempo das versões, do selo e dos avisos da diretriz: as contas e as frases, sem tela.
 */
import type { CharterRevision } from '../../shared/continuity';
import { secoesDe } from './secoes';

type Versao = Pick<CharterRevision, 'revision' | 'createdBy' | 'createdAt' | 'sourceKind' | 'body' | 'motivo' | 'vistoPeloDonoEm'>;

const formatoDaData = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'short', year: 'numeric' });

/** "25 de out. de 2026", no fuso de Brasília. */
export function dataPorExtenso(iso: string): string {
  return formatoDaData.format(new Date(iso));
}

/** Quem escreveu: o dono ("você") ou uma IA, com o nome que ela declarou. */
export function quemEscreveu(versao: Pick<Versao, 'sourceKind' | 'createdBy'>): string {
  return versao.sourceKind === 'human_directive' ? 'você' : `${versao.createdBy} (IA)`;
}

/** Uma IA mudou a diretriz e o dono ainda não disse que está certo. */
export function aguardaConferencia(versao: Pick<Versao, 'sourceKind' | 'vistoPeloDonoEm'>): boolean {
  return versao.sourceKind === 'agent_update' && !versao.vistoPeloDonoEm;
}

export function tituloDaVersao(versao: Pick<Versao, 'revision'>, vigente: Pick<Versao, 'revision'>): string {
  return `Versão ${versao.revision}${versao.revision === vigente.revision ? ' · vigente' : ''}`;
}

/** "25 de out. de 2026 · por você". */
export function quandoEPor(versao: Versao): string {
  return `${dataPorExtenso(versao.createdAt)} · por ${quemEscreveu(versao)}`;
}

function contagem(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "5 seções · 1254 caracteres". */
export function resumoDaVersao(versao: Pick<Versao, 'body'>): string {
  return `${contagem(secoesDe(versao.body).length, 'seção', 'seções')} · ${contagem(versao.body.length, 'caractere', 'caracteres')}`;
}

/** Registros do projeto (checkpoints) criados depois do momento em que a versão passou a valer. */
export function registrosDesde(registros: ReadonlyArray<{ createdAt: string }>, quando: string): number {
  const desde = Date.parse(quando);
  return registros.filter(r => Date.parse(r.createdAt) > desde).length;
}

export interface TrechoDaLegenda { texto: string; forte: boolean }

/** A legenda sob o selo, em trechos: o que está em negrito vem marcado. */
export function legendaDoSelo(vigente: Versao, registros: number): TrechoDaLegenda[] {
  const trechos: TrechoDaLegenda[] = [
    { texto: 'Um anel por versão. Vigente desde ', forte: false },
    { texto: dataPorExtenso(vigente.createdAt), forte: true },
    { texto: ', escrita por ', forte: false },
    { texto: quemEscreveu(vigente), forte: true },
    { texto: '.', forte: false },
  ];
  if (registros > 0) {
    trechos.push(
      { texto: ' Desde então, ', forte: false },
      { texto: contagem(registros, 'registro', 'registros'), forte: true },
      { texto: ' no projeto.', forte: false },
    );
  }
  return trechos;
}

/** O selo "escrita ou conferida por você" ou "uma IA atualizou: confira". */
export function estadoDaDiretriz(vigente: Pick<Versao, 'sourceKind' | 'vistoPeloDonoEm'>): { pendente: boolean; texto: string } {
  return aguardaConferencia(vigente)
    ? { pendente: true, texto: 'Uma IA atualizou: confira' }
    : { pendente: false, texto: 'Escrita ou conferida por você' };
}

/** O aviso de que uma IA atualizou a diretriz, com o motivo que ela deu (sem ponto repetido). */
export function avisoDeAtualizacao(versao: Versao): string {
  const motivo = versao.motivo?.trim().replace(/\.+$/, '');
  return `${versao.createdBy} (nome declarado) atualizou esta diretriz em ${dataPorExtenso(versao.createdAt)}${motivo ? `: ${motivo}` : ''}. Confira e diga se está certo.`;
}

export function avisoDeVersaoAntiga(versao: Pick<Versao, 'revision' | 'createdAt'>): string {
  return `Você está vendo a versão ${versao.revision}, de ${dataPorExtenso(versao.createdAt)}. Ela não vale mais.`;
}

/** "Salvar versão 3": a próxima depois da vigente (a primeira, quando ainda não há diretriz). */
export function rotuloDoSalvar(vigente: Pick<Versao, 'revision'> | null): string {
  return `Salvar versão ${(vigente?.revision ?? 0) + 1}`;
}
