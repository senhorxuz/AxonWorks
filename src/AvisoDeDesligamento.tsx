import { useSyncExternalStore } from 'react';
import { PowerOff } from 'lucide-react';
import { TEXTO_DO_AVISO, type AvisoDeDesligamento } from './batida';
import './aviso-de-desligamento.css';

/**
 * Faixa fixa no topo: a batida da tela (src/batida.ts) não achou o servidor. O servidor que o atalho liga se desliga
 * sozinho depois de 30 minutos sem uso; sem esta faixa a tela ficaria parada, sem dizer por quê. Some sozinha quando
 * uma batida seguinte dá certo. A região `status` fica sempre na página, para o leitor de tela anunciar o texto quando entra.
 */
export function FaixaDeDesligamento({ aviso }: { aviso: AvisoDeDesligamento }) {
  const desligada = useSyncExternalStore(aviso.assinar, aviso.desligada);
  return (
    <div role="status">
      {desligada && (
        <div className="faixa-desligada">
          <PowerOff size={16} aria-hidden="true" />
          <span>{TEXTO_DO_AVISO}</span>
        </div>
      )}
    </div>
  );
}
