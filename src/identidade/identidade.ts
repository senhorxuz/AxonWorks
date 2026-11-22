/**
 * Quem assina cada ação da tela. O dono é humano: o que ele faz na tela (anotar ideia, guardar
 * conteúdo, aceitar decisão) grava como "Dono do projeto" sem pedir nome. Só as ações de IA
 * (assumir tarefa, checkpoint, passagem...) exigem o nome da IA na barra lateral.
 */

export const CHAVE_NOME_DONO = 'axon-nome-do-dono';

/** O texto que a carta reconhece como o dono (server/carta/montar.ts compara em minúsculas). */
export const NOME_DO_DONO_PADRAO = 'Dono do projeto';

export type ArmazemLeitura = { getItem(chave: string): string | null };

/** O nome que o dono salvou neste computador; sem nome salvo (ou sem armazenamento), o texto padrão. */
export function nomeDoDonoDe(armazem: ArmazemLeitura | undefined): string {
  try {
    // Sem armazenamento ou sem valor salvo a leitura falha (TypeError) e cai no padrão, igual a um armazenamento bloqueado.
    return armazem!.getItem(CHAVE_NOME_DONO)!.trim() || NOME_DO_DONO_PADRAO;
  } catch {
    return NOME_DO_DONO_PADRAO;
  }
}

export type OrigemDaTela = 'agent_report' | 'human_directive' | 'external_reference';

/**
 * Quem assina o que sai da tela e de que origem nasce. Com nome na barra lateral é uma IA usando a tela: assina com o
 * nome dela e a origem é SEMPRE relato de agente, mesmo revendo um texto que era do dono (a retomada das IAs trata
 * diretriz humana como ordem; uma IA não a promove). Sem nome, é o dono: assina "Dono do projeto" (ou o nome que
 * salvou) e a origem é a da versão vigente, quando se está revendo uma, ou diretriz humana.
 */
export function autoriaDaTela(
  nomeNaBarra: string,
  dono: string = NOME_DO_DONO_PADRAO,
  origemVigente?: OrigemDaTela,
): { autor: string; origem: OrigemDaTela } {
  const ia = nomeNaBarra.trim();
  return ia === '' ? { autor: dono, origem: origemVigente ?? 'human_directive' } : { autor: ia, origem: 'agent_report' };
}

/** Id do campo da barra lateral onde a IA se identifica. */
export const ID_CAMPO_NOME_DA_IA = 'agent-name';

/** Explicação única dos três campos de nome (barra lateral, fila de decisões, aceite). */
export const EXPLICACAO_DOS_NOMES = 'Você, como dono, não precisa digitar nada: a Axon assina como "Dono do projeto". Este campo é só para uma IA que esteja usando esta tela.';

/** As frases "Informe/Preencha o nome do agente na barra lateral..." que as telas já mostram como erro. */
export function ehAvisoDeNome(mensagem: string): boolean {
  return /nome (do|de) agente/i.test(mensagem) || /nome na barra lateral/i.test(mensagem);
}
