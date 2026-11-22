import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { MOMENTOS_DA_VERIFICACAO, type Licao } from '../../shared/licoes';
import type { ItemNaLixeira } from '../../shared/lixeira';
import { chaveDaChegada } from '../chegada/chegada';
import { irPara } from '../chegada/irPara';
import { AvisoDaLixeira } from './AvisoDaLixeira';
import { EditarLicao } from './EditarLicao';
import { ConfirmarApagamento, Lixeira } from './Lixeira';
import { useLixeira } from './useLixeira';
import { filtrarLicoes, rotuloDaContagem } from './busca';
import { autoriaDaLicao, dataDaLicao, fraseRepetida, resumoDaFalha, ROTULOS_DOS_MOMENTOS, separarLicoes, type AcaoSobreLicao } from './texto';
import { useRegras, type FalhaDaVerificacao } from './useRegras';
import './regras.css';

type AbrirEdicao = (acao: AcaoSobreLicao) => void;
type AcoesDaLicao = { abrir: AbrirEdicao; mandarParaLixeira: (id: string) => void; lixeiraOcupada: boolean };

function Parte({ titulo, acao, chave, children }: { titulo: string; acao?: ReactNode; chave?: string; children: ReactNode }) {
  const id = useId();
  return <section className="regras-parte" aria-labelledby={id} data-chegada={chave}>
    <header className="regras-parte-cabecalho">
      <h3 id={id}>{titulo}</h3>
      {acao}
    </header>
    {children}
  </section>;
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId();
  return <section className="regras-grupo" aria-labelledby={id}>
    <h4 id={id}>{titulo}</h4>
    {children}
  </section>;
}

function Metadados({ licao }: { licao: Licao }) {
  const frase = licao.fraseDoDono;
  const repete = frase !== null && fraseRepetida(licao.texto, frase);
  return <>
    {frase && !repete && <blockquote className="regras-frase">
      <span>Dita por você</span>
      <p>{frase}</p>
    </blockquote>}
    <p className="regras-autoria">
      {licao.origem !== 'Dono' && repete && 'Dita por você · '}
      {autoriaDaLicao(licao)} em <time dateTime={licao.criadaEm}>{dataDaLicao(licao.criadaEm)}</time>
    </p>
  </>;
}

function Acoes({ licao, abrir, mandarParaLixeira, lixeiraOcupada }: AcoesDaLicao & { licao: Licao }) {
  const erro = licao.tipo === 'erro';
  const retirar = erro ? 'Aposentar' : `Aposentar ${licao.tipo === 'regra' ? 'regra' : 'verificação'}`;
  return <div className="regras-acoes">
    {!erro && <button type="button" className="regras-acao" aria-label={`Corrigir: ${licao.texto}`}
      onClick={() => abrir({ tipo: 'corrigir', licao })}>Corrigir</button>}
    <button type="button" className="regras-acao" aria-label={`${retirar}: ${licao.texto}`}
      onClick={() => abrir({ tipo: 'aposentar', licao })}>{retirar}</button>
    {licao.projectId !== null && <button type="button" className="regras-acao regras-acao-icone" disabled={lixeiraOcupada} title="Mandar para a lixeira"
      aria-label={`Mandar para a lixeira: ${licao.texto}`} onClick={() => mandarParaLixeira(licao.id)}><Trash2 aria-hidden="true" size={16}/></button>}
  </div>;
}

function Falha({ falha }: { falha: FalhaDaVerificacao }) {
  return <div className="regras-falha">
    <p>{resumoDaFalha(falha.quantas, falha.ultimaEm)}</p>
    {falha.ultimoDetalhe && <p className="regras-falha-detalhe">{falha.ultimoDetalhe}</p>}
  </div>;
}

function Orientacoes({ licoes, vazio, falhas, ...acoes }: AcoesDaLicao & {
  licoes: Licao[]; vazio: string; falhas?: Map<string, FalhaDaVerificacao>;
}) {
  if (!licoes.length) return <p className="regras-vazio">{vazio}</p>;
  return <ul className="regras-lista">
    {licoes.map(licao => {
      const falha = falhas?.get(licao.id);
      return <li className="regras-orientacao" key={licao.id} data-chegada={chaveDaChegada('licao', licao.id)}>
        <div className="regras-orientacao-texto">
          <p className="regras-texto">{licao.texto}</p>
          <Metadados licao={licao}/>
          {falha && <Falha falha={falha}/>}
        </div>
        <Acoes licao={licao} {...acoes}/>
      </li>;
    })}
  </ul>;
}

