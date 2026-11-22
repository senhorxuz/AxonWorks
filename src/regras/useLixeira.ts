import { useEffect, useState } from 'react';
import type { ItemNaLixeira } from '../../shared/lixeira';
import { errorText, request } from '../api';

export function useLixeira(projectId: string) {
  const caminho = `/projects/${encodeURIComponent(projectId)}/lixeira`;
  const [itens, setItens] = useState<ItemNaLixeira[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroDeLeitura, setErroDeLeitura] = useState('');
  const [erro, setErro] = useState('');
  const [ocupada, setOcupada] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void request<ItemNaLixeira[]>(caminho, undefined, signal).then(dados => {
      if (!signal.aborted) setItens(dados);
    }).catch(falha => {
      if (!signal.aborted) setErroDeLeitura(errorText(falha));
    }).finally(() => {
      if (!signal.aborted) setCarregando(false);
    });
    return () => controller.abort();
  }, [caminho, tentativa]);

  function recarregar() {
    setCarregando(true);
    setErroDeLeitura('');
    setTentativa(n => n + 1);
  }

  async function executar(acao: () => Promise<void>) {
    setOcupada(true);
    setErro('');
    try {
      await acao();
      return true;
    } catch (falha) {
      setErro(errorText(falha));
      return false;
    } finally {
      setOcupada(false);
    }
  }

  function mandar(id: string) {
    return executar(async () => {
      const item = await request<ItemNaLixeira>(caminho, { tipo: 'licao', id });
      setItens(atuais => [item, ...atuais]);
    });
  }

  function retirar(item: ItemNaLixeira, operacao: 'restaurar' | 'apagar') {
    return executar(async () => {
      const { id, tipo } = item;
      const entrada = operacao === 'apagar' ? { id, tipo, confirmar: true } : { id, tipo };
      await request(`${caminho}/${operacao}`, entrada);
      setItens(atuais => atuais.filter(atual => atual.id !== id || atual.tipo !== tipo));
    });
  }

  return { itens, carregando, recarregar, erroDeLeitura, erro, setErro, ocupada, mandar, retirar };
}
