import { memo, useId, useMemo, useState, type CSSProperties } from 'react';
import { desenharFio, rotuloCurtoDaData, type DesenhoDoFio, type NoDesenhado } from './desenho';
import { nosDaMiniatura, quaisRotular, resumoDosDias, type DiaDoFio, type PontaDoFio } from './dados';
import './fio.css';

/**
 * O fio do projeto, grande: topo de "Onde paramos".
 *
 * Feito para ser lido: um nó por DIA (o tamanho e o número dizem quanto foi feito), as datas na régua,
 * o nó aceso em "onde paramos" e um fio solto por grupo de pendência, com o nome escrito na ponta.
 * A regra do desenho mora em ./desenho.ts e ./dados.ts; aqui só se pinta.
 */

const LARGURA = 1200;
const ALTURA = 190;
const DICA_MAX_ITENS = 3;

const TINTA = '#e6e2d9';
const BRASA = '#e8794a';

type Estilo = CSSProperties & Record<`--${string}`, string | number>;

const pct = (valor: number, total: number) => `${((valor / total) * 100).toFixed(2)}%`;

/** Raio do nó pelo tanto que foi feito no dia: 1 item é um nó pequeno; 40, um nó grande. */
function raioDoDia(quantidade: number): number {
  return Math.min(11, 3.2 + Math.sqrt(quantidade) * 1.5);
}

export function FioDoProjeto({ semente, dias, pontas }: { semente: string; dias: DiaDoFio[]; pontas: PontaDoFio[] }) {
  const id = useId().replace(/:/g, '');
  const principal = useMemo(() => desenharFio({ semente, nos: dias, pontasSoltas: pontas.length, largura: LARGURA, altura: ALTURA, fibras: 15 }), [semente, dias, pontas.length]);
  const fundo = useMemo(() => desenharFio({ semente: `${semente}·fundo`, nos: dias, pontasSoltas: pontas.length, largura: LARGURA, altura: ALTURA, fibras: 11, abertura: 0.55 }), [semente, dias, pontas.length]);
  const [ativo, setAtivo] = useState<number | null>(null);

  // Os nós desenhados vêm em ordem de tempo, como os dias; o máximo de nós do desenho já foi respeitado.
  const diasDesenhados = principal.nos.map(no => dias.find(d => d.quando === no.quando)!);
  const ultimo = principal.nos.at(-1);
  const fim = principal.fimDoTrancado / LARGURA;
  const meio = Math.floor(principal.fibras.length / 2);
  const resumo = resumoDosDias(dias, pontas);
  const pendencias = pontas.map(p => `${p.quantidade} ${p.rotulo.toLowerCase()}`).join(', ');
  const palco: Estilo = {
    '--fio-fim': pct(principal.fimDoTrancado, LARGURA),
    '--fio-fim-num': fim.toFixed(3),
    '--fio-fim-y': pct(ultimo?.y ?? principal.origem.y, ALTURA),
  };
  // O rótulo do fim ("onde paramos · 04 nov") é uns três rótulos de largura e fica 70% à esquerda do nó.
  const datas = quaisRotular(principal.nos.map(n => n.x), LARGURA * 0.075, LARGURA * 0.15);
  const contagens = quaisRotular(principal.nos.map(n => n.x), LARGURA * 0.028);

  return (
    <figure className="fio-palco" style={palco}>
      <figcaption className="fio-legenda">
        <span className="fio-legenda-titulo">O fio do projeto</span>
        <span className="fio-legenda-tipos" aria-hidden="true">
          <i className="tipo-entrega" />entrega<i className="tipo-cartao" />cartão<i className="tipo-registro" />registro
        </span>
        <span className="fio-legenda-resumo">{resumo}</span>
      </figcaption>

      <div className="fio-tela" onMouseLeave={() => setAtivo(null)}>
        <svg className="fio fio-heroi" viewBox={`0 0 ${LARGURA} ${ALTURA}`} role="img" aria-label={`O fio do projeto: ${resumo}.${pendencias ? ` Pendências: ${pendencias}.` : ''}`}>
          <Definicoes id={id} fim={fim} />
          <g className="fio-camada-fundo" fill="none" stroke={`url(#${id}-fundo)`}>
            {fundo.fibras.map((d, i) => <path key={i} d={d} className="fio-fibra fio-fibra-fundo" pathLength={1} style={{ '--i': i } as Estilo} />)}
          </g>
          <g className="fio-camada-principal" fill="none">
            {principal.fibras.map((d, i) => (
              <path key={i} d={d} pathLength={1} stroke={`url(#${id}-${i % 5 === 2 ? 'brasa' : 'tinta'})`}
                className={i % 5 === 2 ? 'fio-fibra fio-fibra-brasa' : 'fio-fibra'} style={{ '--i': i } as Estilo} />
            ))}
          </g>
          {principal.nos.length > 0 && (
            <path d={principal.fibras[meio]} className="fio-pulso" pathLength={1} fill="none" stroke={BRASA} filter={`url(#${id}-luz)`} />
          )}
          <PontasSoltas desenho={principal} pontas={pontas} />
          {ativo !== null && principal.nos[ativo] && <GuiaDoNo no={principal.nos[ativo]!} />}
          <g className="fio-nos">
            {principal.nos.map((no, i) => (
              <No key={no.quando} no={no} raio={raioDoDia(diasDesenhados[i]!.quantidade)} indice={i} id={id} ativo={ativo === i} aoEntrar={() => setAtivo(i)} />
            ))}
          </g>
        </svg>

        {/* Quanto foi feito em cada dia, em cima do nó (só onde cabe sem encavalar). */}
        {contagens.map(i => {
          const no = principal.nos[i]!;
          return (
            <span key={no.quando} className={`fio-contagem${no.ultimo ? ' fio-contagem-agora' : ''}`} aria-hidden="true"
              style={{ left: pct(no.x, LARGURA), top: pct(no.y - raioDoDia(diasDesenhados[i]!.quantidade) - 5, ALTURA) }}>
              {diasDesenhados[i]!.quantidade}
            </span>
          );
        })}

        {/* O nome de cada grupo de pendência, na ponta do seu fio solto. */}
        {principal.pontas.map((ponta, i) => (
          <span key={pontas[i]!.grupo} className={`fio-ponta-rotulo fio-ponta-${pontas[i]!.destaque}`}
            style={{ left: pct(ponta.fim.x + 9, LARGURA), top: pct(ponta.fim.y, ALTURA), '--i': i } as Estilo}>
            <b>{pontas[i]!.quantidade}</b> {pontas[i]!.rotulo}
          </span>
        ))}

        {ativo !== null && principal.nos[ativo] && <DicaDoDia no={principal.nos[ativo]!} dia={diasDesenhados[ativo]!} />}
      </div>

      <div className="fio-regua" aria-hidden="true">
        {datas.map(i => {
          const no = principal.nos[i]!;
          const rotulo = rotuloCurtoDaData(no.quando);
          return (
            <span key={no.quando} className={`fio-regua-marca${no.ultimo ? ' fio-regua-agora' : ''}`} style={{ left: pct(no.x, LARGURA) }}>
              {no.ultimo ? `onde paramos · ${rotulo}` : rotulo}
            </span>
          );
        })}
      </div>
    </figure>
  );
}

