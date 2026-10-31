import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlignLeft, CheckSquare, Plus, RefreshCw, Search } from 'lucide-react';
import { Flip } from 'gsap/Flip';
import { BOARD_COLUMNS, BOARD_LABELS, BOARD_LIMITS, type BoardCard, type BoardColumnId } from '../../shared/board';
import { ApiError, errorText } from '../api';
import { gsap } from '../motion';
import { apiQuadro, nomeDoDono } from './api-quadro';
import { CartaoDetalhe } from './CartaoDetalhe';
import { aplicarMovimentoLocal, cardsDaColuna, colunaRecolhida, corDoNome, indiceDeInsercao, inicial, proximoVizinho, resumoDoQuadro, tempoRelativo } from './logica';
import './quadro.css';

gsap.registerPlugin(Flip);

/**
 * Quadro (Parte 14): cartões do projeto em colunas de etapa, estilo Trello.
 * O dono e as IAs mexem; excluir de vez só pela tela. Tudo vem do servidor:
 * a tela só antecipa o movimento enquanto a confirmação não chega.
 */

export const COR_DA_COLUNA: Record<BoardColumnId, string> = {
  ideas: '#94a3b8',
  pending: '#facc15',
  in_progress: '#22d3ee',
  unfinished: '#fb923c',
  testing: '#c084fc',
  awaiting_deploy: '#a3e635',
  done: '#34d399',
  blocked: '#f87171',
  discarded: '#64748b',
};

const NOME_DA_COLUNA = Object.fromEntries(BOARD_COLUMNS.map(c => [c.id, c.name])) as Record<BoardColumnId, string>;
const NOME_DA_ETIQUETA = Object.fromEntries(BOARD_LABELS.map(l => [l.id, l.name])) as Record<string, string>;
const ORDEM_DAS_COLUNAS = BOARD_COLUMNS.map(c => c.id) as BoardColumnId[];
const INTERVALO_AO_VIVO = 15000;
const DURACAO_COMEMORACAO = 1800;

type Arrasto = { cardId: string; colunaAlvo: BoardColumnId | null; indice: number };

type Sessao = {
  cardId: string;
  pointerId: number;
  inicioX: number;
  inicioY: number;
  deslocX: number;
  deslocY: number;
  largura: number;
  comecou: boolean;
  x: number;
  y: number;
};

