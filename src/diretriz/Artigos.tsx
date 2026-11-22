import { chaveDaChegada } from '../chegada/chegada';
import { artigoDe, type Secao } from './secoes';

/** As seções da diretriz como artigos numerados (cada uma é um destino do destaque de chegada comum). */
export function Artigos({ secoes, nomeDoProjeto, prefixo = 'dz' }: { secoes: Secao[]; nomeDoProjeto: string; prefixo?: string }) {
  return <div className="dz-artigos">
    {secoes.map((secao, i) => {
      const artigo = artigoDe(secao, nomeDoProjeto);
      return <section key={i} className="dz-artigo" data-chegada={chaveDaChegada('diretriz', String(i))} data-tom={artigo.tom} tabIndex={-1} aria-labelledby={`${prefixo}-titulo-${i}`}>
        <span className="dz-artigo-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
        <h3 id={`${prefixo}-titulo-${i}`}>{artigo.titulo}</h3>
        {artigo.itens ? <ul>{artigo.itens.map((item, j) => <li key={j}>{item}</li>)}</ul> : <p>{artigo.texto}</p>}
      </section>;
    })}
  </div>;
}
