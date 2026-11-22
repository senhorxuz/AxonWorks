import { useCallback, useEffect, useState } from 'react';
import type { CharterRevision } from '../../shared/continuity';
import { api, errorText } from '../api';

/** A diretriz vigente e todas as versões, mais a ação que as muda (cada uma recarrega o que a tela mostra). */
export function useDiretriz(projectId: string, refresh: () => Promise<void>) {
  const [charter, setCharter] = useState<CharterRevision | null>(null);
  const [historico, setHistorico] = useState<CharterRevision[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [falhaNaLeitura, setFalhaNaLeitura] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.all([api.charter(projectId, signal), api.charterHistory(projectId, signal)]).then(([vigente, versoes]) => {
      if (signal.aborted) return;
      setCharter(vigente);
      setHistorico(versoes);
    }).catch(err => {
      if (signal.aborted) return;
      setFalhaNaLeitura(true);
      setError(errorText(err));
    }).finally(() => {
      if (!signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [projectId, tentativa]);

  const tentarNovamente = useCallback(() => {
    setError('');
    setFalhaNaLeitura(false);
    setLoading(true);
    setTentativa(atual => atual + 1);
  }, []);

  /** Roda a ação, mostra a mensagem de andamento e, no fim, recarrega a diretriz e o projeto. Devolve se deu certo. */
  const aplicar = useCallback(async (acao: () => Promise<unknown>, carregando: string, concluido: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    setStatus(carregando);
    try {
      await acao();
      const [vigente, versoes] = await Promise.all([api.charter(projectId), api.charterHistory(projectId)]);
      setCharter(vigente);
      setHistorico(versoes);
      setStatus(concluido);
      await refresh();
      return true;
    } catch (err) {
      setError(errorText(err));
      setStatus('');
      return false;
    } finally {
      setBusy(false);
    }
  }, [projectId, refresh]);

  return { charter, historico, error, status, loading, falhaNaLeitura, busy, tentarNovamente, aplicar };
}
