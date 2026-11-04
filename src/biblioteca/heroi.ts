/**
 * Hero da Biblioteca — o que importa saber de relance: quantos documentos, de quais tipos e qual foi
 * o último guardado (para abrir direto). Função pura; quem desenha é ./HeroDaBiblioteca.tsx.
 */
import { haQuanto } from '../ascii/tear-dados';

export interface DocumentoDoHeroi {
  id: string;
  titulo: string;
  tipo: string;
  /** Quando foi guardado pela última vez. */
  quando: string;
}

export interface ResumoDaBiblioteca {
  frase: string;
  tipos: { tipo: string; rotulo: string; quantidade: number }[];
  ultimo: { id: string; titulo: string; haQuanto: string } | null;
}

export function resumoDaBiblioteca(documentos: DocumentoDoHeroi[], rotulos: Record<string, string>, agora: number): ResumoDaBiblioteca {
  const frase = documentos.length === 0 ? 'Nenhum documento ainda' : `${documentos.length} ${documentos.length === 1 ? 'documento' : 'documentos'}`;
  const contagem = new Map<string, number>();
  for (const d of documentos) contagem.set(d.tipo, (contagem.get(d.tipo) ?? 0) + 1);
  const tipos = [...contagem]
    .map(([tipo, quantidade]) => ({ tipo, rotulo: rotulos[tipo] ?? tipo, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  // Data que não se lê conta como a mais antiga: nunca passa na frente de uma data de verdade.
  const quando = (d: DocumentoDoHeroi) => Date.parse(d.quando) || 0;
  const recente = documentos.reduce<DocumentoDoHeroi | null>((melhor, d) => (!melhor || quando(d) > quando(melhor) ? d : melhor), null);
  return {
    frase,
    tipos,
    ultimo: recente ? { id: recente.id, titulo: recente.titulo, haQuanto: haQuanto(quando(recente), agora) } : null,
  };
}
