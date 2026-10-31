import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Copy, RefreshCw } from 'lucide-react';
import type { Carta, GrupoFalta, ItemFalta, ItemFeito, RascunhoAutomaticoVisivel, SalvamentoResumo } from '../../shared/carta';
import { BotoesDeApagar, DescartarRascunhoAutomatico } from '../apagar/BotoesDeApagar';
import { api, errorText } from '../api';
import { useEntrada } from '../entrada';
import { useFeedback } from '../Feedback';
import type { EstadoDaCarta } from './useCarta';
import { fraseDoSalvamento, horaDoSalvamento, listasDoSalvamento, rotuloDoSalvamento } from './salvamentos';
import {
  atorDaConfirmacao,
  contar,
  cortarTexto,
  diaEMes,
  dicaDoItem,
  etapaDoItem,
  fraseParaContinuar,
  gruposDaFalta,
  linhaDeSaude,
  podeConfirmar,
  rotuloDaOrigem,
  rotuloDoMes,
  ultimaVezAqui,
  type GrupoDaTela,
} from './texto';
import './onde-paramos.css';

/**
 * Tela "Onde paramos": a carta de retorno do projeto, para o dono ler de cima a baixo depois de um tempo
 * longe. Tudo vem pronto de `GET /api/projects/:id/carta`; a regra (o que entra em cada grupo, as datas,
 * as frases) mora em `server/carta/` e em `./texto.ts`. Aqui só se desenha e se liga o botão.
 *
 * A Axon não abre IA: "Continuar com o Claude" só copia uma frase para colar no Claude Code.
 */

const LIMITE_DO_DETALHE = 240;

export function OndeParamos(props: { projectId: string; estado: EstadoDaCarta; aoConfirmarDecisao: () => Promise<void> }) {
  const { projectId, estado, aoConfirmarDecisao } = props;
  const { carta, carregando, erro, recarregar } = estado;

  if (carta === null && carregando) {
    return <div className="loading" role="status"><RefreshCw size={18} />Carregando onde paramos…</div>;
  }
  if (carta === null) {
    return (
      <section className="carta" aria-label="Onde paramos">
        <div className="alert" role="alert">
          <span>{erro}</span>
          <button type="button" onClick={recarregar}>Tentar novamente</button>
        </div>
      </section>
    );
  }
  return (
    <CartaPronta
      projectId={projectId}
      carta={carta}
      erro={erro}
      recarregar={recarregar}
      aoConfirmarDecisao={aoConfirmarDecisao}
    />
  );
}

