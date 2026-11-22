import { CLASSE_DA_CHEGADA } from '../chegada/irPara';
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { GrupoFalta, ItemFalta } from '../../shared/carta';
import { Rolagem } from './Rolagem';
import { contar, cortarTexto, dicaDoItem, etapaDoItem, podeConfirmar, rotuloDaOrigem, type GrupoDaTela } from './texto';

/**
 * "O que falta": os cinco grupos de sempre, na mesma ordem, com um atalho por grupo no alto da coluna.
 * Cada item é uma linha (sem caixa), com uma barra fina na cor do grupo. As ações ficam sempre à vista.
 */

const LIMITE_DO_DETALHE = 240;

type Confirmar = (item: ItemFalta & { versao: number }) => Promise<void>;

export function ColunaFalta(props: { grupos: GrupoDaTela[]; confirmandoId: string | null; aoConfirmar: Confirmar; chegou: GrupoFalta | null; aoIrParaGrupo: (grupo: GrupoFalta) => void }) {
  const { grupos, confirmandoId, aoConfirmar, chegou, aoIrParaGrupo } = props;
  const total = grupos.reduce((soma, grupo) => soma + grupo.itens.length, 0);
  return (
    <section className="carta-bloco carta-coluna carta-bloco-falta" aria-labelledby="carta-falta-titulo">
      <header className="coluna-topo">
        <h3 id="carta-falta-titulo">O que falta</h3>
        {total > 0 && <span className="coluna-conta">{contar(total, 'item', 'itens')}</span>}
        {grupos.length > 0 && (
          <div className="coluna-atalhos" role="group" aria-label="Ir para um grupo">
            {grupos.map(grupo => (
              <button key={grupo.id} type="button" className="coluna-atalho" data-destino={grupo.id} onClick={() => aoIrParaGrupo(grupo.id)}>
                <b>{grupo.itens.length}</b> {grupo.titulo}
              </button>
            ))}
          </div>
        )}
      </header>
      <Rolagem rotulo="O que falta">
        {grupos.length === 0 && <p className="carta-vazio">Nenhuma pendência registrada: nada espera por você, nada está travado ou em andamento, e não há ideias guardadas.</p>}
        {grupos.map(grupo => (
          <GrupoDaFalta key={grupo.id} grupo={grupo} confirmandoId={confirmandoId} aoConfirmar={aoConfirmar} chegou={chegou === grupo.id} />
        ))}
      </Rolagem>
    </section>
  );
}

function GrupoDaFalta({ grupo, confirmandoId, aoConfirmar, chegou }: { grupo: GrupoDaTela; confirmandoId: string | null; aoConfirmar: Confirmar; chegou: boolean }) {
  const idDoTitulo = `carta-grupo-${grupo.id}`;
  return (
    <section className={chegou ? `carta-grupo carta-chegou ${CLASSE_DA_CHEGADA}` : 'carta-grupo'} data-grupo={grupo.id} aria-labelledby={idDoTitulo} tabIndex={-1}>
      <h4 id={idDoTitulo}>
        {grupo.titulo}{' '}
        <span className="carta-contagem">{grupo.itens.length}</span>
      </h4>
      <ul className="carta-itens">
        {grupo.itens.map(item => (
          <ItemDaFalta key={`${item.origem}-${item.id}`} grupo={grupo.id} item={item} confirmando={confirmandoId === item.id} aoConfirmar={aoConfirmar} />
        ))}
      </ul>
    </section>
  );
}

function ItemDaFalta({ grupo, item, confirmando, aoConfirmar }: { grupo: GrupoFalta; item: ItemFalta; confirmando: boolean; aoConfirmar: Confirmar }) {
  const etapa = etapaDoItem(grupo, item);
  const dica = dicaDoItem(item);
  return (
    <li className="carta-item">
      <p className="carta-item-titulo">{item.titulo}</p>
      {item.detalhe && <Detalhe rotulo={grupo === 'travado' ? 'Motivo: ' : ''} texto={item.detalhe} />}
      {dica && <p className="carta-dica">{dica}</p>}
      <div className="carta-item-topo">
        <span className="carta-origem">{rotuloDaOrigem(item.origem)}</span>
        {etapa && <span className="carta-etapa">{etapa}</span>}
      </div>
      {podeConfirmar(item) && (
        <div className="carta-item-acao">
          <button type="button" className="button secondary" disabled={confirmando} aria-busy={confirmando} aria-label={`Confirmar decisão: ${item.titulo}`} onClick={() => void aoConfirmar(item)}>
            <Check size={15} />
            Confirmar decisão
          </button>
        </div>
      )}
    </li>
  );
}

/** Descrição do item: até 240 caracteres; o resto abre com "Ver tudo". */
function Detalhe({ rotulo, texto }: { rotulo: string; texto: string }) {
  const [aberto, setAberto] = useState(false);
  const curto = cortarTexto(texto, LIMITE_DO_DETALHE);
  const cortado = curto !== texto;
  return (
    <>
      <p className="carta-detalhe">
        {rotulo && <span className="carta-rotulo">{rotulo}</span>}
        {aberto || !cortado ? texto : curto}
      </p>
      {cortado && (
        <button type="button" className="text-button carta-ver-mais" aria-expanded={aberto} onClick={() => setAberto(valor => !valor)}>
          {aberto ? 'Ver menos' : 'Ver tudo'}
        </button>
      )}
    </>
  );
}
