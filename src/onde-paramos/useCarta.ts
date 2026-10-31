import { useCallback, useEffect, useState } from 'react';
import type { Carta } from '../../shared/carta';
import { api, errorText } from '../api';

export interface EstadoDaCarta {
  /** A última leitura que deu certo. Fica na tela enquanto uma nova leitura roda ou se ela falhar. */
  carta: Carta | null;
  carregando: boolean;
  /** Vazio quando a última leitura deu certo. */
  erro: string;
  recarregar: () => void;
}

/**
 * Lê a carta "Onde paramos" do projeto e a lê de novo toda vez que o projeto é atualizado
 * (`atualizadoEm` muda). Nunca devolve a carta de outro projeto: o chamador remonta por projeto.
 */
export function useCarta(projectId: string, atualizadoEm: unknown): EstadoDaCarta {
  const [carta, setCarta] = useState<Carta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCarregando(true);
    api.carta(projectId, controller.signal)
      .then(valor => {
        if (controller.signal.aborted) return;
        setCarta(valor);
        setErro('');
      })
      .catch(falha => {
        if (controller.signal.aborted) return;
        setErro(errorText(falha));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });
    return () => controller.abort();
  }, [projectId, atualizadoEm, tentativa]);

  const recarregar = useCallback(() => setTentativa(n => n + 1), []);
  return { carta, carregando, erro, recarregar };
}
