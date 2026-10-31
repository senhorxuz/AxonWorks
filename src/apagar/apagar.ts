// Regras puras das caixas "Apagar trecho" e "Apagar registro inteiro" (27/10/2026). Testadas em tests/apagar-tela.test.ts.

/** O dono digita esta palavra para apagar o registro inteiro. */
export const PALAVRA_DE_CONFIRMACAO = 'APAGAR';

export function confirmouApagarRegistro(texto: string): boolean {
  return texto.trim() === PALAVRA_DE_CONFIRMACAO;
}

export function trechoPreenchido(trecho: string): boolean {
  return trecho.trim() !== '';
}

function vezes(n: number): string {
  return n === 1 ? '1 vez' : `${n} vezes`;
}

export function fraseDasOcorrencias(ocorrencias: number): string {
  if (ocorrencias === 0) return 'Esse trecho não aparece neste registro. Confira se colou o texto exatamente igual.';
  return `Esse trecho aparece ${vezes(ocorrencias)} neste registro.`;
}

export function fraseDoApagado(resultado: { modo: 'trecho' | 'inteiro'; ocorrencias: number }): string {
  if (resultado.modo === 'inteiro') return 'O registro foi apagado. Ficaram só a data e quem gravou.';
  return `O trecho foi apagado ${vezes(resultado.ocorrencias)}.`;
}
