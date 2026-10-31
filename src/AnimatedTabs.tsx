import { useRef } from 'react';
import { gsap, useGSAP } from './motion';
export function AnimatedTabs({ value, onChange, items }: { value: string; onChange: (id: string) => void; items: { id: string; label: string; count?: number }[] }) {
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useGSAP((_context, contextSafe) => {
    const move = contextSafe!(() => {
      const selected = root.current?.querySelector<HTMLElement>('[aria-selected=true]');
      const line = root.current?.querySelector<HTMLElement>('.tab-indicator');
      if (!selected || !line) return;
      gsap.to(line, { x: selected.offsetLeft, scaleX: selected.offsetWidth, duration: first.current || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .26, ease: 'power4.out', overwrite: true });
      first.current = false;
    });
    move();
    const observer = new ResizeObserver(move); observer.observe(root.current!);
    return () => observer.disconnect();
  }, { scope: root, dependencies: [value], revertOnUpdate: false });
  return <div className="tabs" role="tablist" aria-label="Conteúdo do projeto" ref={root}>
    {items.map((item, index) => <button key={item.id} id={'tab-'+item.id} type="button" role="tab" aria-controls="project-tabpanel" aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={event => {
      let target = index;
      if (event.key === 'ArrowRight') target = (index + 1) % items.length;
      else if (event.key === 'ArrowLeft') target = (index + items.length - 1) % items.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = items.length - 1;
      else return;
      event.preventDefault(); onChange(items[target].id); root.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[target].focus();
    }}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}
    <span className="tab-indicator" aria-hidden="true" style={{ width: 1 }}/>
  </div>;
}
