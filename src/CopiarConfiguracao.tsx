import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Botão "Copiar" de um bloco de texto (a configuração JSON): avisa quando copiou e, se o navegador não deixa, diz o que fazer. */
export function CopiarConfiguracao({ texto, aoCopiar }: { texto: string; aoCopiar?: () => void }) {
  const [estado, setEstado] = useState<'parado' | 'copiado' | 'falhou'>('parado');
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado('copiado');
      aoCopiar?.();
    } catch {
      setEstado('falhou');
    }
  }
  return <div className="copiar-configuracao">
    <button type="button" className="snippet-copy-btn" onClick={() => void copiar()}>
      {estado === 'copiado' ? <Check size={13} aria-hidden="true"/> : <Copy size={13} aria-hidden="true"/>}
      {estado === 'copiado' ? 'Copiado!' : 'Copiar'}
    </button>
    <span role="status" className="copiar-configuracao-aviso">{estado === 'falhou' ? 'A cópia automática não está disponível. Selecione o texto e copie.' : ''}</span>
  </div>;
}
