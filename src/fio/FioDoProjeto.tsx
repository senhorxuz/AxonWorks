import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import type { Carta, GrupoFalta } from '../../shared/carta';
import type { CoisaFeita } from './coisas';
import { vizinho, type TeclaDoFio } from './navegar';
import { reservaDosNomes, type NomeReservado, abertoDepoisDoFim, calorDaCasa, dicaDoSimbolo, idadeDaCasa, pautaDoTrilho, rotuloDoSimbolo, rotuloDoTrilho } from './pintura';
import { rotulosDaRegua, type RotuloDaRegua } from './regua';
import { daquiEmDiante, fraseDoFio, rotuloAcessivelDoFio, simbolosDaMiniatura } from './resumo';
import { tecer, type Casa, type Desenho } from './tecer';
import { trilhosDe, type Trilho } from './trilhos';
import { useMedidaDoFio, type MedidaDoFio } from './useMedidaDoFio';
import './fio.css';

/**
 * O fio do projeto: topo de "Onde paramos".
 *
 * Uma grade de caracteres em que cada casa é um fato registrado: um símbolo por coisa feita, um trilho por IA,
 * a descida entre trilhos na troca de IA, o pontilhado com a duração no tempo parado e o `◉` em onde paramos.
 * A regra do desenho mora em ./tecer.ts, ./trilhos.ts, ./regua.ts e ./resumo.ts; aqui só se pinta.
 */

type Estilo = CSSProperties & Record<`--${string}`, string | number>;
type Fase = 'abrindo' | 'vivo' | 'quieto';

/** O fio se escreve uma vez por projeto aberto; nas outras vezes, já aparece pronto. */
const jaAbertos = new Set<string>();
const MS_POR_COLUNA = 8;
const MS_DA_FAISCA_POR_COLUNA = 10;
const ESPERA_DA_FAISCA_MS = 250;
/** Os anéis de onde paramos pulsam quando você chega e descansam depois, como o Tear. */
const DESCANSO_MS = 20_000;
const TECLAS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
const LARGURA_DA_DICA = 340;

export interface PropsDoFio {
  projetoId: string;
  coisas: CoisaFeita[];
  falta: Carta['falta'];
  /** Clique ou Enter num símbolo. */
  aoEscolher: (chave: string) => void;
  /** Mouse ou foco num símbolo; `null` quando sai. */
  aoApontar: (chave: string | null) => void;
  /** A linha da lista que está com o mouse: o símbolo dela acende. */
  chaveAcesa: string | null;
  aoIrParaGrupo: (grupo: GrupoFalta) => void;
}

export function FioDoProjeto({ projetoId, coisas, falta, aoEscolher, aoApontar, chaveAcesa, aoIrParaGrupo }: PropsDoFio) {
  const quadro = useRef<HTMLElement>(null);
  const palco = useRef<HTMLDivElement>(null);
  const grade = useRef<HTMLDivElement>(null);
  const medida = useMedidaDoFio(grade, coisas);
  const desenho = useMemo(() => (medida ? tecer(coisas, medida.colunas) : null), [coisas, medida]);
  const fase = useAbertura(projetoId, desenho?.usadas ?? 0);
  const [trilhoAceso, setTrilhoAceso] = useState<number | null>(null);
  const frase = fraseDoFio(coisas);
  // A coluna de nomes reserva a largura pelos trilhos do projeto inteiro (não só do que foi desenhado): com o resumo
  // do começo, a largura não muda e a medida não oscila. Antes da primeira medida, ela também mostra os nomes invisíveis.
  const trilhosDoProjeto = useMemo(() => trilhosDe(coisas).trilhos, [coisas]);
  const reserva = useMemo(() => reservaDosNomes(coisas, trilhosDoProjeto), [coisas, trilhosDoProjeto]);
  const trilhos = desenho?.trilhos ?? trilhosDoProjeto;

  useBrasaDoFundo(quadro, palco, desenho, medida);

  if (coisas.length === 0) {
    return (
      <figure className="fio-quadro fio-vazio" aria-label={frase.coisas}>
        <figcaption className="fio-topo">
          <span className="fio-titulo">O fio do projeto</span>
          <span className="fio-resumo">{frase.coisas}</span>
        </figcaption>
      </figure>
    );
  }

  return (
    <figure ref={quadro} className={`fio-quadro fio-${fase}`} aria-label={`O fio do projeto: ${rotuloAcessivelDoFio(coisas)}`} data-trilho={trilhoAceso ?? undefined}>
      <figcaption className="fio-topo">
        <span className="fio-titulo">O fio do projeto</span>
        <span className="fio-resumo"><b>{frase.coisas}</b>{frase.resto}{frase.ias && <> {frase.ias}</>}</span>
        <Legenda />
      </figcaption>

      <div className="fio-corpo">
        <Nomes trilhos={trilhos} reserva={reserva} medida={desenho ? medida : null} vivo={desenho?.fim.trilho ?? -1} aceso={trilhoAceso} aoAcender={setTrilhoAceso} />
        <div className="fio-palco" ref={palco}>
          <div className="fio-grade" ref={grade} style={desenho && medida ? { fontSize: `${medida.tamanho}px`, height: `${desenho.linhas * medida.linha}px` } : undefined}>
            {desenho && medida && (
              <Grade desenho={desenho} medida={medida} abrindo={fase === 'abrindo'} trilhoAceso={trilhoAceso} chaveAcesa={chaveAcesa} aoEscolher={aoEscolher} aoApontar={aoApontar} />
            )}
          </div>
          {desenho && medida && <Regua rotulos={rotulosDaRegua(desenho)} desenho={desenho} casa={medida.casa} />}
        </div>
      </div>

      <Adiante falta={falta} resumido={(desenho?.coisasResumidas ?? 0) > 0} aoIrParaGrupo={aoIrParaGrupo} />
    </figure>
  );
}

