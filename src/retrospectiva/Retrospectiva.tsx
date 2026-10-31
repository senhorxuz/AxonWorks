import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Decision } from '../../shared/continuity';
import type { EvidenceView } from '../../shared/evidence';
import type { ProjectDetail } from '../../shared/types';
import { api } from '../api';
import { nivelDeConfianca, type Confianca } from '../confianca';
import { gsap, useGSAP } from '../motion';
import { DateLabel } from '../ui';
import { calcularRetrospectiva, decisoesDoRumo, type PontoDaTrilha, type Retrospectiva as Dados, type Trilha } from './calculos';
import './retrospectiva.css';

/**
 * Retrospectiva: a história do projeto contada pelas próprias entregas.
 * Regra da casa: só dado real. O que não carregou não aparece; nada conta do zero.
 * Para apagar: remova a pasta src/retrospectiva, src/confianca.ts (se o Resumo não usar),
 * a aba em src/Workspace.tsx e os testes tests/retrospectiva.*.
 */

type Carga<T> = { estado: 'carregando' } | { estado: 'pronto'; valor: T } | { estado: 'erro' };

const ENTREGAS_INICIAIS = 8;
/** Fração da largura reservada à cauda "até agora", quando faz tempo que não há checkpoint. */
const CAUDA = 0.1;
const UMA_HORA = 60 * 60 * 1000;

