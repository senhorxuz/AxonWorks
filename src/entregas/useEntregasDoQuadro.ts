import { useCallback, useEffect, useRef, useState } from 'react';
import type { EstadoDaEntrega } from '../../shared/entrega';
import { api } from '../api';

export function useEntregasDoQuadro(projectId: string) {
  const [porCartao, setPorCartao] = useState(new Map<string, EstadoDaEntrega>());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const leitura = useRef<AbortController | null>(null);

  const recarregar = useCallback(() => {
    leitura.current?.abort();
    setTentativa(n => n + 1);
  }, []);

  useEffect(() => {
    if (tentativa === 0) return;
    const controller = new AbortController();
    leitura.current = controller;
    api.entregas(projectId, controller.signal).then(lista => {
      if (controller.signal.aborted) return;
      setPorCartao(new Map(lista.map(entrega => [entrega.cardId, entrega])));
      setErro(false);
      setCarregando(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setErro(true);
      setCarregando(false);
    });
    return () => controller.abort();
  }, [projectId, tentativa]);

  function receber(entrega: EstadoDaEntrega) {
    // Uma leitura iniciada antes da gravação pode trazer o estado antigo.
    recarregar();
    setPorCartao(atual => new Map(atual).set(entrega.cardId, entrega));
  }

  return { porCartao, carregando, erro, recarregar, receber };
}
