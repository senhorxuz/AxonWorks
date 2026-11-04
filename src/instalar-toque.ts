/**
 * Liga o toque à página: um único ouvinte para todos os botões (não um por botão).
 * Ao mover o ponteiro sobre um botão, grava --mx/--my nele; ao apertar, grava --tx/--ty e reinicia
 * a onda (data-toque). Sem src/brasa.css, estas variáveis não fazem nada.
 */
import { escalaDoElemento } from './escala-da-tela';
import { SELETOR_DO_TOQUE, pontoNoElemento } from './toque';

function alvo(evento: PointerEvent): HTMLElement | null {
  return evento.target instanceof Element ? evento.target.closest<HTMLElement>(SELETOR_DO_TOQUE) : null;
}

function gravar(elemento: HTMLElement, evento: PointerEvent, nomeX: string, nomeY: string) {
  const ponto = pontoNoElemento(evento.clientX, evento.clientY, elemento.getBoundingClientRect(), escalaDoElemento(elemento));
  elemento.style.setProperty(nomeX, `${ponto.x}px`);
  elemento.style.setProperty(nomeY, `${ponto.y}px`);
}

export function instalarToque(documento: Document): () => void {
  let pendente: PointerEvent | null = null;
  let quadro = 0;
  const mover = (evento: PointerEvent) => {
    if (evento.pointerType !== 'mouse') return;
    pendente = evento;
    if (quadro) return;
    quadro = requestAnimationFrame(() => {
      quadro = 0;
      const elemento = pendente && alvo(pendente);
      if (elemento && pendente) gravar(elemento, pendente, '--mx', '--my');
    });
  };
  const apertar = (evento: PointerEvent) => {
    const elemento = alvo(evento);
    if (!elemento || (elemento as HTMLButtonElement).disabled) return;
    gravar(elemento, evento, '--tx', '--ty');
    // Reinicia a onda mesmo em cliques seguidos: tira a marca, força o recálculo e põe de novo.
    elemento.removeAttribute('data-toque');
    void elemento.offsetWidth;
    elemento.setAttribute('data-toque', '');
  };
  const fimDaOnda = (evento: AnimationEvent) => {
    if (evento.animationName === 'brasa-onda' && evento.target instanceof HTMLElement) evento.target.removeAttribute('data-toque');
  };
  documento.addEventListener('pointermove', mover, { passive: true });
  documento.addEventListener('pointerdown', apertar, { passive: true });
  documento.addEventListener('animationend', fimDaOnda);
  return () => {
    documento.removeEventListener('pointermove', mover);
    documento.removeEventListener('pointerdown', apertar);
    documento.removeEventListener('animationend', fimDaOnda);
    cancelAnimationFrame(quadro);
  };
}