function plural(n: number, singular: string, pluralForma: string) {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

const formatoDia = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
const formatoMomento = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function tempoParado(ms: number) {
  const horas = Math.floor(ms / UMA_HORA);
  if (horas < 24) return plural(horas, 'hora', 'horas');
  return plural(Math.floor(horas / 24), 'dia', 'dias');
}

function resumoCurto(texto: string, limite = 140) {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
}

function diaLocal(chave: string) {
  const [ano, mes, dia] = chave.split('-').map(Number);
  return new Date(ano!, mes! - 1, dia!, 12);
}

function useCarga<T>(buscar: (signal: AbortSignal) => Promise<T>, chaves: unknown[]) {
  const [carga, setCarga] = useState<Carga<T>>({ estado: 'carregando' });
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    buscar(controller.signal)
      .then(valor => { if (!controller.signal.aborted) setCarga({ estado: 'pronto', valor }); })
      .catch(() => { if (!controller.signal.aborted) setCarga({ estado: 'erro' }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...chaves, tentativa]);
  const tentarDeNovo = useCallback(() => { setCarga({ estado: 'carregando' }); setTentativa(n => n + 1); }, []);
  return [carga, tentarDeNovo] as const;
}

export function Retrospectiva({ detail }: { detail: ProjectDetail }) {
  const projectId = detail.project.id;
  const raiz = useRef<HTMLElement>(null);
  const dados = useMemo(() => calcularRetrospectiva(detail, new Date()), [detail]);
  const [decisoes, recarregarDecisoes] = useCarga<Decision[]>(signal => api.decisions(projectId, true, signal), [projectId, detail]);
  const [evidencias] = useCarga<EvidenceView[]>(signal => api.evidence(projectId, {}, signal), [projectId, detail]);
  // Entrega em destaque: acende ao mesmo tempo na lista e na trilha.
  const [destaque, setDestaque] = useState<string | null>(null);

  const confiancaPorCheckpoint = useMemo(() => {
    const mapa = new Map<string, Confianca>();
    if (evidencias.estado !== 'pronto') return mapa;
    for (const entrega of dados.entregas) {
      mapa.set(entrega.checkpointId, nivelDeConfianca(evidencias.valor.filter(e => e.checkpointId === entrega.checkpointId)));
    }
    return mapa;
  }, [dados, evidencias]);

  const vazio = dados.checkpoints === 0 && dados.tarefasConcluidas === 0;

  // Um único momento orquestrado ao abrir a aba. Com movimento reduzido, nada se move.
  useGSAP(() => {
    if (vazio) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const linha = gsap.timeline({ defaults: { ease: 'expo.out' } });
      linha
        .from('.retro-numero', { autoAlpha: 0, scale: 0.94, filter: 'brightness(2) blur(10px)', transformOrigin: '0% 85%', duration: 1, clearProps: 'all' })
        .from('.retro-numero-rotulo', { autoAlpha: 0, y: 8, duration: 0.5, clearProps: 'all' }, 0.2)
        .from('.retro-fato', { autoAlpha: 0, y: 10, duration: 0.55, stagger: 0.07, clearProps: 'all' }, 0.28)
        .from('.retro-trilha-linha', { scaleX: 0, transformOrigin: '0% 50%', duration: 1.2, ease: 'power3.inOut', clearProps: 'transform' }, 0.35)
        .from('.retro-marca', {
          autoAlpha: 0,
          scale: 0.6,
          duration: 0.45,
          ease: 'back.out(2)',
          stagger: (_indice: number, alvo: Element) => Number((alvo as HTMLElement).dataset.posicao ?? 0) * 1.05,
          clearProps: 'opacity,visibility,transform',
        }, 0.4)
        .from('.retro-trilha-cauda, .retro-trilha-legenda', { autoAlpha: 0, duration: 0.5, clearProps: 'all' }, 1.35);
    });
    return () => media.revert();
  }, { scope: raiz, dependencies: [projectId, vazio], revertOnUpdate: true });

  return (
    <section ref={raiz} className="retro" aria-labelledby="retro-titulo">
      <header className="retro-abertura">
        <h2 id="retro-titulo" className="retro-titulo">{detail.project.name} até agora</h2>
        {vazio ? (
          <div className="retro-vazio">
            <p className="retro-vazio-frase">A retrospectiva começa no primeiro checkpoint.</p>
            <p className="retro-vazio-apoio">Quando uma IA salvar o trabalho deste projeto, a história aparece aqui, com as entregas, o ritmo e as decisões.</p>
          </div>
        ) : (
          <>
            <Abertura dados={dados} decisoes={decisoes} confiancas={confiancaPorCheckpoint} />
            {dados.trilha && (
              <TrilhaDeLuz trilha={dados.trilha} confiancas={confiancaPorCheckpoint} destaque={destaque} onDestaque={setDestaque} />
            )}
          </>
        )}
      </header>

      {!vazio && dados.semanaMaisProdutiva && (
        <section className="retro-semana" aria-labelledby="retro-semana-titulo">
          <h3 id="retro-semana-titulo" className="retro-secao-titulo">Semana mais produtiva</h3>
          <p className="retro-semana-frase">
            De {formatoDia.format(diaLocal(dados.semanaMaisProdutiva.inicio))} a {formatoDia.format(diaLocal(dados.semanaMaisProdutiva.fim))}, {plural(dados.semanaMaisProdutiva.entregas, 'entrega', 'entregas')}.
          </p>
        </section>
      )}

      {dados.entregas.length > 0 && (
        <Entregas dados={dados} carregouEvidencias={evidencias.estado === 'pronto'} confiancas={confiancaPorCheckpoint} destaque={destaque} onDestaque={setDestaque} />
      )}
      {!vazio && (
        <div className="retro-lateral">
          {dados.porAgente.length > 0 && <QuemEntregou dados={dados} />}
          <Decisoes carga={decisoes} tentarDeNovo={recarregarDecisoes} />
        </div>
      )}
    </section>
  );
}