function Erros({ licoes, vazio, ...acoes }: AcoesDaLicao & { licoes: Licao[]; vazio: string }) {
  if (!licoes.length) return <p className="regras-vazio">{vazio}</p>;
  return <ul className="regras-lista">
    {licoes.map(licao => <li key={licao.id} data-chegada={chaveDaChegada('licao', licao.id)}>
      <details className="regras-erro-item">
        <summary><span>{licao.linhaCurta ?? licao.texto}</span><ChevronDown aria-hidden="true" size={17}/></summary>
        <div className="regras-erro-corpo">
          {licao.linhaCurta && licao.linhaCurta !== licao.texto && <p className="regras-texto">{licao.texto}</p>}
          <Metadados licao={licao}/>
          <Acoes licao={licao} {...acoes}/>
        </div>
      </details>
    </li>)}
  </ul>;
}

/**
 * "Em todos os projetos" é a coluna mais longa da aba (dezenas de erros). Fica recolhida, com a contagem à vista e uma busca
 * quando abre; a lista do projeto é a que importa no dia a dia.
 */
function ErrosGerais({ licoes, ...acoes }: AcoesDaLicao & { licoes: Licao[] }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const id = useId();
  const achadas = filtrarLicoes(licoes, busca);
  const buscando = busca.trim() !== '';
  return <section className="regras-grupo" aria-labelledby={`${id}-titulo`}>
    <h4>
      <button type="button" className="regras-grupo-alternar" aria-expanded={aberto} aria-controls={`${id}-corpo`} onClick={() => setAberto(valor => !valor)}>
        <ChevronDown aria-hidden="true" size={17}/>
        <span id={`${id}-titulo`}>Em todos os projetos</span>
        <span className="regras-grupo-contagem">{rotuloDaContagem(achadas.length, licoes.length, buscando)}</span>
      </button>
    </h4>
    <div id={`${id}-corpo`} hidden={!aberto}>
      {aberto && <>
        {licoes.length > 0 && <label className="regras-busca">
          <span>Buscar nos erros de todos os projetos</span>
          <input type="search" value={busca} onChange={evento => setBusca(evento.target.value)} placeholder="Digite uma palavra"/>
        </label>}
        <Erros licoes={achadas} {...acoes} vazio={buscando ? 'Nenhum erro encontrado com essa busca.' : 'Nenhum erro geral anotado.'}/>
      </>}
    </div>
  </section>;
}

function NovaOrientacao({ categoria, abrir }: { categoria: 'regra' | 'verificacao'; abrir: AbrirEdicao }) {
  return <button type="button" className="button primary" onClick={() => abrir({ tipo: 'criar', categoria })}>
    <Plus aria-hidden="true" size={16}/>{categoria === 'regra' ? 'Nova regra' : 'Nova verificação'}
  </button>;
}

function Conteudo({ licoes, falhas, erroNasFalhas, recarregar, lixeira, ...acoes }: AcoesDaLicao & {
  licoes: Licao[]; falhas: Map<string, FalhaDaVerificacao>; erroNasFalhas: boolean; recarregar: () => void; lixeira: ReactNode;
}) {
  const { regras, errosDoProjeto, errosGerais, verificacoes } = separarLicoes(licoes);
  return <div className="regras-grade">
    <Parte titulo="Suas regras" acao={<NovaOrientacao categoria="regra" abrir={acoes.abrir}/>}>
      <Orientacoes licoes={regras} {...acoes} vazio="Você ainda não tem regras neste projeto."/>
    </Parte>
    <Parte titulo="Erros a não repetir">
      <Grupo titulo="Neste projeto">
        <Erros licoes={errosDoProjeto} {...acoes} vazio="Nenhum erro anotado neste projeto."/>
      </Grupo>
      <ErrosGerais licoes={errosGerais} {...acoes}/>
    </Parte>
    <Parte titulo="Verificações" acao={<NovaOrientacao categoria="verificacao" abrir={acoes.abrir}/>}>
      {erroNasFalhas && <div className="regras-estado">
        <p role="alert">Não foi possível consultar as falhas das verificações.</p>
        <button type="button" className="button secondary" onClick={recarregar}>Tentar novamente</button>
      </div>}
      {MOMENTOS_DA_VERIFICACAO.map(momento => <Grupo key={momento} titulo={ROTULOS_DOS_MOMENTOS[momento]}>
        <Orientacoes licoes={verificacoes[momento]} {...acoes} falhas={falhas} vazio="Nenhuma verificação para este momento."/>
      </Grupo>)}
    </Parte>
    <Parte titulo="Lixeira" chave="regras-lixeira">{lixeira}</Parte>
  </div>;
}

