import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { MOMENTOS_DA_VERIFICACAO, type Licao } from '../../shared/licoes';
import type { ItemNaLixeira } from '../../shared/lixeira';
import { EditarLicao } from './EditarLicao';
import { ConfirmarApagamento, Lixeira } from './Lixeira';
import { useLixeira } from './useLixeira';
import { autoriaDaLicao, dataDaLicao, resumoDaFalha, ROTULOS_DOS_MOMENTOS, separarLicoes, type AcaoSobreLicao } from './texto';
import { useRegras, type FalhaDaVerificacao } from './useRegras';
import './regras.css';

type AbrirEdicao = (acao: AcaoSobreLicao) => void;
type AcoesDaLicao = { abrir: AbrirEdicao; mandarParaLixeira: (id: string) => void; lixeiraOcupada: boolean };

function Parte({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  const id = useId();
  return <section className="regras-parte" aria-labelledby={id}>
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
  return <>
    {frase && frase !== licao.texto && <blockquote className="regras-frase">
      <span>Dita por você</span>
      <p>{frase}</p>
    </blockquote>}
    <p className="regras-autoria">
      {licao.origem !== 'Dono' && frase === licao.texto && 'Dita por você · '}
      {autoriaDaLicao(licao)} em <time dateTime={licao.criadaEm}>{dataDaLicao(licao.criadaEm)}</time>
    </p>
  </>;
}

function Acoes({ licao, abrir, mandarParaLixeira, lixeiraOcupada }: AcoesDaLicao & { licao: Licao }) {
  const erro = licao.tipo === 'erro';
  const retirar = erro ? 'Aposentar' : 'Desfazer';
  return <div className="regras-acoes">
    {!erro && <button type="button" className="regras-acao" aria-label={`Corrigir: ${licao.texto}`}
      onClick={() => abrir({ tipo: 'corrigir', licao })}>Corrigir</button>}
    <button type="button" className="regras-acao" aria-label={`${retirar}: ${licao.texto}`}
      onClick={() => abrir({ tipo: 'aposentar', licao })}>{retirar}</button>
    {licao.projectId !== null && <button type="button" className="regras-acao" disabled={lixeiraOcupada}
      aria-label={`Mandar para a lixeira: ${licao.texto}`} onClick={() => mandarParaLixeira(licao.id)}>Mandar para a lixeira</button>}
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
      return <li className="regras-orientacao" key={licao.id}>
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
    {licoes.map(licao => <li key={licao.id}>
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
      <Grupo titulo="Em todos os projetos">
        <Erros licoes={errosGerais} {...acoes} vazio="Nenhum erro geral anotado."/>
      </Grupo>
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
    <Parte titulo="Lixeira">{lixeira}</Parte>
  </div>;
}

export function Regras({ projectId }: { projectId: string }) {
  const { lista, falhas, erroNasFalhas, recarregar, aplicar, remover } = useRegras(projectId);
  const lixeira = useLixeira(projectId);
  const [itemParaApagar, setItemParaApagar] = useState<ItemNaLixeira | null>(null);
  const [acao, setAcao] = useState<AcaoSobreLicao | null>(null);
  const [retorno, setRetorno] = useState<{ texto: string; focar: boolean } | null>(null);
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
    if (await lixeira.mandar(id)) {
      remover(id);
      setRetorno({ texto: 'Item enviado para a lixeira.', focar: true });
    }
  }

  async function retirarDaLixeira(item: ItemNaLixeira, operacao: 'restaurar' | 'apagar') {
    setRetorno(null);
    if (!(await lixeira.retirar(item, operacao))) return;
    if (operacao === 'restaurar') recarregar();
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
    }}/>}
  </div>;
}