/** Em que fase o fio está: escrevendo-se (uma vez por projeto), com os anéis vivos, ou quieto. */
function useAbertura(projetoId: string, usadas: number): Fase {
  const [fase, setFase] = useState<Fase>('quieto');
  const temDesenho = usadas > 0;
  const colunas = useRef(usadas);
  colunas.current = usadas;
  useLayoutEffect(() => {
    if (!temDesenho) return;
    const primeiraVez = !jaAbertos.has(projetoId);
    setFase(primeiraVez ? 'abrindo' : 'vivo');
    const duracao = colunas.current * (MS_POR_COLUNA + MS_DA_FAISCA_POR_COLUNA) + ESPERA_DA_FAISCA_MS + 700;
    // O projeto só conta como aberto quando a abertura termina: se a tela sair antes, ela recomeça.
    const fimDaAbertura = primeiraVez ? window.setTimeout(() => { jaAbertos.add(projetoId); setFase('vivo'); }, duracao) : undefined;
    const descanso = window.setTimeout(() => setFase('quieto'), DESCANSO_MS);
    return () => { window.clearTimeout(fimDaAbertura); window.clearTimeout(descanso); };
  }, [projetoId, temDesenho]);
  return fase;
}

/** A brasa do fundo do quadro fica atrás de onde paramos. */
function useBrasaDoFundo(quadro: RefObject<HTMLElement | null>, palco: RefObject<HTMLDivElement | null>, desenho: Desenho | null, medida: MedidaDoFio | null) {
  useLayoutEffect(() => {
    if (!quadro.current || !palco.current || !desenho || !medida) return;
    quadro.current.style.setProperty('--fio-brasa-x', `${palco.current.offsetLeft + (desenho.fim.col + 0.5) * medida.casa}px`);
    quadro.current.style.setProperty('--fio-brasa-y', `${palco.current.offsetTop + (desenho.fim.linha + 0.5) * medida.linha}px`);
  }, [quadro, palco, desenho, medida]);
}

function Legenda() {
  return (
    <span className="fio-legenda" aria-hidden="true">
      <span><i>●</i>entrega</span><span><i>◆</i>cartão concluído</span><span><i>○</i>registro</span><span><i>╮</i>troca de IA</span><span><i>┄</i>parado</span>
    </span>
  );
}

/** "Daqui em diante": o que ainda falta, por grupo; cada um leva à coluna "O que falta". Some quando não há pendência. */
function Adiante({ falta, resumido, aoIrParaGrupo }: { falta: Carta['falta']; resumido: boolean; aoIrParaGrupo: (grupo: GrupoFalta) => void }) {
  const pendencias = daquiEmDiante(falta);
  if (pendencias.length === 0 && !resumido) return null;
  return (
    <div className="fio-adiante">
      {pendencias.length > 0 && <span className="fio-adiante-rotulo">Daqui em diante</span>}
      {pendencias.map(p => (
        <button key={p.grupo} type="button" data-destino={p.grupo} className={p.pede ? 'fio-adiante-grupo fio-pede' : 'fio-adiante-grupo'} onClick={() => aoIrParaGrupo(p.grupo)}>
          <b>{p.quantidade}</b>{p.texto.slice(String(p.quantidade).length)}
        </button>
      ))}
      {resumido && <span className="fio-nota">Os dias mais antigos estão resumidos no começo do fio.</span>}
    </div>
  );
}