function CartaPronta(props: { projectId: string; carta: Carta; erro: string; recarregar: () => void; aoConfirmarDecisao: () => Promise<void> }) {
  const { projectId, carta, erro, recarregar, aoConfirmarDecisao } = props;
  const { conta } = useEntrada();
  const notificar = useFeedback();
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [falha, setFalha] = useState('');
  const grupos = gruposDaFalta(carta.falta);
  const saude = linhaDeSaude(carta.saude, carta.ultimaAtividade);
  const semFeito = carta.feitoRecente.length === 0 && carta.feitoPorMes.length === 0 && carta.rascunhoAutomatico === null;

  async function confirmar(item: ItemFalta & { versao: number }) {
    setFalha('');
    setConfirmandoId(item.id);
    try {
      await api.acceptDecision(projectId, item.id, { actor: atorDaConfirmacao(conta), expectedVersion: item.versao });
    } catch (falhaAoConfirmar) {
      // A decisão pode ter mudado por outro lado (409): a carta se atualiza e o aviso fica visível mesmo se o item sumir.
      setFalha(`Não foi possível confirmar “${item.titulo}”. ${errorText(falhaAoConfirmar)}`);
      recarregar();
      setConfirmandoId(null);
      return;
    }
    notificar('Decisão confirmada', item.titulo);
    recarregar();
    await aoConfirmarDecisao();
    setConfirmandoId(null);
  }

  return (
    <section className="carta" aria-labelledby="carta-titulo">
      <header>
        <h2 id="carta-titulo" className="carta-titulo">Onde paramos</h2>
        <p className="carta-ultima">{ultimaVezAqui(carta.ultimaAtividade, carta.diasParado)}</p>
      </header>

      {erro && (
        <div className="alert" role="alert">
          <span>Não foi possível atualizar agora; esta é a última leitura que deu certo. {erro}</span>
          <button type="button" onClick={recarregar}>Tentar novamente</button>
        </div>
      )}

      {falha && (
        <div className="alert" role="alert">
          <span>{falha}</span>
          <button type="button" onClick={() => setFalha('')}>Fechar aviso</button>
        </div>
      )}

      {carta.avisos.length > 0 && <Avisos avisos={carta.avisos} />}

      <section className="carta-bloco" aria-labelledby="carta-frase-titulo">
        <h3 id="carta-frase-titulo">Em uma frase</h3>
        {carta.emUmaFrase
          ? <p className="carta-frase">{carta.emUmaFrase}</p>
          : <p className="carta-vazio">Ainda não há uma frase simples do estado do projeto. Quando uma IA salvar um registro com a frase para o dono, ela aparece aqui.</p>}
      </section>

      <section className="carta-bloco" aria-labelledby="carta-feito-titulo">
        <h3 id="carta-feito-titulo">O que foi feito</h3>
        {carta.rascunhoAutomatico && <RascunhoAutomatico projectId={projectId} rascunho={carta.rascunhoAutomatico} recarregar={recarregar} />}
        {carta.feitoRecente.length > 0 && (
          <>
            <h4 className="carta-subtitulo">Recente</h4>
            <ListaDoFeito itens={carta.feitoRecente} />
          </>
        )}
        {carta.feitoPorMes.map(mes => (
          <details className="carta-mes" key={mes.mes}>
            <summary>{rotuloDoMes(mes)}</summary>
            <ListaDoFeito itens={mes.itens} />
          </details>
        ))}
        {semFeito && <p className="carta-vazio">Nada concluído registrado ainda. Quando um cartão for concluído ou uma IA salvar um registro, o que foi feito aparece aqui.</p>}
      </section>

      <section className="carta-bloco" aria-labelledby="carta-falta-titulo">
        <h3 id="carta-falta-titulo">O que falta</h3>
        {grupos.length === 0 && <p className="carta-vazio">Nenhuma pendência registrada: nada espera por você, nada está travado ou em andamento, e não há ideias guardadas.</p>}
        {grupos.map(grupo => (
          <GrupoDaFalta key={grupo.id} grupo={grupo} confirmandoId={confirmandoId} aoConfirmar={confirmar} />
        ))}
      </section>

      {carta.salvamentos.length > 0 && <SalvamentosDeCompactacao projectId={projectId} salvamentos={carta.salvamentos} recarregar={recarregar} />}

      {saude && <p className="carta-saude">{saude}</p>}

      <ContinuarComOClaude nomeDoProjeto={carta.projeto.nome} />
    </section>
  );
}

/**
 * Avisos curtos que a carta traz prontos (lote 2, D2: diretriz velha). Sem aviso, a seção não aparece:
 * não ter o que avisar é o estado normal.
 */
function Avisos({ avisos }: { avisos: string[] }) {
  return (
    <section className="carta-bloco" aria-labelledby="carta-avisos-titulo">
      <h3 id="carta-avisos-titulo">Avisos</h3>
      <ul className="carta-avisos">
        {avisos.map(aviso => <li key={aviso}>{aviso}</li>)}
      </ul>
    </section>
  );
}

