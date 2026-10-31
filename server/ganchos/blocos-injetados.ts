// Blocos que ferramentas injetam na mensagem do dono (a extensão Claude in Chrome, a IDE, o próprio Claude
// Code) e que o Claude Code grava como se fossem texto dele. Não são pedido: saem do texto antes de ele
// valer como pedido do dono. O texto de verdade em volta fica.

/** Marcas de bloco que não são fala do dono. */
export const BLOCOS_INJETADOS = [
  'browser_instruction',
  'system-reminder',
  'ide_opened_file',
  'ide_selection',
  'local-command-stdout',
  'command-name',
  'command-message',
  'command-args',
] as const

/**
 * Do abre ao fecha do mesmo nome, com atributos e várias linhas no meio. O bloco acaba no primeiro fecho;
 * abre sem fecho, fecho de outro nome ou só o nome citado numa frase não são bloco e ficam como texto.
 */
const BLOCO = new RegExp(`<(${BLOCOS_INJETADOS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?</\\1>`, 'g')

/** O texto sem os blocos injetados (sem aparar o que sobra). */
export function tirarBlocosInjetados(texto: string): string {
  return texto.replace(BLOCO, '')
}