/** Os nomes dos trilhos, alinhados às linhas da grade. Sem medida, ficam invisíveis e só guardam a largura. */
function Nomes({ trilhos, reserva, medida, vivo, aceso, aoAcender }: { trilhos: Trilho[]; reserva: NomeReservado[]; medida: MedidaDoFio | null; vivo: number; aceso: number | null; aoAcender: (trilho: number | null) => void }) {
  return (
    <div className="fio-nomes-coluna">
      {/* Fantasmas: invisíveis, sem altura, só seguram a largura dos nomes de todos os trilhos do projeto. */}
      <div className="fio-nomes fio-nomes-fantasma" aria-hidden="true" style={{ '--fio-linha': '1.2em' } as Estilo}>
        {reserva.map(nome => <span key={nome.rotulo} className="fio-fantasma">{nome.rotulo}<span>{nome.total}</span></span>)}
      </div>
      <div className={medida ? 'fio-nomes' : 'fio-nomes fio-nomes-reserva'} style={{ '--fio-linha': medida ? `${medida.linha}px` : '1.2em' } as Estilo}>
      {trilhos.map((trilho, i) => (
        <button key={trilho.chave} type="button" data-dica={rotuloDoTrilho(trilho)} aria-label={rotuloDoTrilho(trilho)}
          className={['fio-nome', i === vivo ? 'fio-nome-vivo' : '', aceso === i ? 'fio-sel' : ''].filter(Boolean).join(' ')}
          onMouseEnter={() => aoAcender(i)} onMouseLeave={() => aoAcender(null)} onFocus={() => aoAcender(i)} onBlur={() => aoAcender(null)}>
          {trilho.rotulo}<span>{trilho.total}</span>
        </button>
      ))}
      </div>
    </div>
  );
}

interface PropsDaGrade {
  desenho: Desenho;
  medida: MedidaDoFio;
  abrindo: boolean;
  trilhoAceso: number | null;
  chaveAcesa: string | null;
  aoEscolher: (chave: string) => void;
  aoApontar: (chave: string | null) => void;
}

function Grade({ desenho, medida, abrindo, trilhoAceso, chaveAcesa, aoEscolher, aoApontar }: PropsDaGrade) {
  const { casa, linha } = medida;
  const botoes = useRef(new Map<number, HTMLButtonElement>());
  const indiceDoAgora = desenho.casas.findIndex(c => c.classe === 'agora');
  // Foco e dica guardam a CHAVE da coisa (origem:id), não a posição: quando o desenho muda, continuam na mesma coisa.
  const [chaveDoFoco, setChaveDoFoco] = useState<string | null>(null);
  const [chaveAtiva, setChaveAtiva] = useState<string | null>(null);
  const indiceDaChave = (chave: string | null) => (chave === null ? -1 : desenho.casas.findIndex(c => c.coisa?.chave === chave));
  // O fio é uma parada só de Tab: o símbolo que guarda o foco, ou onde paramos.
  const parada = indiceDaChave(chaveDoFoco) >= 0 ? indiceDaChave(chaveDoFoco) : indiceDoAgora;
  const caixa = (col: number, lin: number, casas = 1): Estilo => ({ left: `${col * casa}px`, top: `${lin * linha}px`, width: `${casas * casa}px`, height: `${linha}px`, lineHeight: `${linha}px` });
  const tinta = (c: Casa): Estilo => ({ ...caixa(c.col, c.linha), '--t': idadeDaCasa(c.col, desenho).toFixed(3), '--q': calorDaCasa(c.col, desenho).toFixed(3), '--ordem': c.col });
  const aceso = (trilho: number) => (trilhoAceso === trilho ? ' fio-sel' : '');
  const aberto = abertoDepoisDoFim(desenho);
  const indiceAtivo = indiceDaChave(chaveAtiva);
  const simboloAtivo = indiceAtivo < 0 ? undefined : desenho.casas[indiceAtivo];
  const diasComGuia = guiasDoDesenho(desenho);

  const apontar = (chave: string | null) => {
    setChaveAtiva(chave);
    aoApontar(chave);
  };
  const aoTeclar = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'Escape') { apontar(null); return; }
    const atual = Number((evento.target as HTMLElement).dataset.i);
    if (!TECLAS.includes(evento.key) || Number.isNaN(atual)) return;
    evento.preventDefault();
    const novo = vizinho(desenho.casas, atual, evento.key as TeclaDoFio);
    setChaveDoFoco(desenho.casas[novo]!.coisa!.chave);
    botoes.current.get(novo)?.focus();
  };

  return (
    <div className="fio-casas" role="group" aria-label="Coisas feitas, em ordem de tempo" onKeyDown={aoTeclar} onMouseLeave={() => apontar(null)}>
      {diasComGuia.map(col => <span key={`g${col}`} className="fio-guia" aria-hidden="true" style={{ left: `${(col + 0.5) * casa}px` }} />)}
      {desenho.trilhos.map((trilho, i) => (
        <span key={`p${trilho.chave}`} className={`fio-pauta${aceso(i)}`} aria-hidden="true" style={{ top: `${i * 2 * linha}px`, lineHeight: `${linha}px` }}>{pautaDoTrilho(desenho, i)}</span>
      ))}
      {desenho.casas.map((c, i) => c.coisa ? (
        <button key={c.coisa.chave} type="button" data-i={i} data-chave={c.coisa.chave} tabIndex={i === parada ? 0 : -1}
          ref={el => { if (el) botoes.current.set(i, el); else botoes.current.delete(i); }}
          className={`fio-c fio-simbolo fio-${c.classe}${aceso(c.trilho)}${c.coisa.chave === chaveAcesa ? ' fio-ligado' : ''}`}
          style={tinta(c)} aria-label={rotuloDoSimbolo(c.coisa, c.classe === 'agora')}
          onMouseEnter={() => apontar(c.coisa!.chave)} onFocus={() => { setChaveDoFoco(c.coisa!.chave); apontar(c.coisa!.chave); }} onBlur={() => apontar(null)} onClick={() => aoEscolher(c.coisa!.chave)}>
          {c.ch}
        </button>
      ) : (
        <span key={`${c.col}:${c.linha}`} className={`fio-c fio-${c.classe}${aceso(c.trilho)}`} aria-hidden="true" style={tinta(c)}>{c.ch}</span>
      ))}
      {aberto > 0 && (
        <span className={`fio-c fio-aberto${aceso(desenho.fim.trilho)}`} aria-hidden="true" style={{ ...caixa(desenho.fim.col + 1, desenho.fim.linha, aberto), '--ordem': desenho.usadas } as Estilo}>{'┄'.repeat(aberto)}</span>
      )}
      {abrindo && desenho.casas.map(c => (
        <span key={`f${c.col}:${c.linha}`} className="fio-faisca" aria-hidden="true"
          style={{ ...caixa(c.col, c.linha), '--passo': c.col, '--espera': `${desenho.usadas * MS_POR_COLUNA + ESPERA_DA_FAISCA_MS}ms` } as Estilo}>{c.ch}</span>
      ))}
      {simboloAtivo?.coisa && <Dica casa={simboloAtivo} medida={medida} largura={desenho.colunas * casa} />}
    </div>
  );
}