function RascunhoAutomatico({ projectId, rascunho, recarregar }: { projectId: string; rascunho: RascunhoAutomaticoVisivel; recarregar: () => void }) {
  const { resumo, atualizadoEm, versao } = rascunho;
  return (
    <details className="carta-rascunho">
      <summary>Última sessão, anotada sozinha · {diaEMes(atualizadoEm)}</summary>
      <p className="carta-rascunho-aviso">
        Este resumo foi gravado automaticamente pelo Claude Code, sem revisão. O registro desta etapa ainda não foi gravado na Axon.
      </p>
      {/* Texto longo que rola: precisa de foco para quem usa só o teclado. */}
      <div className="carta-rascunho-texto" tabIndex={0} role="region" aria-label="Resumo da última sessão">{resumo}</div>
      {versao !== undefined && <DescartarRascunhoAutomatico projectId={projectId} versao={versao} onDescartado={recarregar} />}
    </details>
  );
}

/**
 * Os salvamentos que o Claude gravou antes de a conversa compactar (D5): os mais recentes, recolhidos.
 * Cada um abre inteiro. Sem salvamento, a seção não aparece (como um grupo vazio de "O que falta").
 */
function SalvamentosDeCompactacao({ projectId, salvamentos, recarregar }: { projectId: string; salvamentos: SalvamentoResumo[]; recarregar: () => void }) {
  return (
    <section className="carta-bloco" aria-labelledby="carta-salvamentos-titulo">
      <h3 id="carta-salvamentos-titulo">Salvamentos de compactação</h3>
      <p className="carta-salvamentos-aviso">
        Antes de a conversa ser compactada, o Claude grava aqui o estado completo do trabalho. Os mais recentes ficam primeiro.
      </p>
      {salvamentos.map(salvamento => <Salvamento key={salvamento.id} projectId={projectId} salvamento={salvamento} recarregar={recarregar} />)}
    </section>
  );
}

/**
 * Um salvamento aberto: na frente, a frase para o dono, os pedidos, as pendências, as perguntas e o
 * próximo passo. O resumo técnico e os arquivos mexidos ficam recolhidos em "Detalhes técnicos".
 */
function Salvamento({ projectId, salvamento, recarregar }: { projectId: string; salvamento: SalvamentoResumo; recarregar: () => void }) {
  return (
    <details className="carta-salvamento">
      <summary>{rotuloDoSalvamento(salvamento)}</summary>
      <div className="carta-salvamento-corpo">
        <p className="carta-salvamento-frase">{fraseDoSalvamento(salvamento)}</p>
        {listasDoSalvamento(salvamento).map(lista => (
          <div key={lista.titulo}>
            <h4>{lista.titulo}</h4>
            <ul>{lista.itens.map((item, indice) => <li key={indice}>{item}</li>)}</ul>
          </div>
        ))}
        <h4>Próximo passo</h4>
        <p className="carta-salvamento-passo">{salvamento.proximoPasso}</p>
        <DetalhesTecnicos salvamento={salvamento} />
        <BotoesDeApagar projectId={projectId} checkpointId={salvamento.id} onApagado={recarregar} />
      </div>
    </details>
  );
}

function DetalhesTecnicos({ salvamento }: { salvamento: SalvamentoResumo }) {
  return (
    <details className="carta-salvamento-tecnico">
      <summary>Detalhes técnicos</summary>
      <h5>Estado</h5>
      {/* Texto longo que rola: precisa de foco para quem usa só o teclado. */}
      <div className="carta-rascunho-texto" tabIndex={0} role="region" aria-label={`Estado salvo em ${horaDoSalvamento(salvamento.criadoEm)}`}>
        {salvamento.resumo}
      </div>
      {salvamento.arquivosMexidos.length > 0 && (
        <>
          <h5>Arquivos mexidos</h5>
          <ul>{salvamento.arquivosMexidos.map((arquivo, indice) => <li key={indice}>{arquivo}</li>)}</ul>
        </>
      )}
    </details>
  );
}

function ListaDoFeito({ itens }: { itens: ItemFeito[] }) {
  return (
    <ul className="carta-feito">
      {itens.map(item => (
        <li key={`${item.origem}-${item.id}`}>
          <span>{item.texto}</span>
          <time dateTime={item.quando}>{diaEMes(item.quando)}</time>
        </li>
      ))}
    </ul>
  );
}