function Definicoes({ id, fim }: { id: string; fim: number }) {
  const parada = (offset: number, cor: string, opacidade: number) => <stop offset={Math.min(1, Math.max(0, offset)).toFixed(3)} stopColor={cor} stopOpacity={opacidade} />;
  return (
    <defs>
      <linearGradient id={`${id}-tinta`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={LARGURA} y2="0">
        {parada(0, TINTA, 0.05)}{parada(fim * 0.55, TINTA, 0.26)}{parada(fim, TINTA, 0.5)}{parada(fim + (1 - fim) * 0.45, TINTA, 0.14)}{parada(1, TINTA, 0)}
      </linearGradient>
      <linearGradient id={`${id}-brasa`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={LARGURA} y2="0">
        {parada(0, BRASA, 0.04)}{parada(fim * 0.6, BRASA, 0.4)}{parada(fim, BRASA, 0.85)}{parada(fim + (1 - fim) * 0.4, BRASA, 0.2)}{parada(1, BRASA, 0)}
      </linearGradient>
      <linearGradient id={`${id}-fundo`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={LARGURA} y2="0">
        {parada(0, TINTA, 0.02)}{parada(fim, TINTA, 0.17)}{parada(1, TINTA, 0)}
      </linearGradient>
      <radialGradient id={`${id}-halo`}>
        <stop offset="0" stopColor={BRASA} stopOpacity="0.55" />
        <stop offset="0.45" stopColor={BRASA} stopOpacity="0.16" />
        <stop offset="1" stopColor={BRASA} stopOpacity="0" />
      </radialGradient>
      <filter id={`${id}-luz`} x="-20%" y="-60%" width="140%" height="220%">
        <feGaussianBlur stdDeviation="2.4" result="borrado" />
        <feMerge><feMergeNode in="borrado" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
}

function PontasSoltas({ desenho, pontas }: { desenho: DesenhoDoFio; pontas: PontaDoFio[] }) {
  return (
    <g className="fio-pontas" fill="none">
      {desenho.pontas.map((ponta, i) => (
        <g key={pontas[i]!.grupo} className={`fio-ponta fio-ponta-${pontas[i]!.destaque}`} style={{ '--i': i } as Estilo}>
          <path d={ponta.d} className="fio-ponta-linha" />
          <circle cx={ponta.fim.x} cy={ponta.fim.y} r="3.2" className="fio-ponta-aro" />
        </g>
      ))}
    </g>
  );
}

function GuiaDoNo({ no }: { no: NoDesenhado }) {
  return <line className="fio-guia" x1={no.x} y1={no.y + 12} x2={no.x} y2={ALTURA} />;
}

function No({ no, raio, indice, id, ativo, aoEntrar }: { no: NoDesenhado; raio: number; indice: number; id: string; ativo: boolean; aoEntrar: () => void }) {
  const classe = ['fio-no', `fio-no-${no.tipo}`, no.ultimo ? 'fio-no-ultimo' : '', ativo ? 'fio-no-ativo' : ''].filter(Boolean).join(' ');
  return (
    <g className={classe} transform={`translate(${no.x.toFixed(1)} ${no.y.toFixed(1)})`} style={{ '--n': indice } as Estilo} onMouseEnter={aoEntrar}>
      {no.ultimo && (
        <>
          <circle r={raio * 3.2} fill={`url(#${id}-halo)`} className="fio-halo" />
          <circle r={raio + 4} className="fio-anel" />
          <circle r={raio + 4} className="fio-anel fio-anel-2" />
        </>
      )}
      <g className="fio-glifo"><Glifo no={no} raio={raio} /></g>
      <circle r={Math.max(14, raio + 6)} className="fio-alvo" />
    </g>
  );
}

function Glifo({ no, raio }: { no: NoDesenhado; raio: number }) {
  if (no.ultimo) return <circle r={raio} className="fio-nucleo" />;
  if (no.tipo === 'tarefa') return <><circle r={raio + 3} className="fio-aro" /><circle r={raio} className="fio-cheio" /></>;
  if (no.tipo === 'cartao') {
    const lado = raio * 1.5;
    return <rect x={-lado / 2} y={-lado / 2} width={lado} height={lado} transform="rotate(45)" className="fio-losango" />;
  }
  return <circle r={raio} className="fio-anelzinho" />;
}

function DicaDoDia({ no, dia }: { no: NoDesenhado; dia: DiaDoFio }) {
  const fracao = no.x / LARGURA;
  const lado = fracao < 0.16 ? 'esquerda' : fracao > 0.84 ? 'direita' : 'meio';
  const resto = dia.itens.length - DICA_MAX_ITENS;
  return (
    <div className="fio-dica" style={{ left: pct(no.x, LARGURA), top: pct(no.y, ALTURA) }} role="tooltip" data-lado={lado}>
      <span className="fio-dica-tipo">
        {no.ultimo ? 'Onde paramos · ' : ''}{rotuloCurtoDaData(no.quando)} · {dia.quantidade} {dia.quantidade === 1 ? 'coisa feita' : 'coisas feitas'}
      </span>
      <ul className="fio-dica-lista">
        {dia.itens.slice(0, DICA_MAX_ITENS).map((texto, i) => <li key={i}><span className="fio-dica-item">{texto}</span></li>)}
      </ul>
      {resto > 0 && <span className="fio-dica-mais">e mais {resto}</span>}
    </div>
  );
}

/**
 * Miniatura para a lista de projetos: o mesmo desenho, pequeno e sem movimento.
 * Depende só do projeto e de quantas versões ele tem: a lista pode ter cem projetos e se redesenhar
 * a cada minuto ("há 3 min"), e o desenho só é refeito quando um projeto ganha versão.
 */
export const FioMiniatura = memo(function FioMiniatura({ semente, versoes }: { semente: string; versoes: number }) {
  const d = useMemo(() => desenharFio({ semente, nos: nosDaMiniatura(versoes), pontasSoltas: 0, largura: 120, altura: 40, fibras: 7 }), [semente, versoes]);
  return (
    <svg className="fio fio-mini" viewBox="0 0 120 40" aria-hidden="true">
      <g fill="none">{d.fibras.map((f, i) => <path key={i} d={f} className={i === 3 ? 'fio-mini-fibra fio-mini-brasa' : 'fio-mini-fibra'} />)}</g>
      {d.nos.map((no, i) => <circle key={i} cx={no.x} cy={no.y} r={no.ultimo ? 2.8 : 1.5} className={no.ultimo ? 'fio-mini-no fio-mini-ultimo' : 'fio-mini-no'} />)}
    </svg>
  );
});