function reduzirMovimento() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Quadro({ projectId, atualizadoEm }: { projectId: string; atualizadoEm: unknown }) {
  const [cards, setCards] = useState<BoardCard[] | undefined>(undefined);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [filtro, setFiltro] = useState('');
  const [compondoEm, setCompondoEm] = useState<BoardColumnId | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [expandidas, setExpandidas] = useState<Set<BoardColumnId>>(new Set());
  const [comemorando, setComemorando] = useState<Set<string>>(new Set());
  const [anuncio, setAnuncio] = useState('');
  const [agora, setAgora] = useState(() => new Date());

  const trilho = useRef<HTMLDivElement>(null);
  const fantasma = useRef<HTMLDivElement>(null);
  const sessao = useRef<Sessao | null>(null);
  const arrastoRef = useRef<Arrasto | null>(null);
  const ignorarClique = useRef(false);
  const estadoFlip = useRef<Flip.FlipState | null>(null);
  const focoPendente = useRef<string | null>(null);
  const colunasAnteriores = useRef<Map<string, BoardColumnId> | null>(null);
  const autoRolagem = useRef<number | null>(null);

  const comemorar = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setComemorando(prev => new Set([...prev, ...ids]));
    window.setTimeout(() => {
      setComemorando(prev => {
        const proximo = new Set(prev);
        ids.forEach(id => proximo.delete(id));
        return proximo;
      });
    }, DURACAO_COMEMORACAO);
  }, []);

  // Recebe o quadro do servidor. Cartão que a tela viu sair de outra coluna para "Completo" comemora.
  const receber = useCallback((lista: BoardCard[]) => {
    const anteriores = colunasAnteriores.current;
    if (anteriores) {
      const chegaram = lista.filter(c => c.column === 'done' && anteriores.has(c.id) && anteriores.get(c.id) !== 'done').map(c => c.id);
      comemorar(chegaram);
    }
    colunasAnteriores.current = new Map(lista.map(c => [c.id, c.column]));
    setCards(lista);
    setAgora(new Date());
  }, [comemorar]);

  const carregar = useCallback(async (signal?: AbortSignal) => {
    try {
      const quadro = await apiQuadro.quadro(projectId, signal);
      if (signal?.aborted) return;
      receber(quadro.cards);
      setErro('');
    } catch (err) {
      if (signal?.aborted) return;
      setErro(errorText(err));
    }
  }, [projectId, receber]);

  // Troca de projeto: começa do zero, sem comemorar nada da primeira carga.
  useEffect(() => {
    colunasAnteriores.current = null;
    setCards(undefined);
    setAberto(null);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar, atualizadoEm]);

  // Altura: o trilho desce até o fim da janela, e cada coluna rola por dentro.
  // Remede quando a janela muda ou quando algo acima do quadro cresce (ex.: diretriz expandida).
  const temQuadro = cards !== undefined;
  useLayoutEffect(() => {
    const elemento = trilho.current;
    if (!elemento) return;
    const medir = () => {
      const topo = elemento.getBoundingClientRect().top + window.scrollY;
      const altura = Math.max(420, Math.round(window.innerHeight - topo - 24));
      elemento.style.setProperty('--quadro-altura', `${altura}px`);
    };
    medir();
    const observador = new ResizeObserver(medir);
    const principal = document.getElementById('main-content');
    if (principal) observador.observe(principal);
    window.addEventListener('resize', medir);
    return () => { observador.disconnect(); window.removeEventListener('resize', medir); };
  }, [temQuadro]);

  // Ao vivo: enquanto a aba está visível e ninguém está arrastando, busca de novo a cada 15 s.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || sessao.current) return;
      void carregar();
    }, INTERVALO_AO_VIVO);
    return () => window.clearInterval(id);
  }, [carregar]);

  const mostrarAviso = useCallback((texto: string) => {
    setAviso(texto);
    window.setTimeout(() => setAviso(atual => (atual === texto ? '' : atual)), 5000);
  }, []);

  const tratarFalha = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 409) mostrarAviso('Este cartão mudou enquanto você mexia. O quadro foi atualizado.');
    else mostrarAviso(errorText(err));
    void carregar();
  }, [carregar, mostrarAviso]);

  // Movimento: antecipa na tela (com Flip), confirma no servidor e só então comemora.
  const mover = useCallback(async (cardId: string, coluna: BoardColumnId, beforeCardId: string | null, aviso?: string) => {
    if (!cards) return;
    const cartao = cards.find(c => c.id === cardId);
    if (!cartao) return;
    if (!reduzirMovimento() && trilho.current) {
      estadoFlip.current = Flip.getState(trilho.current.querySelectorAll('.quadro-cartao'));
    }
    const antes = cartao.column;
    setCards(atual => (atual ? aplicarMovimentoLocal(atual, cardId, coluna, beforeCardId) : atual));
    if (aviso) setAnuncio(aviso);
    try {
      const salvo = await apiQuadro.mover(projectId, cardId, { actor: nomeDoDono(), expectedVersion: cartao.version, column: coluna, beforeCardId });
      setCards(atual => atual?.map(c => (c.id === salvo.id ? salvo : c)));
      colunasAnteriores.current?.set(salvo.id, salvo.column);
      setAgora(new Date());
      if (salvo.column === 'done' && antes !== 'done') comemorar([salvo.id]);
    } catch (err) {
      tratarFalha(err);
    }
  }, [cards, projectId, comemorar, tratarFalha]);

  useLayoutEffect(() => {
    if (estadoFlip.current && trilho.current) {
      Flip.from(estadoFlip.current, {
        targets: trilho.current.querySelectorAll('.quadro-cartao'),
        duration: 0.45,
        ease: 'power3.out',
        absolute: false,
        nested: true,
      });
      estadoFlip.current = null;
    }
    if (focoPendente.current && trilho.current) {
      trilho.current.querySelector<HTMLElement>(`[data-card-id="${focoPendente.current}"]`)?.focus();
      focoPendente.current = null;
    }
  });

  // ---- Arrastar e soltar ----

  const alvoNoPonto = useCallback((x: number, y: number, cardId: string): Arrasto => {
    const colunas = trilho.current?.querySelectorAll<HTMLElement>('.quadro-coluna[data-coluna]') ?? [];
    for (const coluna of colunas) {
      const caixa = coluna.getBoundingClientRect();
      if (x < caixa.left || x > caixa.right || y < caixa.top - 40 || y > caixa.bottom + 40) continue;
      const id = coluna.dataset.coluna as BoardColumnId;
      const meios = [...coluna.querySelectorAll<HTMLElement>('.quadro-cartao')]
        .filter(el => el.dataset.cardId !== cardId)
        .map(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
      return { cardId, colunaAlvo: id, indice: indiceDeInsercao(y, meios) };
    }
    return { cardId, colunaAlvo: null, indice: 0 };
  }, []);

  const pararAutoRolagem = () => {
    if (autoRolagem.current !== null) cancelAnimationFrame(autoRolagem.current);
    autoRolagem.current = null;
  };

  const rolarPelasBordas = useCallback(() => {
    pararAutoRolagem();
    const passo = () => {
      const s = sessao.current;
      const area = trilho.current;
      if (!s || !s.comecou || !area) return;
      const caixa = area.getBoundingClientRect();
      const margem = 72;
      let dx = 0;
      if (s.x < caixa.left + margem) dx = -Math.ceil((caixa.left + margem - s.x) / 6);
      else if (s.x > caixa.right - margem) dx = Math.ceil((s.x - (caixa.right - margem)) / 6);
      if (dx) area.scrollLeft += dx;
      autoRolagem.current = requestAnimationFrame(passo);
    };
    autoRolagem.current = requestAnimationFrame(passo);
  }, []);

  const aoMoverPonteiro = useCallback((evento: PointerEvent) => {
    const s = sessao.current;
    if (!s || evento.pointerId !== s.pointerId) return;
    s.x = evento.clientX;
    s.y = evento.clientY;
    if (!s.comecou) {
      if (Math.hypot(evento.clientX - s.inicioX, evento.clientY - s.inicioY) < 6) return;
      s.comecou = true;
      ignorarClique.current = true;
      const inicial: Arrasto = { cardId: s.cardId, colunaAlvo: null, indice: 0 };
      arrastoRef.current = inicial;
      setArrasto(inicial);
      rolarPelasBordas();
    }
    if (fantasma.current) {
      gsap.set(fantasma.current, { x: evento.clientX - s.deslocX, y: evento.clientY - s.deslocY });
    }
    const alvo = alvoNoPonto(evento.clientX, evento.clientY, s.cardId);
    const atual = arrastoRef.current;
    if (!atual || atual.colunaAlvo !== alvo.colunaAlvo || atual.indice !== alvo.indice) {
      arrastoRef.current = alvo;
      setArrasto(alvo);
    }
  }, [alvoNoPonto, rolarPelasBordas]);

  const encerrarArrasto = useCallback(() => {
    sessao.current = null;
    arrastoRef.current = null;
    pararAutoRolagem();
    setArrasto(null);
    window.setTimeout(() => { ignorarClique.current = false; }, 0);
  }, []);

  const aoSoltar = useCallback((evento: PointerEvent) => {
    const s = sessao.current;
    if (!s || evento.pointerId !== s.pointerId) return;
    window.removeEventListener('pointermove', aoMoverPonteiro);
    window.removeEventListener('pointerup', aoSoltar);
    window.removeEventListener('pointercancel', aoSoltar);
    if (!s.comecou) { sessao.current = null; return; }
    const alvo = arrastoRef.current;
    const lista = cards ?? [];
    const cartao = lista.find(c => c.id === s.cardId);
    if (!alvo?.colunaAlvo || !cartao || evento.type === 'pointercancel') { encerrarArrasto(); return; }
    const destino = cardsDaColuna(lista, alvo.colunaAlvo).filter(c => c.id !== s.cardId);
    const beforeCardId = destino[alvo.indice]?.id ?? null;
    const origem = cardsDaColuna(lista, cartao.column);
    const proximoAtual = origem[origem.findIndex(c => c.id === cartao.id) + 1]?.id ?? null;
    encerrarArrasto();
    if (alvo.colunaAlvo === cartao.column && beforeCardId === proximoAtual) return;
    const nome = NOME_DA_COLUNA[alvo.colunaAlvo];
    void mover(cartao.id, alvo.colunaAlvo, beforeCardId, alvo.colunaAlvo === cartao.column ? `Ordem mudada em ${nome}` : `Movido para ${nome}`);
  }, [aoMoverPonteiro, cards, encerrarArrasto, mover]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', aoMoverPonteiro);
    window.removeEventListener('pointerup', aoSoltar);
    window.removeEventListener('pointercancel', aoSoltar);
    pararAutoRolagem();
  }, [aoMoverPonteiro, aoSoltar]);

  const aoApertarCartao = (evento: ReactPointerEvent<HTMLButtonElement>, cartao: BoardCard) => {
    if (evento.button !== 0 || filtro.trim()) return;
    const caixa = evento.currentTarget.getBoundingClientRect();
    sessao.current = {
      cardId: cartao.id,
      pointerId: evento.pointerId,
      inicioX: evento.clientX,
      inicioY: evento.clientY,
      deslocX: evento.clientX - caixa.left,
      deslocY: evento.clientY - caixa.top,
      largura: caixa.width,
      comecou: false,
      x: evento.clientX,
      y: evento.clientY,
    };
    window.addEventListener('pointermove', aoMoverPonteiro);
    window.addEventListener('pointerup', aoSoltar);
    window.addEventListener('pointercancel', aoSoltar);
  };

  // O fantasma nasce já no lugar do ponteiro, levantando do cartão.
  useLayoutEffect(() => {
    const s = sessao.current;
    if (!arrasto || !s || !fantasma.current) return;
    if (fantasma.current.dataset.pronto) return;
    fantasma.current.dataset.pronto = '1';
    gsap.set(fantasma.current, { x: s.x - s.deslocX, y: s.y - s.deslocY, width: s.largura });
    if (!reduzirMovimento()) {
      gsap.fromTo(fantasma.current.firstElementChild, { scale: 1, rotation: 0 }, { scale: 1.035, rotation: 1.6, duration: 0.22, ease: 'power3.out' });
    }
  }, [arrasto]);

  // ---- Teclado: Alt + setas move o cartão ----

  const aoTeclarCartao = (evento: ReactKeyboardEvent<HTMLButtonElement>, cartao: BoardCard) => {
    if (!evento.altKey || !cards) return;
    const indiceColuna = ORDEM_DAS_COLUNAS.indexOf(cartao.column);
    if (evento.key === 'ArrowRight' || evento.key === 'ArrowLeft') {
      const destino = ORDEM_DAS_COLUNAS[indiceColuna + (evento.key === 'ArrowRight' ? 1 : -1)];
      if (!destino) return;
      evento.preventDefault();
      focoPendente.current = cartao.id;
      void mover(cartao.id, destino, null, `Movido para ${NOME_DA_COLUNA[destino]}`);
    } else if (evento.key === 'ArrowUp' || evento.key === 'ArrowDown') {
      const vizinho = proximoVizinho(cardsDaColuna(cards, cartao.column), cartao.id, evento.key === 'ArrowUp' ? 'acima' : 'abaixo');
      if (!vizinho) return;
      evento.preventDefault();
      focoPendente.current = cartao.id;
      void mover(cartao.id, cartao.column, vizinho.beforeCardId, evento.key === 'ArrowUp' ? 'Movido para cima' : 'Movido para baixo');
    }
  };

  // ---- Criar ----

  const criar = async (coluna: BoardColumnId, titulo: string) => {
    const limpo = titulo.trim();
    if (limpo.length < BOARD_LIMITS.titleMin) return false;
    try {
      const novo = await apiQuadro.criar(projectId, { actor: nomeDoDono(), title: limpo, column: coluna });
      colunasAnteriores.current?.set(novo.id, novo.column);
      setCards(atual => [...(atual ?? []), novo]);
      setAgora(new Date());
      setAnuncio(`Cartão criado em ${NOME_DA_COLUNA[coluna]}`);
      return true;
    } catch (err) {
      mostrarAviso(errorText(err));
      return false;
    }
  };

  const termo = filtro.trim().toLocaleLowerCase('pt-BR');
  const visivel = useCallback((cartao: BoardCard) => {
    if (!termo) return true;
    const etiquetas = cartao.labels.map(l => NOME_DA_ETIQUETA[l] ?? l).join(' ');
    return `${cartao.title} ${cartao.description} ${etiquetas}`.toLocaleLowerCase('pt-BR').includes(termo);
  }, [termo]);

  const resumo = useMemo(() => (cards ? resumoDoQuadro(cards) : ''), [cards]);
  const cartaoArrastado = arrasto && cards ? cards.find(c => c.id === arrasto.cardId) : undefined;
  const cartaoAberto = aberto && cards ? cards.find(c => c.id === aberto) : undefined;

  return (
    <section className="quadro" aria-labelledby="quadro-titulo" data-arrastando={arrasto ? '' : undefined}>
      <div className="quadro-cabecalho">
        <div>
          <h2 id="quadro-titulo">Quadro</h2>
          {cards && <p className="quadro-resumo">{resumo}</p>}
        </div>
        <div className="quadro-acoes">
          <label className="quadro-busca">
            <Search size={15} strokeWidth={1.6} aria-hidden="true" />
            <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Filtrar cartões" aria-label="Filtrar cartões" />
          </label>
          <button type="button" className="icon-button outlined" aria-label="Atualizar quadro" title="Atualizar quadro" onClick={() => void carregar()}>
            <RefreshCw size={15} strokeWidth={1.6} />
          </button>
          <button type="button" className="button primary" onClick={() => setCompondoEm('pending')}>
            <Plus size={15} />Novo cartão
          </button>
        </div>
      </div>

      {erro && <div className="alert" role="alert">{erro} <button type="button" className="text-button" onClick={() => void carregar()}>Tentar de novo</button></div>}
      {aviso && <div className="quadro-aviso" role="status">{aviso}</div>}
      {termo && <p className="quadro-dica-filtro">Com o filtro ligado, arrastar fica pausado. Limpe o filtro para mover cartões.</p>}

      {cards === undefined && !erro ? (
        <p className="quadro-carregando" role="status">Carregando o quadro…</p>
      ) : cards && (
        <div className="quadro-trilho" ref={trilho}>
          {BOARD_COLUMNS.map(coluna => {
            const recolhida = colunaRecolhida(coluna.id, cards) && !arrasto && !expandidas.has(coluna.id) && compondoEm !== coluna.id;
            const daColuna = cardsDaColuna(cards, coluna.id);
            const estilo = { '--cor-coluna': COR_DA_COLUNA[coluna.id] } as CSSProperties;
            if (recolhida) {
              return (
                <button
                  key={coluna.id}
                  type="button"
                  className="quadro-coluna-faixa"
                  style={estilo}
                  onClick={() => setExpandidas(prev => new Set([...prev, coluna.id]))}
                  aria-label={`Abrir coluna ${coluna.name}, vazia`}
                  title={coluna.meaning}
                >
                  <span className="quadro-coluna-ponto" aria-hidden="true" />
                  <span className="quadro-coluna-faixa-nome">{coluna.name}</span>
                </button>
              );
            }
            const ehAlvo = arrasto?.colunaAlvo === coluna.id;
            const semArrastado = daColuna.filter(c => c.id !== arrasto?.cardId);
            return (
              <section key={coluna.id} className="quadro-coluna" data-coluna={coluna.id} data-alvo={ehAlvo ? '' : undefined} style={estilo} aria-labelledby={`quadro-coluna-${coluna.id}`}>
                <div className="quadro-coluna-nucleo">
                  <header className="quadro-coluna-topo">
                    <span className="quadro-coluna-ponto" aria-hidden="true" />
                    <h3 id={`quadro-coluna-${coluna.id}`}>{coluna.name}</h3>
                    <span className="quadro-coluna-contagem" aria-label={`${daColuna.length} ${daColuna.length === 1 ? 'cartão' : 'cartões'}`}>{daColuna.length}</span>
                    <button type="button" className="icon-button quadro-coluna-adicionar" aria-label={`Adicionar cartão em ${coluna.name}`} onClick={() => setCompondoEm(coluna.id)}>
                      <Plus size={15} strokeWidth={1.6} />
                    </button>
                    <p className="quadro-coluna-significado">{coluna.meaning}</p>
                  </header>

                  <div className="quadro-coluna-lista">
                    {daColuna.map(cartao => {
                      const indiceSemArrastado = semArrastado.findIndex(c => c.id === cartao.id);
                      const linhaAntes = ehAlvo && indiceSemArrastado !== -1 && arrasto!.indice === indiceSemArrastado;
                      return (
                        <Fragment key={cartao.id}>
                          {linhaAntes && <span className="quadro-insercao" aria-hidden="true" />}
                          <CartaoFace
                            cartao={cartao}
                            agora={agora}
                            oculto={!visivel(cartao)}
                            arrastando={arrasto?.cardId === cartao.id}
                            comemorando={comemorando.has(cartao.id)}
                            onPointerDown={e => aoApertarCartao(e, cartao)}
                            onClick={() => { if (!ignorarClique.current) setAberto(cartao.id); }}
                            onKeyDown={e => aoTeclarCartao(e, cartao)}
                          />
                        </Fragment>
                      );
                    })}
                    {ehAlvo && arrasto!.indice >= semArrastado.length && <span className="quadro-insercao" aria-hidden="true" />}
                    {daColuna.length === 0 && compondoEm !== coluna.id && (
                      <p className="quadro-coluna-vazia">{arrasto ? 'Solte aqui' : 'Nenhum cartão'}</p>
                    )}
                  </div>

                  {compondoEm === coluna.id ? (
                    <Compositor
                      coluna={coluna.name}
                      onCriar={titulo => criar(coluna.id, titulo)}
                      onFechar={() => setCompondoEm(null)}
                    />
                  ) : (
                    <button type="button" className="quadro-adicionar" onClick={() => setCompondoEm(coluna.id)}>
                      <Plus size={14} strokeWidth={1.6} />Adicionar cartão
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="quadro-anuncio" aria-live="polite">{anuncio}</p>

      {cartaoArrastado && createPortal(
        <div ref={fantasma} className="quadro-fantasma" aria-hidden="true" style={{ '--cor-coluna': COR_DA_COLUNA[arrasto?.colunaAlvo ?? cartaoArrastado.column] } as CSSProperties}>
          <div className="quadro-fantasma-corpo">
            <CartaoFace cartao={cartaoArrastado} agora={agora} fantasma />
          </div>
        </div>,
        document.body,
      )}

      {cartaoAberto && (
        <CartaoDetalhe
          projectId={projectId}
          cartao={cartaoAberto}
          corDaColuna={COR_DA_COLUNA[cartaoAberto.column]}
          onFechar={() => setAberto(null)}
          onAtualizado={salvo => {
            setCards(atual => atual?.map(c => (c.id === salvo.id ? salvo : c)));
            setAgora(new Date());
          }}
          onMover={(coluna) => mover(cartaoAberto.id, coluna, null, `Movido para ${NOME_DA_COLUNA[coluna]}`)}
          onExcluido={() => {
            setCards(atual => atual?.filter(c => c.id !== cartaoAberto.id));
            setAberto(null);
            setAnuncio('Cartão excluído');
          }}
          onConflito={() => tratarFalha(new ApiError('conflito', 409, 'version_conflict'))}
        />
      )}
    </section>
  );
}

function CartaoFace({ cartao, agora, oculto, arrastando, comemorando, fantasma, onPointerDown, onClick, onKeyDown }: {
  cartao: BoardCard;
  agora: Date;
  oculto?: boolean;
  arrastando?: boolean;
  comemorando?: boolean;
  fantasma?: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onClick?: () => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const feitos = cartao.checklist.filter(i => i.done).length;
  const total = cartao.checklist.length;
  const prioridade = cartao.priority === 'urgent' ? 'Urgente' : cartao.priority === 'high' ? 'Alta' : null;
  const descricaoAcessivel = [
    NOME_DA_COLUNA[cartao.column],
    prioridade && `prioridade ${prioridade.toLowerCase()}`,
    total && `${feitos} de ${total} itens feitos`,
    `mexido por último por ${cartao.updatedBy}`,
  ].filter(Boolean).join(', ');
  return (
    <button
      type="button"
      className="quadro-cartao"
      data-card-id={fantasma ? undefined : cartao.id}
      data-flip-id={fantasma ? undefined : cartao.id}
      data-arrastando={arrastando ? '' : undefined}
      data-comemoracao={comemorando ? 'completo' : undefined}
      data-prioridade={cartao.priority ?? undefined}
      hidden={oculto}
      tabIndex={fantasma ? -1 : 0}
      aria-label={`${cartao.title}. ${descricaoAcessivel}. Alt e setas movem o cartão.`}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {cartao.labels.length > 0 && (
        <span className="quadro-etiquetas">
          {cartao.labels.map(etiqueta => (
            <span key={etiqueta} className="quadro-etiqueta" data-etiqueta={etiqueta}>{NOME_DA_ETIQUETA[etiqueta] ?? etiqueta}</span>
          ))}
        </span>
      )}
      <span className="quadro-cartao-titulo">{cartao.title}</span>
      {(prioridade || cartao.description || total > 0) && (
        <span className="quadro-cartao-meta">
          {prioridade && <span className="quadro-prioridade" data-prioridade={cartao.priority}>{prioridade}</span>}
          {cartao.description && <span className="quadro-tem-anotacao" title="Tem anotações"><AlignLeft size={13} strokeWidth={1.6} aria-hidden="true" /></span>}
          {total > 0 && (
            <span className="quadro-checklist-resumo" data-completo={feitos === total ? '' : undefined}>
              <CheckSquare size={13} strokeWidth={1.6} aria-hidden="true" />{feitos}/{total}
            </span>
          )}
        </span>
      )}
      {total > 0 && (
        <span className="quadro-progresso" aria-hidden="true">
          <span style={{ transform: `scaleX(${feitos / total})` }} />
        </span>
      )}
      <span className="quadro-cartao-rodape">
        <span className="quadro-avatar" style={{ '--cor-nome': corDoNome(cartao.updatedBy) } as CSSProperties} aria-hidden="true">{inicial(cartao.updatedBy)}</span>
        <span className="quadro-cartao-autor">{cartao.updatedBy}, {tempoRelativo(cartao.updatedAt, agora)}</span>
      </span>
    </button>
  );
}

function Compositor({ coluna, onCriar, onFechar }: { coluna: string; onCriar: (titulo: string) => Promise<boolean>; onFechar: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { campo.current?.focus(); }, []);
  const enviar = async () => {
    if (salvando || titulo.trim().length < BOARD_LIMITS.titleMin) return;
    setSalvando(true);
    const ok = await onCriar(titulo);
    setSalvando(false);
    if (ok) { setTitulo(''); campo.current?.focus(); }
  };
  const restante = BOARD_LIMITS.titleMax - titulo.length;
  return (
    <form className="quadro-compositor" onSubmit={e => { e.preventDefault(); void enviar(); }}>
      <label className="quadro-compositor-rotulo" htmlFor={`compositor-${coluna}`}>Título do cartão em {coluna}</label>
      <textarea
        id={`compositor-${coluna}`}
        ref={campo}
        value={titulo}
        maxLength={BOARD_LIMITS.titleMax}
        rows={2}
        placeholder="Um título curto e fácil de entender"
        onChange={e => setTitulo(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void enviar(); }
          if (e.key === 'Escape') { e.preventDefault(); onFechar(); }
        }}
      />
      <div className="quadro-compositor-acoes">
        <button type="submit" className="button primary" disabled={salvando || titulo.trim().length < BOARD_LIMITS.titleMin}>
          {salvando ? 'Adicionando…' : 'Adicionar cartão'}
        </button>
        <button type="button" className="button ghost" onClick={onFechar}>Fechar</button>
        {restante <= 20 && <span className="quadro-contador" aria-live="polite">{restante} restantes</span>}
      </div>
    </form>
  );
}
