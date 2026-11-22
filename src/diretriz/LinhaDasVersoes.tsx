import type { CharterRevision } from '../../shared/continuity';
import { quandoEPor, resumoDaVersao, tituloDaVersao } from './versoes';

/** A linha do tempo das versões: cada uma é um botão que mostra o texto dela. */
export function LinhaDasVersoes({ versoes, vigente, vendo, abrir }: { versoes: CharterRevision[]; vigente: CharterRevision; vendo: number | null; abrir: (revisao: number) => void }) {
  const aberta = vendo ?? vigente.revision;
  return <footer className="dz-versoes">
    <h3>Versões · {versoes.length}</h3>
    <div className="dz-linha-do-tempo">
      {versoes.map(versao => <button key={versao.id} type="button" aria-current={aberta === versao.revision ? 'true' : undefined}
        className={`dz-versao${versao.revision === vigente.revision ? ' vigente' : ''}${aberta === versao.revision ? ' vendo' : ''}`}
        onClick={() => abrir(versao.revision)}>
        <i className="dz-ponto" aria-hidden="true"/>
        <b>{tituloDaVersao(versao, vigente)}</b>
        <span>{quandoEPor(versao)}</span>
        <span>{resumoDaVersao(versao)}</span>
      </button>)}
    </div>
  </footer>;
}