function GrupoDaFalta(props: { grupo: GrupoDaTela; confirmandoId: string | null; aoConfirmar: (item: ItemFalta & { versao: number }) => Promise<void> }) {
  const { grupo, confirmandoId, aoConfirmar } = props;
  const lista = (
    <ul className="carta-itens">
      {grupo.itens.map(item => (
        <ItemDaFalta
          key={`${item.origem}-${item.id}`}
          grupo={grupo.id}
          item={item}
          confirmando={confirmandoId === item.id}
          aoConfirmar={aoConfirmar}
        />
      ))}
    </ul>
  );
  const idDoTitulo = `carta-grupo-${grupo.id}`;
  return (
    <section className="carta-grupo" data-grupo={grupo.id} aria-labelledby={idDoTitulo}>
      <h4 id={idDoTitulo}>
        {grupo.titulo}{' '}
        <span className="carta-contagem">{grupo.itens.length}</span>
      </h4>
      {grupo.recolhido
        ? <details><summary>Ver {contar(grupo.itens.length, 'ideia', 'ideias')}</summary>{lista}</details>
        : lista}
    </section>
  );
}

function ItemDaFalta(props: { grupo: GrupoFalta; item: ItemFalta; confirmando: boolean; aoConfirmar: (item: ItemFalta & { versao: number }) => Promise<void> }) {
  const { grupo, item, confirmando, aoConfirmar } = props;
  const etapa = etapaDoItem(grupo, item);
  const dica = dicaDoItem(item);

  return (
    <li className="carta-item">
      <div className="carta-item-topo">
        <span className="carta-origem">{rotuloDaOrigem(item.origem)}</span>
        {etapa && <span className="carta-etapa">{etapa}</span>}
      </div>
      <p className="carta-item-titulo">{item.titulo}</p>
      {item.detalhe && <Detalhe rotulo={grupo === 'travado' ? 'Motivo: ' : ''} texto={item.detalhe} />}
      {dica && <p className="carta-dica">{dica}</p>}
      {podeConfirmar(item) && (
        <div className="carta-item-acao">
          <button
            type="button"
            className="button secondary"
            disabled={confirmando}
            aria-busy={confirmando}
            aria-label={`Confirmar decisão: ${item.titulo}`}
            onClick={() => void aoConfirmar(item)}
          >
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

function ContinuarComOClaude({ nomeDoProjeto }: { nomeDoProjeto: string }) {
  const frase = fraseParaContinuar(nomeDoProjeto);
  const [copiado, setCopiado] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const campo = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!falhou) return;
    campo.current?.focus();
    campo.current?.select();
  }, [falhou]);

  async function copiar() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unsupported');
      await navigator.clipboard.writeText(frase);
      setCopiado(true);
      setFalhou(false);
    } catch {
      setCopiado(false);
      setFalhou(true);
    }
  }

  return (
    <section className="carta-continuar" aria-labelledby="carta-continuar-titulo">
      <div>
        <h3 id="carta-continuar-titulo">Continuar de onde paramos</h3>
        <p>
          Copia uma frase para você colar no Claude Code. A Axon não abre a IA; se a pasta do projeto estiver conectada à Axon, o Claude já chega sabendo de tudo.
        </p>
      </div>
      <button type="button" className="button primary" onClick={() => void copiar()}>
        <Copy size={16} />
        Continuar com o Claude
      </button>
      {copiado && (
        <p className="carta-copiado" role="status">
          <Check size={16} />
          Frase copiada. Cole no Claude Code.
        </p>
      )}
      {falhou && (
        <div className="carta-copia-manual">
          <p className="carta-erro" role="alert">
            <AlertCircle size={14} /> Não consegui copiar sozinho. Selecione a frase abaixo e copie à mão (Ctrl+C).
          </p>
          <label htmlFor="carta-frase-manual">Frase para colar no Claude Code</label>
          <input id="carta-frase-manual" ref={campo} readOnly value={frase} />
        </div>
      )}
    </section>
  );
}
