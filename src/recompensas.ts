/**
 * Parte 10 — Recompensas honestas e microinterações com GSAP.
 *
 * Regra inquebrável: recompensa só vem de evento real verificado.
 * Nenhuma animação finge progresso ou celebra dados não recebidos.
 * Respeita rigorosamente prefers-reduced-motion.
 * Apagável sozinha junto com src/recompensas.css.
 */

import { gsap } from './motion';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Microinteração discreta ao marcar um critério real como cumprido.
 * Duração curta (200ms), contida e profissional.
 */
export function celebrarCriterioCumprido(element: HTMLElement | null) {
  if (!element) return;
  element.setAttribute('data-recompensa', 'criterio-cumprido');
  if (prefersReducedMotion()) return;
  gsap.fromTo(
    element,
    { scale: 0.97, filter: 'brightness(1.2)' },
    { scale: 1, filter: 'brightness(1)', duration: 0.2, ease: 'power2.out' }
  );
}

/**
 * Revelação suave de itens concluídos no Resumo ao Acordar.
 * Disparado apenas quando dados reais de tarefas concluídas existem.
 */
export function animarEntradaResumo(container: HTMLElement | null) {
  if (!container || prefersReducedMotion()) return;
  const items = container.querySelectorAll('.resumo-item-pronto');
  if (items.length === 0) return;
  gsap.from(items, {
    y: 6,
    opacity: 0,
    duration: 0.3,
    stagger: 0.05,
    ease: 'power2.out',
  });
}
