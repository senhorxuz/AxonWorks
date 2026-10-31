import { useEffect, useState } from 'react';

/**
 * Onde os dados da Axon moram: neste computador ou num servidor (VPS).
 * A tela só afirma o que é verdade no modo em que está rodando.
 */
export type ModoAxon = 'local' | 'servidor';

export interface TextosDoModo {
  area: string;
  selo: string;
  salvo: string;
  rodape: string;
  filtroComCheckpoint: string;
}

const TEXTOS: Record<ModoAxon, TextosDoModo> = {
  local: {
    area: 'Área local',
    selo: 'Local',
    salvo: 'Salvo neste computador',
    rodape: 'Seus dados ficam aqui',
    filtroComCheckpoint: 'Salvo neste computador',
  },
  servidor: {
    area: 'Área no servidor',
    selo: 'Servidor',
    salvo: 'Salvo no seu servidor',
    rodape: 'Seus dados ficam no seu servidor',
    filtroComCheckpoint: 'Com checkpoint salvo',
  },
};

export function textosDoModo(modo: ModoAxon): TextosDoModo {
  return TEXTOS[modo];
}

let pedido: Promise<ModoAxon> | null = null;

function buscarModo(): Promise<ModoAxon> {
  pedido ??= fetch('/api/health')
    .then(resposta => resposta.json() as Promise<{ mode?: string }>)
    .then(dados => (dados.mode === 'servidor' ? 'servidor' : 'local'))
    .catch(() => 'local' as const);
  return pedido;
}

/** Modo atual, perguntado ao servidor uma única vez. `null` enquanto a resposta não chega. */
export function useModo(): ModoAxon | null {
  const [modo, setModo] = useState<ModoAxon | null>(null);
  useEffect(() => {
    let ativo = true;
    void buscarModo().then(valor => { if (ativo) setModo(valor); });
    return () => { ativo = false; };
  }, []);
  return modo;
}
