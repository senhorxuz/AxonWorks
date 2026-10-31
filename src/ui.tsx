import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X, ArrowUpRight } from 'lucide-react';
import { MemorySculpture } from './MemorySculpture';
import { gsap, useGSAP } from './motion';
export function Mark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'axon-mark small' : 'axon-mark'} viewBox="0 0 80 64" fill="none" aria-hidden="true">
    <path className="mark-ivory" fillRule="evenodd" d="M2 56 23.4 8h11.2L56 56H43.6l-4.2-10.2H18.6L14.4 56H2Zm20.6-20h12.8L29 20.5 22.6 36Z"/>
    <path className="mark-sage-light" d="M45 8h13.5L78 56H64.5L45 8Z"/>
    <path className="mark-sage-deep" d="M64.5 8H78L58.5 56H45L64.5 8Z"/>
    <rect className="mark-node" x="57.5" y="28" width="8" height="8" rx="2"/>
  </svg>;
}
export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
  );
  useGSAP(() => { const media = gsap.matchMedia(); media.add('(prefers-reduced-motion: no-preference)', () => { gsap.from(ref.current, { y: 10, scale: .97, opacity: 0, duration: .28, ease: 'power4.out' }); }); return () => media.revert(); }, { scope: ref });
  useLayoutEffect(() => {
    const element = ref.current!;
    element.showModal();
    // Explicitly focus after opening: React's autoFocus can run while dialog is closed.
    const firstField = element.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)',
    );
    (firstField ?? element.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    return () => {
      element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={event => { if (event.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }} aria-labelledby="modal-title"><div className="modal-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id="modal-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar diálogo"><X size={20}/></button></div>{children}</dialog>;
}
export function DateLabel({ value }: { value: string }) { return <time dateTime={value}>{new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))}</time>; }
export function EmptyNote({ children }: { children: ReactNode }) { return <div className="empty-note">{children}</div>; }
export function FlowIllustration() { return <MemorySculpture/>; }

export function firstMeaningfulParagraph(text: string): string {
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const standaloneHeadingRegex = /^(?:#+\s*|\*\*\s*|)(?:objetivo|charter|diretriz(?:es)?|vis[aã]o geral|contexto|escopo|prop[oó]sito)\b[\s:*–-]*(\*\*)?$/i;
  const inlineHeadingPrefixRegex = /^(?:#+\s*|\*\*\s*|)(?:objetivo|charter|diretriz(?:es)?|vis[aã]o geral|contexto|escopo|prop[oó]sito)\b[\s:*–-]*(\*\*)?\s*/i;

  const paragraphLines: string[] = [];
  let started = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) {
      if (started) break;
      continue;
    }

    if (!started && standaloneHeadingRegex.test(rawLine)) {
      continue;
    }

    if (!started && /^#{1,6}\s+/.test(rawLine)) {
      const cleaned = rawLine.replace(/^#{1,6}\s+/, '').trim();
      if (standaloneHeadingRegex.test(cleaned) || /^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ0-9\s]{2,20}:?$/.test(cleaned)) {
        continue;
      }
    }

    if (!started) {
      started = true;
      const stripped = rawLine.replace(inlineHeadingPrefixRegex, '').trim();
      paragraphLines.push(stripped || rawLine);
    } else {
      if (standaloneHeadingRegex.test(rawLine) || /^#{1,6}\s+/.test(rawLine)) {
        break;
      }
      paragraphLines.push(rawLine);
    }
  }

  const result = paragraphLines.join(' ').trim();
  return result || text.trim().split('\n')[0] || '';
}
