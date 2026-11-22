import { useEffect, useRef } from 'react';
import type { ItemNaLixeira } from '../../shared/lixeira';
import { DURACAO_DO_DESFAZER_MS } from '../chegada/chegada';

/**
 * Depois de mandar uma regra para a lixeira: um aviso de 6 s com "Desfazer" e "Ver na lixeira".
 * Se o foco estiver dentro dele quando o tempo acabar, o foco volta para quem chamou antes de o aviso sumir.
 */
export function AvisoDaLixeira({ item, ocupada, desfazer, ver, expirar, devolverFoco }: {
  item: ItemNaLixeira; ocupada: boolean; desfazer: () => void; ver: () => void; expirar: () => void; devolverFoco: () => void;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fim = window.setTimeout(() => {
      if (raiz.current?.contains(document.activeElement)) devolverFoco();
      expirar();
    }, DURACAO_DO_DESFAZER_MS);
    return () => window.clearTimeout(fim);
  }, [item, expirar, devolverFoco]);
  return <div className="regras-aviso-lixeira" ref={raiz} role="group" aria-label="Item enviado para a lixeira">
    <span className="regras-aviso-lixeira-texto">“{item.titulo}” foi para a lixeira.</span>
    <button type="button" className="button secondary" disabled={ocupada} onClick={desfazer}>Desfazer</button>
    <button type="button" className="button secondary" onClick={ver}>Ver na lixeira</button>
  </div>;
}
