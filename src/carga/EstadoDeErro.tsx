import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import './carga.css';

/**
 * Estado de erro de tela inteira, no lugar do conteúdo que não carregou. Diz o que houve em frase de
 * produto e oferece um caminho: tentar de novo e/ou voltar à lista. Nunca finge que a lista está vazia.
 */
export function EstadoDeErro({ mensagem, aoTentarDeNovo, voltarParaProjetos = false }: { mensagem: string; aoTentarDeNovo?: () => void; voltarParaProjetos?: boolean }) {
  return <div className="estado-de-erro" role="alert">
    <AlertCircle size={26} strokeWidth={1.4} aria-hidden="true"/>
    <h2>{mensagem}</h2>
    <div className="estado-de-erro-acoes">
      {aoTentarDeNovo && <button type="button" className="button primary" onClick={aoTentarDeNovo}><RefreshCw size={15}/>Tentar de novo</button>}
      {voltarParaProjetos && <a className="button secondary" href="#projects"><ArrowLeft size={15}/>Ver todos os projetos</a>}
    </div>
  </div>;
}