export function Regras({ projectId }: { projectId: string }) {
  const { lista, falhas, erroNasFalhas, recarregar, aplicar, remover } = useRegras(projectId);
  const lixeira = useLixeira(projectId);
  const [itemParaApagar, setItemParaApagar] = useState<ItemNaLixeira | null>(null);
  const [acao, setAcao] = useState<AcaoSobreLicao | null>(null);
  const [retorno, setRetorno] = useState<{ texto: string; focar: boolean } | null>(null);
  const [naLixeira, setNaLixeira] = useState<ItemNaLixeira | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    if (retorno?.focar) status.current?.focus();
  }, [retorno]);

  function abrir(proxima: AcaoSobreLicao) {
    setRetorno(null);
    setAcao(proxima);
  }

  async function mandarParaLixeira(id: string) {
    setRetorno(null);
    const item = await lixeira.mandar(id);
    if (item) {
      remover(id);
      setNaLixeira(item);
      setRetorno({ texto: 'Item enviado para a lixeira.', focar: true });
    }
  }
  const esquecerAviso = useCallback(() => setNaLixeira(null), []);
  const devolverFoco = useCallback(() => status.current?.focus(), []);

  async function retirarDaLixeira(item: ItemNaLixeira, operacao: 'restaurar' | 'apagar') {
    setRetorno(null);
    setNaLixeira(null);
    if (!(await lixeira.retirar(item, operacao))) return;
    if (operacao === 'restaurar') { recarregar(); irPara({ chave: chaveDaChegada('licao', item.id), semFoco: true }); }
    setItemParaApagar(null);
    setRetorno({ texto: operacao === 'restaurar' ? 'Item restaurado.' : 'Item apagado de vez.', focar: true });
  }

  function fecharConfirmacao(item: ItemNaLixeira | null) {
    lixeira.setErro('');
    setItemParaApagar(item);
  }

  return <div className="regras">
    <h2 className="regras-titulo">Regras</h2>
    <p className="regras-retorno" role="status" tabIndex={-1} ref={status}>{retorno?.texto}</p>
    {naLixeira && <AvisoDaLixeira item={naLixeira} ocupada={lixeira.ocupada} expirar={esquecerAviso} devolverFoco={devolverFoco}
      desfazer={() => void retirarDaLixeira(naLixeira, 'restaurar')} ver={() => irPara({ chave: 'regras-lixeira' })}/>}
    {lista.estado === 'carregando' && <p className="regras-estado" role="status">Buscando as orientações…</p>}
    {lista.estado === 'erro' && <div className="regras-estado">
      <p role="alert">Não foi possível abrir as regras agora.</p>
      <button type="button" className="button secondary" onClick={recarregar}>Tentar novamente</button>
    </div>}
    {lixeira.erro && !itemParaApagar && <p className="regras-aviso" role="alert">{lixeira.erro}</p>}
    {lista.estado === 'pronta' && <Conteudo licoes={lista.licoes} falhas={falhas} erroNasFalhas={erroNasFalhas}
      recarregar={recarregar} abrir={abrir} mandarParaLixeira={id => void mandarParaLixeira(id)} lixeiraOcupada={lixeira.ocupada || lixeira.carregando}
      lixeira={<Lixeira estado={lixeira} restaurar={item => void retirarDaLixeira(item, 'restaurar')} confirmarApagamento={fecharConfirmacao}/>}/>}
    {itemParaApagar && <ConfirmarApagamento item={itemParaApagar} ocupada={lixeira.ocupada} erro={lixeira.erro}
      cancelar={() => fecharConfirmacao(null)} confirmar={() => void retirarDaLixeira(itemParaApagar, 'apagar')}/>}
    {acao && <EditarLicao projectId={projectId} acao={acao} aoCancelar={() => setAcao(null)} aoSalvar={(licao, texto) => {
      aplicar(licao);
      setRetorno({ texto, focar: acao.tipo !== 'criar' });
      setAcao(null);
      // A regra nova (ou corrigida) pode cair abaixo da dobra: leva a tela até ela. Ao corrigir, o foco fica no aviso.
      if (acao.tipo !== 'aposentar') irPara({ chave: chaveDaChegada('licao', licao.id), semFoco: acao.tipo !== 'criar' });
    }}/>}
  </div>;
}
