import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Project } from '../../shared/types';
import { api } from '../api';
import { escalaDoElemento } from '../escala-da-tela';
import { linhaDoTrilho, linhasDoTear, quadroDoTear, quadroFixo, tecerBase, type BaseDoTear, type Celula, type Classe } from './tear';
import {
  atividadesDaCarta, escolherProjetos, fraseDoTear, historicoDe, janelaDoTempo, marcasDaRegua, resumoDoTear, rotuloDoProjeto,
  trilhosDoTear, type Historico,
} from './tear-dados';
import './tear.css';

/**
 * O Tear na tela de Projetos: um trilho por projeto sobre a mesma régua de tempo, em caracteres, vivo.
 *
 * A regra do desenho mora em ./tear.ts e a dos dados em ./tear-dados.ts. Os nomes e o "há quanto
 * tempo" são texto de verdade (HTML, legível e lido pelo leitor de tela), alinhados às linhas da arte.
 * A arte é pintada em duas telas de pintura empilhadas:
 * - a de baixo leva o que é fixo (trilhos, nós, régua), pintada uma vez e nunca mais tocada;
 * - a de cima é transparente e leva só o que vive (pulso, ondas, poeira). A cada quadro ela apaga as
 *   poucas casas que estavam acesas e acende as novas: dezenas de caracteres, nenhuma cópia grande.
 * O brilho é desenhado uma vez por glifo e guardado: recalcular desfoque a cada quadro custa caro.
 */

const TAMANHO_DA_FONTE = 11;
const ALTURA_DA_LINHA = 14;
const QUADROS_POR_SEGUNDO = 14;
/** Instante usado quando não há movimento: um quadro com as ondas abertas e o pulso no meio. */
const QUADRO_PARADO = 3.1;
/** O Tear respira quando você chega e descansa depois: animar para sempre gastaria processador à toa. */
const TEMPO_ACORDADO_MS = 20_000;
const MARGEM_DO_BRILHO = 16;
/**
 * Tela pintada pela própria CPU: o Tear é pequeno e muda poucas casas por quadro. Na tela acelerada
 * por GPU, cada quadro iria e voltaria do processo de vídeo, e essa espera custa mais que a pintura.
 */
const CONTEXTO: CanvasRenderingContext2DSettings = { willReadFrequently: true };

type Estilo = { cor: string; brilho?: string; raio?: number };
const ESTILOS: Record<Exclude<Classe, ' '>, Estilo> = {
  d: { cor: '#4b4945' },
  u: { cor: '#55524c' },
  ag: { cor: '#a2593a' },
  t: { cor: '#77736c' },
  t2: { cor: '#4a4844' },
  tv: { cor: '#c4683f' },
  p: { cor: '#5c5953' },
  n: { cor: '#f1ebe1', brilho: 'rgba(241, 235, 225, 0.45)', raio: 6 },
  n2: { cor: '#96918a' },
  nv: { cor: '#f08a5c', brilho: 'rgba(232, 121, 74, 0.75)', raio: 8 },
  na: { cor: '#ffd6bf', brilho: 'rgba(232, 121, 74, 0.95)', raio: 13 },
  b: { cor: '#e8794a', brilho: 'rgba(232, 121, 74, 0.5)', raio: 6 },
  bq: { cor: '#ffd6bf', brilho: '#e8794a', raio: 14 },
};

interface Medida {
  colunas: number;
  largura: number;
  altura: number;
  caractere: number;
  fonte: string;
  densidade: number;
}

type Casa = { col: number; row: number };

function medir(fixa: HTMLCanvasElement, viva: HTMLCanvasElement, linhas: number): Medida {
  const familia = getComputedStyle(fixa).fontFamily;
  const fonte = `400 ${TAMANHO_DA_FONTE}px ${familia}`;
  const contexto = fixa.getContext('2d', CONTEXTO)!;
  contexto.font = fonte;
  const caractere = contexto.measureText('─'.repeat(40)).width / 40;
  const largura = fixa.clientWidth;
  const altura = linhas * ALTURA_DA_LINHA;
  // Nitidez: as telas de pintura têm os pixels reais (densidade da tela × ampliação do 27").
  const densidade = window.devicePixelRatio * escalaDoElemento(fixa);
  for (const tela of [fixa, viva]) {
    tela.width = Math.round(largura * densidade);
    tela.height = Math.round(altura * densidade);
  }
  return { colunas: Math.max(40, Math.floor(largura / caractere)), largura, altura, caractere, fonte, densidade };
}

