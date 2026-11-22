import { tituloLegivel, type Secao } from './secoes';

export function IndiceDaDiretriz({ secoes, nomeDoProjeto, ativo, irPara }: { secoes: Secao[]; nomeDoProjeto: string; ativo: number | null; irPara: (indice: number) => void }) {
  return <nav className="dz-indice" aria-label="Seções da diretriz">
    <h3>Nesta diretriz</h3>
    <ol>
      {secoes.map((secao, i) => <li key={i}>
        <a href={`#secao-${i}`} className={ativo === i ? 'ativo' : undefined} aria-current={ativo === i ? 'location' : undefined}
          onClick={event => { event.preventDefault(); irPara(i); }}>
          <span className="dz-indice-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          {secao.titulo ? tituloLegivel(secao.titulo, nomeDoProjeto) : 'Sem título'}
        </a>
      </li>)}
    </ol>
  </nav>;
}
