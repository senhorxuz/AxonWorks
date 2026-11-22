import { chaveDaChegada } from './chegada';
import { irPara } from './irPara';

/** Chegou num projeto por um clique (Ctrl K, Tear): o nome do projeto e o item dele na barra lateral acendem, depois de a tela trocar. */
export function chegarNoProjeto(id: string) {
  window.setTimeout(() => irPara({ chave: chaveDaChegada('projeto', id), tambem: [chaveDaChegada('projeto-lateral', id)] }), 0);
}