/** As colunas das guias: o primeiro símbolo de cada dia rotulado na régua, e o do último dia (rotulado "onde paramos"). */
function guiasDoDesenho(desenho: Desenho): number[] {
  const colunas = rotulosDaRegua(desenho).filter(r => r.tipo === 'dia').map(r => r.col);
  const ultimo = desenho.dias.at(-1)?.col;
  return ultimo === undefined || colunas.includes(ultimo) ? colunas : [...colunas, ultimo];
}

function Dica({ casa, medida, largura }: { casa: Casa; medida: MedidaDoFio; largura: number }) {
  const { quando, quem, texto } = dicaDoSimbolo(casa.coisa!, casa.classe === 'agora');
  const centro = (casa.col + 0.5) * medida.casa;
  const esquerda = Math.max(0, Math.min(centro - LARGURA_DA_DICA / 2, largura - LARGURA_DA_DICA));
  return (
    <div className="fio-dica" role="tooltip" style={{ left: `${esquerda}px`, bottom: `calc(100% - ${casa.linha * medida.linha - 10}px)`, width: `${LARGURA_DA_DICA}px` }}>
      <span className="fio-dica-quando">{quando}</span>
      <span className="fio-dica-quem">{quem}</span>
      <span className="fio-dica-texto">{texto}</span>
    </div>
  );
}

function Regua({ rotulos, desenho, casa }: { rotulos: RotuloDaRegua[]; desenho: Desenho; casa: number }) {
  return (
    <div className="fio-regua" aria-hidden="true">
      {rotulos.map(r => r.tipo === 'agora' ? (
        // Termina sob o ◉; se não couber, encosta na borda esquerda e cresce para a direita.
        <span key="agora" className="fio-regua-agora" style={{ width: `${(desenho.fim.col + 1) * casa}px` }}>{r.texto}</span>
      ) : (
        <span key={`${r.tipo}${r.col}`} className={r.tipo === 'mes' ? 'fio-regua-mes' : 'fio-regua-dia'} style={{ left: `${r.col * casa}px` }}>{r.texto}</span>
      ))}
    </div>
  );
}

/** Miniatura para a lista de projetos: um símbolo por versão (até 8), o último aceso. Sem movimento. */
export const FioMiniatura = memo(function FioMiniatura({ versoes }: { versoes: number }) {
  const simbolos = simbolosDaMiniatura(versoes);
  const temAgora = simbolos.endsWith('◉');
  return (
    <span className="fio-mini" aria-hidden="true">
      {temAgora ? simbolos.slice(0, -1) : simbolos}
      {temAgora && <b className="fio-mini-agora">◉</b>}
    </span>
  );
});
