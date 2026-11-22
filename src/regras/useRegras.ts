import { useEffect, useState } from 'react';
import type { Licao, MomentoDaVerificacao } from '../../shared/licoes';
import { ApiError, request } from '../api';
import { aplicarLicao, type AcaoSobreLicao } from './texto';

// Forma devolvida pela rota da Frente 2, que ainda pode estar ausente no servidor.
export interface FalhaDaVerificacao {
  verificacaoId: string;
  quantas: number;
  ultimaEm: string;
  ultimoDetalhe: string;
}

type Lista = { estado: 'carregando' | 'erro' } | { estado: 'pronta'; licoes: Licao[] };

export function salvarLicao(projectId: string, acao: AcaoSobreLicao, texto: string, momento?: MomentoDaVerificacao) {
  const caminho = `/projects/${encodeURIComponent(projectId)}/licoes`;
  if (acao.tipo === 'criar') return request<Licao>(caminho, { tipo: acao.categoria, texto, momento });
  const dados = acao.tipo === 'aposentar' ? { motivo: texto } : { texto };
  return request<Licao>(`${caminho}/${encodeURIComponent(acao.licao.id)}/${acao.tipo}`, dados);
}

export function useRegras(projectId: string) {
  const [lista, setLista] = useState<Lista>({ estado: 'carregando' });
  const [falhas, setFalhas] = useState<Map<string, FalhaDaVerificacao>>(new Map());
  const [erroNasFalhas, setErroNasFalhas] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const raiz = `/projects/${encodeURIComponent(projectId)}`;
    request<Licao[]>(`${raiz}/licoes`, undefined, signal)
      .then(licoes => { if (!signal.aborted) setLista({ estado: 'pronta', licoes }); })
      .catch(() => { if (!signal.aborted) setLista({ estado: 'erro' }); });
    request<FalhaDaVerificacao[]>(`${raiz}/verificacoes/falhas`, undefined, signal)
      .then(dados => {
        if (!signal.aborted) setFalhas(new Map(dados.map(falha => [falha.verificacaoId, falha])));
      })
      .catch(erro => {
        if (!signal.aborted && !(erro instanceof ApiError && erro.status === 404)) setErroNasFalhas(true);
      });
    return () => controller.abort();
  }, [projectId, tentativa]);

  function recarregar() {
    setLista({ estado: 'carregando' });
    setFalhas(new Map());
    setErroNasFalhas(false);
    setTentativa(n => n + 1);
  }

  function aplicar(licao: Licao) {
    setLista(atual => atual.estado === 'pronta' ? { estado: 'pronta', licoes: aplicarLicao(atual.licoes, licao) } : atual);
  }

  function remover(id: string) {
    setLista(atual => atual.estado === 'pronta'
      ? { estado: 'pronta', licoes: atual.licoes.filter(licao => licao.id !== id) }
      : atual);
  }

  return { lista, falhas, erroNasFalhas, recarregar, aplicar, remover };
}
