/** Regras puras do foco e do fechamento dos modais (sem DOM, para testar sem navegador). */

/** Para onde vai o foco com Tab (ou Shift+Tab) dentro de um modal: dá a volta nas pontas. */
export function proximoFoco(total: number, atual: number, voltando: boolean): number {
  if (total <= 0) return -1;
  if (atual < 0 || atual >= total) return voltando ? total - 1 : 0;
  if (voltando) return atual === 0 ? total - 1 : atual - 1;
  return atual === total - 1 ? 0 : atual + 1;
}

/** Algo foi digitado ou mudado desde que o modal abriu? Compara o retrato da abertura com o de agora. */
export function houveDigitacao(aoAbrir: readonly string[], agora: readonly string[]): boolean {
  if (aoAbrir.length !== agora.length) return true;
  return aoAbrir.some((valor, i) => valor !== agora[i]);
}

/** Escolhe quem recebe o foco ao abrir: primeiro campo; sem campo, a ação principal; sem ela, o primeiro botão que não é o X. */
export function escolherFocoInicial<T>(campo: T | null, principal: T | null, primeiroBotao: T | null): T | null {
  return campo ?? principal ?? primeiroBotao;
}
