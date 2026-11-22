import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, ProjectDetail } from '../../shared/types';
import { api, errorText } from '../api';
import { classificarFalhaDeCarga, type FalhaDeCarga } from './falhas';

/**
 * Carrega a lista de projetos e o projeto aberto em dois pedidos separados: se um falha, o outro continua
 * de pé (a lista não some porque o projeto não abriu, nem o contrário). Cada falha vira uma frase de produto.
 */
export function useCargaDoApp(selectedId: string | null) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [carregandoProjeto, setCarregandoProjeto] = useState(selectedId !== null);
  const [listaFalha, setListaFalha] = useState<FalhaDeCarga | null>(null);
  const [projetoFalha, setProjetoFalha] = useState<FalhaDeCarga | null>(null);
  const [aviso, setAviso] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const listaJaChegou = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    api.projects(controller.signal)
      .then(lista => { if (controller.signal.aborted) return; listaJaChegou.current = true; setProjects(lista); setListaFalha(null); })
      .catch(falha => {
        if (controller.signal.aborted) return;
        // Com uma lista já na tela, uma leitura que falha não a apaga: vira aviso.
        if (listaJaChegou.current) setAviso(errorText(falha));
        else setListaFalha(classificarFalhaDeCarga(falha, 'lista'));
      })
      .finally(() => { if (!controller.signal.aborted) setCarregandoLista(false); });
    return () => controller.abort();
  }, [selectedId, tentativa]);

  useEffect(() => {
    setDetail(null);
    setProjetoFalha(null);
    setAviso('');
    if (!selectedId) { setCarregandoProjeto(false); return; }
    const controller = new AbortController();
    setCarregandoProjeto(true);
    api.project(selectedId, controller.signal)
      .then(projeto => { if (!controller.signal.aborted) setDetail(projeto); })
      .catch(falha => { if (!controller.signal.aborted) setProjetoFalha(classificarFalhaDeCarga(falha, 'projeto')); })
      .finally(() => { if (!controller.signal.aborted) setCarregandoProjeto(false); });
    return () => controller.abort();
  }, [selectedId, tentativa]);

  /** Recarrega depois de uma ação. Se falhar, o que já está na tela fica e o dono recebe um aviso. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setAviso('');
    try {
      const [lista, projeto] = await Promise.all([api.projects(), selectedId ? api.project(selectedId) : Promise.resolve(null)]);
      setProjects(lista);
      if (projeto) setDetail(projeto);
    } catch (falha) {
      setAviso(errorText(falha));
    } finally {
      setRefreshing(false);
    }
  }, [selectedId]);

  const tentarDeNovo = useCallback(() => {
    setListaFalha(null);
    setCarregandoLista(!listaJaChegou.current);
    setTentativa(n => n + 1);
  }, []);

  return { projects, setProjects, detail, setDetail, carregandoLista, carregandoProjeto, listaFalha, projetoFalha, aviso, refreshing, refresh, tentarDeNovo };
}
