import { useRef, useState } from 'react';
import { ArrowUpRight, Pause, Play } from 'lucide-react';
import { gsap, useGSAP } from './motion';
const stages = [
  { name: 'Intenção', caption: 'O objetivo dá direção ao trabalho.', label: '01 / ONDE TUDO COMEÇA' },
  { name: 'Memória', caption: 'Cada avanço encontra um lugar permanente.', label: '02 / O FIO QUE PERMANECE' },
  { name: 'Continuidade', caption: 'Outra inteligência. O mesmo ponto de partida.', label: '03 / O PRÓXIMO MOVIMENTO' }
];
const strands = Array.from({ length: 36 }, (_, i) => {
  const t = i / 35; const spread = Math.sin(t * Math.PI); const shift = (t - .5) * 78;
  return 'M 46 '+(204+shift*.28)+' C '+(125+t*48)+' '+(202-spread*237)+' '+(242-t*18)+' '+(20+t*320)+' 301 204 C '+(369+t*15)+' '+(387-t*328)+' '+(447-t*46)+' '+(204+spread*236)+' 556 '+(204-shift*.28);
});
export function MemorySculpture() {
  const ref = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(1);
  const [playing, setPlaying] = useState(true);
  const { contextSafe } = useGSAP(() => {}, { scope: ref });
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const query = gsap.utils.selector(ref);
      gsap.from(query('.memory-strand'), { opacity: 0, stagger: { amount: .5, from: 'center' }, duration: 1.1, ease: 'power2.out' });
      const pulse = gsap.to(query('.memory-signal'), { strokeDashoffset: -1100, duration: 8, ease: 'none', repeat: -1, paused: !playing });
      const drift = gsap.to(query('.memory-geometry'), { y: -5, rotation: 1.1, transformOrigin: '50% 50%', duration: 5, ease: 'sine.inOut', repeat: -1, yoyo: true, paused: !playing });
      let intersecting = true;
      const visibility = () => { const active = playing && intersecting && !document.hidden; pulse.paused(!active); drift.paused(!active); };
      const observer = new IntersectionObserver(entries => { intersecting = entries[0].isIntersecting; visibility(); }, { threshold: .1 });
      observer.observe(ref.current!); document.addEventListener('visibilitychange', visibility);
      return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); };
    }, ref);
    return () => media.revert();
  }, { scope: ref, dependencies: [playing], revertOnUpdate: true });
  const choose = contextSafe((index: number) => { setStage(index); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) gsap.fromTo(ref.current!.querySelector('.sculpture-caption'), { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: .35, overwrite: true }); });
  return <div className="memory-sculpture" ref={ref}>
    <div className="sculpture-heading"><span><i/>O FIO DA MEMÓRIA</span><button onClick={() => setPlaying(value => !value)} aria-label={playing ? 'Pausar animação' : 'Reproduzir animação'}>{playing ? <Pause size={11}/> : <Play size={11}/>}</button></div>
    <svg viewBox="0 0 600 408" className="memory-svg" role="img" aria-label="Fios convergem em uma memória compartilhada e seguem para a próxima inteligência">
      <g className="sculpture-grid" stroke="#d7d2c9" strokeWidth=".5" fill="none"><path d="M46 25V385M300 25V385M556 25V385M24 204H578" strokeDasharray="2 6"/><path d="M41 31h10m-5-5v10M551 31h10m-5-5v10M41 377h10m-5-5v10M551 377h10m-5-5v10" strokeWidth="1"/></g>
      <g className="memory-geometry" fill="none" strokeLinecap="round">{strands.map((d, i) => <path className="memory-strand" d={d} key={i} stroke={i % 9 === 0 ? '#c38565' : '#817b70'} strokeOpacity={i % 9 === 0 ? .75 : .36} strokeWidth={i % 9 === 0 ? 1.1 : .75}/>)}{[6, 17, 29].map((i, index) => <path className="memory-signal" key={i} d={strands[i]} stroke="#d96e42" strokeWidth="2" strokeDasharray="18 1082" strokeDashoffset={-index * 320}/>)}</g>
      <g fill="#c76a42"><circle cx="46" cy="204" r="3"/><circle cx="556" cy="204" r="3"/><circle cx="301" cy="204" r="4" stroke="#f6f3ed" strokeWidth="2"/></g><g fill="#91897b" fontSize="8" fontFamily="monospace"><text x="46" y="365">ORIGEM</text><text x="514" y="365">DESTINO</text><text x="275" y="62">AXON / 01</text></g>
    </svg>
    <div className="sculpture-caption"><span>{stages[stage].label}</span><p>{stages[stage].caption}<ArrowUpRight size={13}/></p></div>
    <div className="sculpture-stages" role="group" aria-label="Etapas da continuidade">{stages.map((item, index) => <button key={item.name} aria-pressed={stage === index} onClick={() => choose(index)}><span>0{index + 1}</span>{item.name}</button>)}</div>
  </div>;
}