function preparar(contexto: CanvasRenderingContext2D, medida: Medida) {
  contexto.setTransform(medida.densidade, 0, 0, medida.densidade, 0, 0);
  contexto.font = medida.fonte;
  contexto.textBaseline = 'top';
}

/** A camada fixa, pintada uma vez (aqui o desfoque é calculado de verdade: acontece uma vez só). */
function pintarFixa(tela: HTMLCanvasElement, fixo: Celula[][], medida: Medida) {
  const contexto = tela.getContext('2d', CONTEXTO)!;
  preparar(contexto, medida);
  contexto.clearRect(0, 0, medida.largura, medida.altura);
  fixo.forEach((linha, row) => linha.forEach((celula, col) => {
    if (celula.c === ' ') return;
    const estilo = ESTILOS[celula.c];
    contexto.fillStyle = estilo.cor;
    contexto.shadowColor = estilo.brilho ?? 'transparent';
    contexto.shadowBlur = estilo.raio ?? 0;
    // Um caractere por casa da grade: alinhado mesmo se algum símbolo vier de outra fonte.
    contexto.fillText(celula.ch, col * medida.caractere, row * ALTURA_DA_LINHA);
  }));
}

function glifoComBrilho(glifos: Map<string, HTMLCanvasElement>, celula: Celula, estilo: Estilo, medida: Medida): HTMLCanvasElement {
  const chave = `${celula.c}|${celula.ch}`;
  const pronto = glifos.get(chave);
  if (pronto) return pronto;
  const imagem = document.createElement('canvas');
  imagem.width = Math.ceil((medida.caractere + MARGEM_DO_BRILHO * 2) * medida.densidade);
  imagem.height = Math.ceil((ALTURA_DA_LINHA + MARGEM_DO_BRILHO * 2) * medida.densidade);
  const contexto = imagem.getContext('2d', CONTEXTO)!;
  preparar(contexto, medida);
  contexto.fillStyle = estilo.cor;
  contexto.shadowColor = estilo.brilho!;
  contexto.shadowBlur = estilo.raio!;
  contexto.fillText(celula.ch, MARGEM_DO_BRILHO, MARGEM_DO_BRILHO);
  glifos.set(chave, imagem);
  return imagem;
}

/** Um quadro na tela de cima: apaga o que estava aceso, acende o que vive agora. Devolve o que acendeu. */
function pintarViva(tela: HTMLCanvasElement, base: BaseDoTear, fixo: Celula[][], medida: Medida, glifos: Map<string, HTMLCanvasElement>, acesas: Casa[], tempo: number): Casa[] {
  const contexto = tela.getContext('2d', CONTEXTO)!;
  preparar(contexto, medida);
  contexto.shadowBlur = 0;
  const larguraDoGlifo = medida.caractere + MARGEM_DO_BRILHO * 2;
  const alturaDoGlifo = ALTURA_DA_LINHA + MARGEM_DO_BRILHO * 2;
  for (const { col, row } of acesas) {
    contexto.clearRect(col * medida.caractere - MARGEM_DO_BRILHO, row * ALTURA_DA_LINHA - MARGEM_DO_BRILHO, larguraDoGlifo, alturaDoGlifo);
  }
  const novas: Casa[] = [];
  quadroDoTear(base, tempo).forEach((linha, row) => linha.forEach((celula, col) => {
    const fixa = fixo[row]![col]!;
    if (celula.c === ' ' || (celula.ch === fixa.ch && celula.c === fixa.c)) return;
    const estilo = ESTILOS[celula.c];
    const x = col * medida.caractere;
    const y = row * ALTURA_DA_LINHA;
    if (estilo.brilho) contexto.drawImage(glifoComBrilho(glifos, celula, estilo, medida), x - MARGEM_DO_BRILHO, y - MARGEM_DO_BRILHO, larguraDoGlifo, alturaDoGlifo);
    else { contexto.fillStyle = estilo.cor; contexto.fillText(celula.ch, x, y); }
    novas.push({ col, row });
  }));
  return novas;
}

