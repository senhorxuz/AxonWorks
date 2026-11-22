import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X, ArrowUpRight } from 'lucide-react';
import { MemorySculpture } from './MemorySculpture';
import { gsap, useGSAP } from './motion';
import { focoInicialDe, prenderTab, retratoDosCampos } from './foco/armadilha';
import { houveDigitacao } from './foco/modal';
import { EVENTO_ABRIR_MENU } from './identidade/InformarNome';
export function Mark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'axon-mark small' : 'axon-mark'} viewBox="0 0 80 64" fill="none" aria-hidden="true">
    <path className="mark-ivory" fillRule="evenodd" d="M2 56 23.4 8h11.2L56 56H43.6l-4.2-10.2H18.6L14.4 56H2Zm20.6-20h12.8L29 20.5 22.6 36Z"/>
    <path className="mark-sage-light" d="M45 8h13.5L78 56H64.5L45 8Z"/>
    <path className="mark-sage-deep" d="M64.5 8H78L58.5 56H45L64.5 8Z"/>
    <rect className="mark-node" x="57.5" y="28" width="8" height="8" rx="2"/>
  </svg>;
}
export function Modal({ title, eyebrow, children, onClose, wide = false, className = '', confirmarAoFechar = true }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string; confirmarAoFechar?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const retratoInicial = useRef<string[]>([]);
  const encerrando = useRef(false);
  const digitou = useRef(false);
  const [confirmando, setConfirmando] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
  );
  useGSAP(() => { const media = gsap.matchMedia(); media.add('(prefers-reduced-motion: no-preference)', () => { gsap.from(ref.current, { y: 10, scale: .97, opacity: 0, duration: .28, ease: 'power4.out' }); }); return () => media.revert(); }, { scope: ref });
  useLayoutEffect(() => {
    const element = ref.current!;
    element.showModal();
    // Foco explícito ao abrir: primeiro campo, senão a ação principal, senão o primeiro botão (nunca o X).
    focoInicialDe(element)?.focus({ preventScroll: true });
    retratoInicial.current = retratoDosCampos(element);
    // Conteúdo que chega depois de abrir (ex.: o pacote do Exportar): se o foco ainda está no X, refaz a escolha.
    const botaoFechar = element.querySelector('[aria-label="Fechar diálogo"]');
    const observador = new MutationObserver(() => { if (document.activeElement === botaoFechar || document.activeElement === element) focoInicialDe(element)?.focus({ preventScroll: true }); });
    observador.observe(element, { childList: true, subtree: true });
    const parar = window.setTimeout(() => observador.disconnect(), 3000);
    const aoPedirParaSair = () => pedirParaFechar();
    window.addEventListener(EVENTO_ABRIR_MENU, aoPedirParaSair);
    return () => {
      window.removeEventListener(EVENTO_ABRIR_MENU, aoPedirParaSair);
      observador.disconnect();
      window.clearTimeout(parar);
      encerrando.current = true;
      element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Fechar por X, Esc ou clique fora: com texto digitado, pergunta antes de perder. */
  function pedirParaFechar() {
    const element = ref.current;
    if (confirmarAoFechar && element && digitou.current && houveDigitacao(retratoInicial.current, retratoDosCampos(element))) { setConfirmando(true); return; }
    onClose();
  }
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''} ${className}`.trim()} onCancel={event => { event.preventDefault(); pedirParaFechar(); }} onClose={() => { if (!encerrando.current) onClose(); }} onInput={() => { digitou.current = true; }} onKeyDown={event => prenderTab(event, ref.current)} onClick={event => { if (event.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) pedirParaFechar(); } }} aria-labelledby="modal-title"><div className="modal-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id="modal-title">{title}</h2></div><button className="icon-button" onClick={pedirParaFechar} aria-label="Fechar diálogo"><X size={20}/></button></div>{confirmando && <div className="modal-descartar" role="alertdialog" aria-label="Descartar o que você digitou?"><p>Você digitou algo aqui. Fechar agora descarta esse texto.</p><div><button type="button" className="button secondary" autoFocus onClick={() => setConfirmando(false)}>Continuar editando</button><button type="button" className="button secondary" onClick={onClose}>Descartar e fechar</button></div></div>}{children}</dialog>;
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
