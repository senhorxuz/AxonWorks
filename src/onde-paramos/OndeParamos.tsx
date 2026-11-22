import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Copy, RefreshCw } from 'lucide-react';
import type { Carta, GrupoFalta, ItemFalta, RascunhoAutomaticoVisivel, SalvamentoResumo } from '../../shared/carta';
import { BotoesDeApagar, DescartarRascunhoAutomatico } from '../apagar/BotoesDeApagar';
import { api, errorText } from '../api';
import { useEntrada } from '../entrada';
import { EntregasEmAndamento } from '../entregas/EntregasEmAndamento';
import { useFeedback } from '../Feedback';
import { coisasDaCarta } from '../fio/coisas';
import { FioDoProjeto } from '../fio/FioDoProjeto';
import { abrirParaMostrar } from './chegada';
import { ColunaFalta } from './ColunaFalta';
import { ColunaFeito, chaveDoMes, type ControleDoFeito } from './ColunaFeito';
import { diasDoFeito } from './dias';
import { useChegada } from './useChegada';
import type { EstadoDaCarta } from './useCarta';
import { fraseDoSalvamento, horaDoSalvamento, listasDoSalvamento, rotuloDoSalvamento } from './salvamentos';
import {
  atorDaConfirmacao,
  diaEMes,
  fraseParaContinuar,
  gruposDaFalta,
  linhaDeSaude,
  ultimaVezAqui,
} from './texto';
import './onde-paramos.css';

/**
 * Tela "Onde paramos": a carta de retorno do projeto, para o dono ler de cima a baixo depois de um tempo
 * longe. Tudo vem pronto de `GET /api/projects/:id/carta`; a regra (o que entra em cada grupo, as datas,
 * as frases) mora em `server/carta/` e em `./texto.ts`. Aqui só se desenha e se liga o botão.
 *
 * A Axon não abre IA: "Continuar com o Claude" só copia uma frase para colar no Claude Code.
 */

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
      key={projectId}
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
  const coisasDaLista = useMemo(() => coisasDaCarta(carta), [carta]);
  const coisasDoFio = coisasDaLista.validas;
  // A coluna conta tudo o que a lista mostra (também o grupo "Sem data"); o fio desenha só as de data válida.
  const totalDoFeito = coisasDoFio.length + coisasDaLista.semData.length;
  const lista = useMemo(() => diasDoFeito(carta), [carta]);
  const raiz = useRef<HTMLElement>(null);
  const { chegou, irPara } = useChegada(raiz);
  // Só o dia de onde paramos começa aberto; o que o dono abre depois fica aberto enquanto a carta é relida.
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(() => new Set(lista.diaAberto === null ? [] : [lista.diaAberto]));
  // Se uma releitura trouxer a coisa mais nova num dia novo, esse dia também abre; o que o dono abriu fica como está.
  useEffect(() => {
    const novo = lista.diaAberto;
    if (novo !== null) setAbertos(antes => (antes.has(novo) ? antes : new Set([...antes, novo])));
  }, [lista.diaAberto]);
  const [linhasAbertas, setLinhasAbertas] = useState<ReadonlySet<string>>(() => new Set());
  // O símbolo do fio e a linha da lista são a mesma coisa: um acende o outro.
  const [apontadaNoFio, setApontadaNoFio] = useState<string | null>(null);
  const [apontadaNaLista, setApontadaNaLista] = useState<string | null>(null);
  const aoAbrir = useCallback((chave: string, aberto: boolean) => setAbertos(antes => comOuSem(antes, chave, aberto)), []);
  const aoAbrirLinha = useCallback((chave: string, aberta: boolean) => setLinhasAbertas(antes => comOuSem(antes, chave, aberta)), []);
  const controle: ControleDoFeito = {
    abertos, aoAbrir, linhasAbertas, aoAbrirLinha,
    chaveAcesa: apontadaNoFio, aoApontar: setApontadaNaLista,
    chegou: chegou?.tipo === 'coisa' ? chegou.chave : null,
  };

  /** Clique num símbolo do fio: abre o que esconde a linha e leva a tela até ela. */
  function irParaCoisa(chave: string) {
    const onde = abrirParaMostrar(lista, chave);
    if (!onde) return;
    setAbertos(antes => new Set([...antes, onde.dia, ...(onde.mes === null ? [] : [chaveDoMes(onde.mes)])]));
    if (chave !== lista.chaveDeOndeParamos) aoAbrirLinha(chave, true);
    irPara({ tipo: 'coisa', chave });
  }
  const irParaGrupo = (grupo: GrupoFalta) => irPara({ tipo: 'grupo', grupo });

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
    <section className="carta" aria-labelledby="carta-titulo" ref={raiz}>
      <header className={carta.emUmaFrase ? 'carta-cabeca carta-cabeca-com-manchete' : 'carta-cabeca'}>
        <h2 id="carta-titulo" className="carta-titulo">Onde paramos</h2>
        <p className="carta-ultima">{ultimaVezAqui(carta.ultimaAtividade, carta.diasParado)}</p>
        {carta.emUmaFrase
          ? <p className="carta-frase carta-manchete">{carta.emUmaFrase}</p>
          : <p className="carta-vazio">Ainda não há uma frase simples do estado do projeto. Quando uma IA salvar um registro com a frase para o dono, ela aparece aqui.</p>}
      </header>

      <FioDoProjeto projetoId={carta.projeto.id} coisas={coisasDoFio} falta={carta.falta} aoEscolher={irParaCoisa} aoApontar={setApontadaNoFio} chaveAcesa={apontadaNaLista} aoIrParaGrupo={irParaGrupo} />

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

      <ColunaFeito
        lista={lista}
        total={totalDoFeito}
        manchete={carta.emUmaFrase}
        controle={controle}
        vazio={semFeito}
        rascunho={carta.rascunhoAutomatico && <RascunhoAutomatico projectId={projectId} rascunho={carta.rascunhoAutomatico} recarregar={recarregar} />}
      />

      <ColunaFalta grupos={grupos} confirmandoId={confirmandoId} aoConfirmar={confirmar} chegou={chegou?.tipo === 'grupo' ? chegou.grupo : null} aoIrParaGrupo={irParaGrupo} />

      <EntregasEmAndamento entregas={carta.entregas} />

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

/** O mesmo conjunto, com a chave dentro ou fora. */
function comOuSem(conjunto: ReadonlySet<string>, chave: string, dentro: boolean): ReadonlySet<string> {
  const novo = new Set(conjunto);
  if (dentro) novo.add(chave); else novo.delete(chave);
  return novo;
}
