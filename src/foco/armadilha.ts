import type { KeyboardEvent as TeclaReact } from 'react';
import { escolherFocoInicial, proximoFoco } from './modal';

const FOCAVEIS = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

function focaveisDe(dialogo: HTMLElement): HTMLElement[] {
  return Array.from(dialogo.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(elemento => elemento.getClientRects().length > 0);
}

/** Mantém o Tab dentro do modal: do último elemento volta ao primeiro (e o inverso com Shift). */
export function prenderTab(evento: TeclaReact, dialogo: HTMLElement | null): void {
  if (evento.key !== 'Tab' || !dialogo) return;
  const lista = focaveisDe(dialogo);
  const alvo = proximoFoco(lista.length, lista.indexOf(document.activeElement as HTMLElement), evento.shiftKey);
  if (alvo < 0) return;
  evento.preventDefault();
  lista[alvo].focus();
}

/** Primeiro campo; sem campo, a ação principal; sem ela, o primeiro botão que não é o X de fechar. */
export function focoInicialDe(dialogo: HTMLElement): HTMLElement | null {
  const campo = dialogo.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled):not([readonly]), textarea:not(:disabled):not([readonly]), select:not(:disabled)');
  const principal = dialogo.querySelector<HTMLElement>('[data-foco-inicial], .button.primary:not(:disabled)');
  const botao = dialogo.querySelector<HTMLElement>('button:not(:disabled):not([aria-label="Fechar diálogo"])') ?? dialogo.querySelector<HTMLElement>('button');
  return escolherFocoInicial(campo, principal, botao);
}

/** Retrato dos campos do modal, para saber se algo foi digitado antes de fechar. */
export function retratoDosCampos(dialogo: HTMLElement): string[] {
  return Array.from(dialogo.querySelectorAll<HTMLInputElement>('input, textarea, select'))
    .filter(campo => campo.type !== 'hidden' && campo.type !== 'file')
    .map(campo => (campo.type === 'checkbox' || campo.type === 'radio' ? String(campo.checked) : campo.value));
}