function Abertura({ dados, decisoes, confiancas }: { dados: Dados; decisoes: Carga<Decision[]>; confiancas: Map<string, Confianca> }) {
  const heroiTarefas = dados.tarefasConcluidas > 0;
  const valor = heroiTarefas ? dados.tarefasConcluidas : dados.checkpoints;
  const rotulo = heroiTarefas
    ? (valor === 1 ? 'tarefa concluída' : 'tarefas concluídas')
    : (valor === 1 ? 'checkpoint salvo' : 'checkpoints salvos');

  const fatos: Array<{ id: string; valor: number; rotulo: string; tom?: 'sistema' }> = [];
  if (heroiTarefas && dados.checkpoints > 0) fatos.push({ id: 'checkpoints', valor: dados.checkpoints, rotulo: dados.checkpoints === 1 ? 'checkpoint salvo' : 'checkpoints salvos' });
  if (dados.diasDeTrabalho > 0) fatos.push({ id: 'dias', valor: dados.diasDeTrabalho, rotulo: dados.diasDeTrabalho === 1 ? 'dia de trabalho' : 'dias de trabalho' });
  if (dados.porAgente.length > 0) fatos.push({ id: 'ias', valor: dados.porAgente.length, rotulo: dados.porAgente.length === 1 ? 'IA assinou o trabalho' : 'IAs assinaram o trabalho' });
  if (decisoes.estado === 'pronto') {
    const valendo = decisoes.valor.filter(d => d.status === 'accepted').length;
    if (valendo > 0) fatos.push({ id: 'decisoes', valor: valendo, rotulo: valendo === 1 ? 'decisão vale hoje' : 'decisões valem hoje' });
  }
  const conferidas = [...confiancas.values()].filter(c => c.tom === 'sistema').length;
  if (conferidas > 0) fatos.push({ id: 'conferidas', valor: conferidas, rotulo: conferidas === 1 ? 'entrega com arquivos conferidos pelo sistema' : 'entregas com arquivos conferidos pelo sistema', tom: 'sistema' });

  return (
    <div className="retro-abertura-corpo">
      <p className="retro-numero-principal">
        <span className="retro-numero">{valor}</span>
        <span className="retro-numero-rotulo">{rotulo}</span>
      </p>
      {fatos.length > 0 && (
        <dl className="retro-fatos">
          {fatos.map(fato => (
            <div key={fato.id} className="retro-fato" data-fato={fato.id} data-tom={fato.tom}>
              <dt>{fato.rotulo}</dt>
              <dd>{fato.valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function textoDoPonto(ponto: PontoDaTrilha) {
  const titulo = ponto.tarefaConcluida ? `Concluiu ${ponto.tarefaConcluida.titulo}` : 'Checkpoint';
  return { titulo, quem: `${ponto.agente}, ${formatoMomento.format(new Date(ponto.criadoEm))}`, texto: resumoCurto(ponto.fraseSimples ?? ponto.resumo) };
}

function TrilhaDeLuz({ trilha, confiancas, destaque, onDestaque }: {
  trilha: Trilha;
  confiancas: Map<string, Confianca>;
  destaque: string | null;
  onDestaque: (checkpointId: string | null) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [ativo, setAtivo] = useState<number | null>(null);
  const [largura, setLargura] = useState(0);
  const comCauda = trilha.semCheckpointHaMs >= UMA_HORA;
  const extensao = comCauda ? 1 - CAUDA : 1;
  const pontos = trilha.pontos;

  useEffect(() => {
    const elemento = area.current;
    if (!elemento) return;
    const observador = new ResizeObserver(([entrada]) => setLargura(entrada!.contentRect.width));
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  const ativar = (indice: number | null) => {
    setAtivo(indice);
    const ponto = indice === null ? null : pontos[indice]!;
    onDestaque(ponto?.tarefaConcluida ? ponto.checkpointId : null);
  };

  const maisProximo = (clientX: number) => {
    const caixa = area.current!.getBoundingClientRect();
    const fracao = (clientX - caixa.left) / (caixa.width * extensao);
    let melhor = 0;
    for (let i = 1; i < pontos.length; i++) {
      if (Math.abs(pontos[i]!.posicao - fracao) <= Math.abs(pontos[melhor]!.posicao - fracao)) melhor = i;
    }
    return melhor;
  };

  const aoMover = (evento: PointerEvent<HTMLDivElement>) => ativar(maisProximo(evento.clientX));
  const aoTeclar = (evento: KeyboardEvent<HTMLDivElement>) => {
    const atual = ativo ?? pontos.length - 1;
    const destinos: Record<string, number> = { ArrowRight: Math.min(atual + 1, pontos.length - 1), ArrowLeft: Math.max(atual - 1, 0), Home: 0, End: pontos.length - 1 };
    const destino = destinos[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    ativar(destino);
  };

  const pontoAtivo = ativo === null ? null : pontos[ativo] ?? null;
  const conteudoAtivo = pontoAtivo ? textoDoPonto(pontoAtivo) : null;
  const xAtivo = pontoAtivo ? pontoAtivo.posicao * extensao * largura : 0;
  const larguraDica = 300;
  const esquerdaDica = Math.min(Math.max(xAtivo - larguraDica / 2, 0), Math.max(largura - larguraDica, 0));

  return (
    <figure className="retro-trilha">
      <div
        ref={area}
        className="retro-trilha-area"
        role="group"
        tabIndex={0}
        aria-label={`Linha do tempo com ${plural(pontos.length, 'checkpoint', 'checkpoints')}. Use as setas para percorrer.`}
        style={{ '--extensao': extensao } as CSSProperties}
        onPointerMove={aoMover}
        onPointerDown={aoMover}
        onPointerLeave={() => ativar(null)}
        onFocus={() => { if (ativo === null) ativar(pontos.length - 1); }}
        onBlur={() => ativar(null)}
        onKeyDown={aoTeclar}
      >
        <span className="retro-trilha-linha" aria-hidden="true" />
        {comCauda && <span className="retro-trilha-cauda" aria-hidden="true" />}
        {pontos.map((ponto, indice) => (
          <span
            key={ponto.checkpointId}
            className="retro-marca"
            aria-hidden="true"
            data-posicao={ponto.posicao}
            data-entrega={ponto.tarefaConcluida ? '' : undefined}
            data-tarefa={ponto.tarefaConcluida?.titulo}
            data-tom={ponto.tarefaConcluida ? confiancas.get(ponto.checkpointId)?.tom : undefined}
            data-ativo={indice === ativo ? '' : undefined}
            data-destaque={destaque === ponto.checkpointId ? '' : undefined}
            style={{ '--x': ponto.posicao } as CSSProperties}
          />
        ))}
        {pontoAtivo && <span className="retro-trilha-cursor" aria-hidden="true" style={{ transform: `translateX(${xAtivo}px)` }} />}
        {conteudoAtivo && (
          <div className="retro-trilha-dica" aria-hidden="true" style={{ transform: `translateX(${esquerdaDica}px)` }}>
            <strong>{conteudoAtivo.titulo}</strong>
            <span>{conteudoAtivo.quem}</span>
            <p>{conteudoAtivo.texto}</p>
          </div>
        )}
      </div>
      <figcaption className="retro-trilha-legenda">
        <span>{formatoDia.format(new Date(trilha.inicio))}</span>
        <span className="retro-trilha-dica-de-uso">Passe o mouse ou use as setas para percorrer cada checkpoint</span>
        <span>{comCauda ? `Sem checkpoint há ${tempoParado(trilha.semCheckpointHaMs)}` : formatoDia.format(new Date(trilha.fim))}</span>
      </figcaption>
      <p className="retro-trilha-anuncio" aria-live="polite">
        {conteudoAtivo ? `${conteudoAtivo.titulo}. ${conteudoAtivo.quem}. ${conteudoAtivo.texto}` : ''}
      </p>
    </figure>
  );
}

function Entregas({ dados, carregouEvidencias, confiancas, destaque, onDestaque }: {
  dados: Dados;
  carregouEvidencias: boolean;
  confiancas: Map<string, Confianca>;
  destaque: string | null;
  onDestaque: (checkpointId: string | null) => void;
}) {
  const [todas, setTodas] = useState(false);
  const visiveis = todas ? dados.entregas : dados.entregas.slice(0, ENTREGAS_INICIAIS);
  const restantes = dados.entregas.length - visiveis.length;
  return (
    <section className="retro-secao retro-entregas" aria-labelledby="retro-entregas-titulo">
      <div className="retro-secao-cabecalho">
        <h3 id="retro-entregas-titulo" className="retro-secao-titulo">Entregas</h3>
        <p className="retro-secao-apoio">O que ficou pronto, da mais recente para a mais antiga.</p>
      </div>
      <ol className="retro-entregas-lista">
        {visiveis.map(entrega => {
          const confianca = carregouEvidencias ? confiancas.get(entrega.checkpointId) : undefined;
          return (
            <li
              key={entrega.tarefaId}
              className="retro-entrega"
              data-tom={confianca?.tom}
              data-destaque={destaque === entrega.checkpointId ? '' : undefined}
              onPointerEnter={() => onDestaque(entrega.checkpointId)}
              onPointerLeave={() => onDestaque(null)}
            >
              <DateLabel value={entrega.concluidaEm} />
              <div className="retro-entrega-corpo">
                <h4 className="retro-entrega-titulo">{entrega.titulo}</h4>
                {entrega.fraseSimples
                  ? <p className="retro-entrega-frase">{entrega.fraseSimples}</p>
                  : <p className="retro-entrega-tecnico"><span>Resumo técnico</span>{entrega.resumoTecnico}</p>}
                <p className="retro-entrega-rodape">
                  <span>Entregue por {entrega.agente}</span>
                  {confianca && <span className="retro-selo">{confianca.rotulo}</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {restantes > 0 && (
        <button type="button" className="button secondary retro-mais" onClick={() => setTodas(true)}>
          Mostrar todas as {dados.entregas.length} entregas
        </button>
      )}
    </section>
  );
}

function QuemEntregou({ dados }: { dados: Dados }) {
  const maximo = Math.max(...dados.porAgente.map(a => a.checkpoints), 1);
  return (
    <section className="retro-secao retro-pessoas" aria-labelledby="retro-pessoas-titulo">
      <div className="retro-secao-cabecalho">
        <h3 id="retro-pessoas-titulo" className="retro-secao-titulo">Quem entregou o quê</h3>
        <p className="retro-secao-apoio">Contagem pelo nome que cada IA declarou: a parte forte da barra são as entregas, a clara são os checkpoints. Não mede qualidade.</p>
      </div>
      <ul className="retro-pessoas-lista">
        {dados.porAgente.map(agente => (
          <li key={agente.agente} className="retro-pessoa">
            <span className="retro-pessoa-nome">{agente.agente}</span>
            <span className="retro-pessoa-trilho" aria-hidden="true">
              <span className="retro-pessoa-checkpoints" style={{ width: `${(agente.checkpoints / maximo) * 100}%` }} />
              <span className="retro-pessoa-entregas" style={{ width: `${(agente.entregas / maximo) * 100}%` }} />
            </span>
            <span className="retro-pessoa-contagem">
              {plural(agente.entregas, 'entrega', 'entregas')} e {plural(agente.checkpoints, 'checkpoint', 'checkpoints')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Decisoes({ carga, tentarDeNovo }: { carga: Carga<Decision[]>; tentarDeNovo: () => void }) {
  const lista = carga.estado === 'pronto' ? decisoesDoRumo(carga.valor) : [];
  return (
    <section className="retro-secao retro-decisoes" aria-labelledby="retro-decisoes-titulo">
      <div className="retro-secao-cabecalho">
        <h3 id="retro-decisoes-titulo" className="retro-secao-titulo">Decisões do rumo</h3>
        <p className="retro-secao-apoio">As decisões aceitas, em ordem, e o que aconteceu com cada uma.</p>
      </div>
      {carga.estado === 'carregando' && <p className="retro-secao-apoio" role="status">Carregando decisões…</p>}
      {carga.estado === 'erro' && (
        <p className="retro-secao-apoio" role="alert">
          Não foi possível carregar as decisões. <button type="button" className="text-button" onClick={tentarDeNovo}>Tentar de novo</button>
        </p>
      )}
      {carga.estado === 'pronto' && lista.length === 0 && <p className="retro-secao-apoio">Nenhuma decisão aceita ainda.</p>}
      {lista.length > 0 && (
        <ol className="retro-decisoes-lista">
          {lista.map(decisao => (
            <li key={decisao.id} className="retro-decisao" data-situacao={decisao.situacao}>
              <span className="retro-decisao-marco" aria-hidden="true" />
              <div>
                <h4 className="retro-decisao-titulo">{decisao.titulo}</h4>
                <p className="retro-decisao-situacao">
                  {decisao.situacao === 'vale-hoje' && 'Vale hoje'}
                  {decisao.situacao === 'substituida' && (decisao.trocadaPor ? `Substituída por ${decisao.trocadaPor}` : 'Substituída')}
                  {decisao.situacao === 'revogada' && 'Revogada'}
                </p>
              </div>
              <DateLabel value={decisao.data} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
