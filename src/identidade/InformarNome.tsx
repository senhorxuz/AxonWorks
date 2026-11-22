import { ID_CAMPO_NOME_DA_IA, ehAvisoDeNome } from './identidade';
import { irPara } from '../chegada/irPara';

export const EVENTO_ABRIR_MENU = 'axon:abrir-menu';
/** O campo do nome leva `data-chegada` com esta chave: o destaque de chegada comum o acende. */
export const CHAVE_DO_CAMPO_DO_NOME = 'nome-da-ia';

/** Leva o dono ao campo "Nome desta IA": abre o menu no celular, rola, foca e destaca. */
export function irParaCampoDoNome(): void {
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_MENU));
  irPara({ chave: CHAVE_DO_CAMPO_DO_NOME, foco: `#${ID_CAMPO_NOME_DA_IA}` });
}

export function BotaoInformarNome({ className = 'text-button' }: { className?: string }) {
  return <button type="button" className={className} onClick={irParaCampoDoNome}>Informar nome</button>;
}

/** Botão "Informar nome" só quando o erro é o aviso de nome faltando. */
export function InformarNomeSeFaltar({ erro }: { erro: string }) {
  return ehAvisoDeNome(erro) ? <BotaoInformarNome className="text-button informar-nome" /> : null;
}
