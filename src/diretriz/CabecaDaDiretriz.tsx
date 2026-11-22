import type { CharterRevision } from '../../shared/continuity';
import { SeloDaDiretriz } from './SeloDaDiretriz';
import type { Manchete } from './secoes';
import { aguardaConferencia, estadoDaDiretriz, legendaDoSelo } from './versoes';

export interface AcoesDaCabeca {
  busy: boolean;
  editando: boolean;
  conferir: () => void;
  voltarAoMeuTexto: () => void;
  editar: () => void;
}

function Acoes({ vigente, acoes }: { vigente: CharterRevision | null; acoes: AcoesDaCabeca }) {
  const { busy, editando } = acoes;
  const deIA = vigente?.sourceKind === 'agent_update';
  const pendente = vigente !== null && aguardaConferencia(vigente);
  return <div className="dz-acoes">
    {pendente && <button type="button" className="dz-botao principal" disabled={busy || editando} onClick={acoes.conferir}>Está certo</button>}
    {deIA && <button type="button" className="dz-botao" disabled={busy || editando} onClick={acoes.voltarAoMeuTexto}>Voltar ao meu texto</button>}
    <button type="button" className={`dz-botao${pendente ? '' : ' principal'}`} disabled={busy || editando} onClick={acoes.editar}>Editar diretriz</button>
  </div>;
}

/** O alto da folha: o objetivo em manchete, as ações, e à direita o selo com o estado e a legenda. */
export function CabecaDaDiretriz({ manchete, vigente, revisoes, idDoProjeto, vendo, registros, verAntiga, acoes }: {
  manchete: Manchete | null; vigente: CharterRevision | null; revisoes: number[]; idDoProjeto: string; vendo: number | null;
  registros: number; verAntiga: boolean; acoes: AcoesDaCabeca;
}) {
  const estado = vigente ? estadoDaDiretriz(vigente) : null;
  return <header className={`dz-cabeca${vigente ? '' : ' sem-selo'}`}>
    <div>
      <p className="dz-rotulo">Diretriz do projeto</p>
      {manchete && <>
        <p className="dz-objetivo-titulo">{manchete.rotulo}</p>
        {manchete.lide && <p className="dz-lide">{manchete.lide}</p>}
        {manchete.resto && <p className="dz-lide-resto">{manchete.resto}</p>}
      </>}
      {!vigente && <p className="dz-lide-vazio">Nenhuma diretriz definida ainda.</p>}
      {!verAntiga && <Acoes vigente={vigente} acoes={acoes}/>}
    </div>
    {vigente && estado && <div className="dz-selo-caixa">
      <SeloDaDiretriz revisoes={revisoes} idDoProjeto={idDoProjeto} vendo={vendo}/>
      <span className={`dz-estado${estado.pendente ? ' pendente' : ''}`}>{estado.texto}</span>
      <p className="dz-selo-legenda">{legendaDoSelo(vigente, registros).map((trecho, i) => trecho.forte ? <b key={i}>{trecho.texto}</b> : trecho.texto)}</p>
    </div>}
  </header>;
}