/** Atividades já lidas, por projeto e versão: voltar à tela não pede tudo de novo. */
const LIDAS = new Map<string, number[]>();
const chaveDaVersao = (p: Project) => `${p.id}:${p.revision}:${p.updatedAt}`;

/** Lê a carta de cada projeto visível (no máximo seis). Falhou, o projeto fica sem nós e o texto diz. */
function useHistoricos(visiveis: Project[]): Record<string, Historico> {
  const [historicos, setHistoricos] = useState<Record<string, Historico>>({});
  const chave = visiveis.map(chaveDaVersao).join('|');
  useEffect(() => {
    const controle = new AbortController();
    const guardar = (id: string, historico: Historico) => setHistoricos(atual => ({ ...atual, [id]: historico }));
    for (const projeto of visiveis) {
      const versao = chaveDaVersao(projeto);
      const lidas = LIDAS.get(versao);
      if (lidas) { guardar(projeto.id, { estado: 'pronto', quando: lidas }); continue; }
      api.carta(projeto.id, controle.signal)
        .then(carta => {
          const quando = atividadesDaCarta(carta);
          LIDAS.set(versao, quando);
          guardar(projeto.id, { estado: 'pronto', quando });
        })
        .catch(() => { if (!controle.signal.aborted) guardar(projeto.id, { estado: 'erro' }); });
    }
    return () => controle.abort();
    // `chave` resume os projetos visíveis e as versões deles: a lista nova com os mesmos dados não relê.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return historicos;
}

const minutoDe = (ms: number) => Math.floor(ms / 60_000) * 60_000;

export function TearDosProjetos({ projetos }: { projetos: Project[] }) {
  const telaFixa = useRef<HTMLCanvasElement>(null);
  const telaViva = useRef<HTMLCanvasElement>(null);
  const [medida, setMedida] = useState<Medida | null>(null);
  // O "agora" anda de minuto em minuto, quando você volta à aba ou passa o mouse: sem relógio próprio.
  const [agora, setAgora] = useState(() => minutoDe(Date.now()));
  const { visiveis, resto } = useMemo(() => escolherProjetos(projetos), [projetos]);
  const historicos = useHistoricos(visiveis);
  const linhas = linhasDoTear(visiveis.length);
  const trilhos = useMemo(() => trilhosDoTear(visiveis, historicos, agora), [visiveis, historicos, agora]);
  const janela = useMemo(() => janelaDoTempo(Math.min(...visiveis.map(p => Date.parse(p.createdAt))), agora), [visiveis, agora]);
  const base = useMemo(
    () => (medida ? tecerBase({ cols: medida.colunas, ...janela, trilhos, marcas: marcasDaRegua(janela, medida.colunas) }) : null),
    [medida, janela, trilhos],
  );
  const fixo = useMemo(() => (base ? quadroFixo(base) : null), [base]);
  const atual = useRef({ base, medida, fixo, glifos: new Map<string, HTMLCanvasElement>(), acesas: [] as Casa[], tempo: QUADRO_PARADO });
  atual.current.base = base;
  atual.current.medida = medida;
  atual.current.fixo = fixo;

  useEffect(() => {
    const fixa = telaFixa.current!;
    const viva = telaViva.current!;
    const remedir = () => setMedida(medir(fixa, viva, linhas));
    remedir();
    const observador = new ResizeObserver(remedir);
    observador.observe(fixa);
    return () => observador.disconnect();
  }, [linhas]);

  // Tamanho ou dados mudaram: pinta a camada fixa de novo e acende o instante em que o Tear está.
  useEffect(() => {
    if (!base || !medida || !fixo) return;
    const estado = atual.current;
    estado.glifos = new Map();
    pintarFixa(telaFixa.current!, fixo, medida);
    telaViva.current!.getContext('2d', CONTEXTO)!.clearRect(0, 0, telaViva.current!.width, telaViva.current!.height);
    estado.acesas = pintarViva(telaViva.current!, base, fixo, medida, estado.glifos, [], estado.tempo);
  }, [base, medida, fixo]);

  useEffect(() => {
    const figura = telaViva.current!.closest('figure')!;
    const atualizar = () => { if (document.visibilityState !== 'hidden') setAgora(minutoDe(Date.now())); };
    figura.addEventListener('pointermove', atualizar, { passive: true });
    document.addEventListener('visibilitychange', atualizar);
    return () => {
      figura.removeEventListener('pointermove', atualizar);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, []);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const viva = telaViva.current!;
    const figura = viva.closest('figure')!;
    let visivel = true;
    let espera = 0;
    let acordadoAte = 0;
    const inicio = performance.now() - QUADRO_PARADO * 1000;
    const escondida = () => document.visibilityState === 'hidden';
    // Um despertador no ritmo da pintura (14 por segundo), não um pedido a cada quadro da tela (60):
    // acordar o processador para quadro que não ia pintar era desperdício.
    const passo = () => {
      espera = 0;
      const agora = performance.now();
      // Passou o tempo acordado, a aba saiu de vista ou o Tear rolou para fora: para no quadro em que está.
      if (agora > acordadoAte || escondida() || !visivel) return;
      espera = window.setTimeout(passo, 1000 / QUADROS_POR_SEGUNDO);
      const estado = atual.current;
      estado.tempo = (agora - inicio) / 1000;
      if (estado.base && estado.medida && estado.fixo) {
        estado.acesas = pintarViva(viva, estado.base, estado.fixo, estado.medida, estado.glifos, estado.acesas, estado.tempo);
      }
    };
    const acordar = () => {
      acordadoAte = performance.now() + TEMPO_ACORDADO_MS;
      if (!espera) espera = window.setTimeout(passo, 0);
    };
    const aoVoltarParaAba = () => { if (!escondida()) acordar(); };
    const observador = new IntersectionObserver(([entrada]) => { visivel = entrada!.isIntersecting; if (visivel) acordar(); });
    observador.observe(viva);
    figura.addEventListener('pointermove', acordar, { passive: true });
    document.addEventListener('visibilitychange', aoVoltarParaAba);
    acordar();
    return () => {
      window.clearTimeout(espera);
      observador.disconnect();
      figura.removeEventListener('pointermove', acordar);
      document.removeEventListener('visibilitychange', aoVoltarParaAba);
    };
  }, []);

  const altura = linhas * ALTURA_DA_LINHA;
  const palco = { '--tear-linha': `${ALTURA_DA_LINHA}px`, height: `${altura}px` } as CSSProperties;

  return (
    <figure className="tear" aria-label={fraseDoTear(visiveis, projetos.length, historicos, agora)}>
      <figcaption className="tear-legenda">
        <span className="tear-titulo">Sua memória</span>
        <span className="tear-resumo">{resumoDoTear(projetos.length)}</span>
      </figcaption>
      <div className="tear-palco" style={palco}>
        <ol className="tear-projetos">
          {visiveis.map((projeto, i) => (
            <li
              key={projeto.id}
              className={`tear-projeto${trilhos[i]!.vivo ? ' tear-projeto-vivo' : ''}${trilhos[i]!.parado ? ' tear-projeto-parado' : ''}`}
              style={{ top: `${linhaDoTrilho(i) * ALTURA_DA_LINHA}px` }}
            >
              <span className="tear-nome" title={projeto.name}>{projeto.name}</span>
              <span className="tear-quando">{rotuloDoProjeto(projeto, historicoDe(historicos, projeto.id), agora)}</span>
            </li>
          ))}
        </ol>
        {resto > 0 && (
          <span className="tear-mais" style={{ top: `${(linhas - 2) * ALTURA_DA_LINHA}px` }}>
            + {resto} {resto === 1 ? 'projeto' : 'projetos'} na lista abaixo
          </span>
        )}
        <div className="tear-trilhos" aria-hidden="true">
          <canvas ref={telaFixa} className="tear-tela tear-fixa" />
          <canvas ref={telaViva} className="tear-tela tear-viva" />
        </div>
      </div>
    </figure>
  );
}
