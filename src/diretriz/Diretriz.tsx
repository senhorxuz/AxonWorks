import { useRef, useState } from 'react';
import type { CharterRevision } from '../../shared/continuity';
import { api } from '../api';
import { useFeedback } from '../Feedback';
import { chaveDaChegada } from '../chegada/chegada';
import { irPara } from '../chegada/irPara';
import { InformarNomeSeFaltar } from '../identidade/InformarNome';
import { nomeDoDono } from '../quadro/api-quadro';
import { autoriaDaTela } from '../identidade/identidade';
import { Artigos } from './Artigos';
import { CabecaDaDiretriz } from './CabecaDaDiretriz';
import { EditorDaDiretriz } from './EditorDaDiretriz';
import { IndiceDaDiretriz } from './IndiceDaDiretriz';
import { LinhaDasVersoes } from './LinhaDasVersoes';
import { mancheteDe, secoesDe, separarObjetivo } from './secoes';
import { useDiretriz } from './useDiretriz';
import { aguardaConferencia, avisoDeAtualizacao, avisoDeVersaoAntiga, registrosDesde, rotuloDoSalvar } from './versoes';
import './diretriz.css';

type Estado = ReturnType<typeof useDiretriz>;

interface Dados { projectId: string; nomeDoProjeto: string; agent: string; registros: ReadonlyArray<{ createdAt: string }> }

/** A aba da diretriz: busca o texto e as versões e desenha a folha. A regra mora nos módulos ao lado. */
export function Diretriz({ projectId, nomeDoProjeto = '', agent, refresh, registros = [] }: {
  projectId: string; nomeDoProjeto?: string; agent: string; refresh: () => Promise<void>; registros?: ReadonlyArray<{ createdAt: string }>;
}) {
  const estado = useDiretriz(projectId, refresh);
  const { loading, falhaNaLeitura, error, status, tentarNovamente } = estado;
  return <section className="dz-folha" data-chegada="diretriz" aria-label="Diretriz do projeto">
    {error && <p className="alert dz-alerta" role="alert">{error}<InformarNomeSeFaltar erro={error}/></p>}
    <p role="status" className="dz-status">{loading ? 'Buscando a diretriz…' : status}</p>
    {(loading || falhaNaLeitura) && <div className="dz-espera">
      <p className="dz-rotulo">Diretriz do projeto</p>
      {falhaNaLeitura && <button type="button" className="dz-botao" onClick={tentarNovamente}>Tentar novamente</button>}
    </div>}
    {!loading && !falhaNaLeitura && <FolhaDaDiretriz estado={estado} dados={{ projectId, nomeDoProjeto, agent, registros }}/>}
  </section>;
}

function FolhaDaDiretriz({ estado, dados }: { estado: Estado; dados: Dados }) {
  const { charter, historico, busy, aplicar } = estado;
  const { projectId, nomeDoProjeto, agent, registros } = dados;
  const notify = useFeedback();
  const raiz = useRef<HTMLDivElement>(null);
  const [ativo, setAtivo] = useState<number | null>(null);
  const [vendo, setVendo] = useState<number | null>(null);
  const [editando, setEditando] = useState(false);

  const mostrada = (vendo !== null ? historico.find(v => v.revision === vendo) : undefined) ?? charter;
  const { objetivo, resto } = separarObjetivo(mostrada ? secoesDe(mostrada.body) : []);
  const verAntiga = charter !== null && mostrada !== null && mostrada.revision !== charter.revision;
  const pendente = charter !== null && aguardaConferencia(charter);

  async function agir(acao: () => Promise<unknown>, carregando: string, concluido: string) {
    if (await aplicar(acao, carregando, concluido)) {
      setEditando(false);
      setVendo(null);
    }
  }

  function salvar(body: string) {
    void agir(async () => {
      const { autor, origem } = autoriaDaTela(agent, nomeDoDono());
      const proxima = await api.saveCharter(projectId, { actor: autor, origem: origem === 'agent_report' ? 'agent_report' : 'human_directive', body, expectedRevision: charter?.revision ?? 0 });
      notify('Diretriz do projeto atualizada', `Versão ${proxima.revision}`);
    }, 'Salvando a diretriz…', 'Diretriz salva.');
  }

  function irParaSecao(indice: number) {
    setAtivo(indice);
    irPara({ chave: chaveDaChegada('diretriz', String(indice)) });
  }

  function abrirVersao(revisao: number) {
    setVendo(revisao === charter?.revision ? null : revisao);
    raiz.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  return <div ref={raiz}>
    <CabecaDaDiretriz manchete={objetivo ? mancheteDe(objetivo, nomeDoProjeto) : null} vigente={charter}
      revisoes={historico.map(v => v.revision)} idDoProjeto={projectId} vendo={vendo}
      registros={charter ? registrosDesde(registros, charter.createdAt) : 0} verAntiga={verAntiga}
      acoes={{
        busy, editando,
        conferir: () => void agir(() => api.conferirDiretriz(projectId), 'Registrando sua conferência…', 'Diretriz conferida.'),
        voltarAoMeuTexto: () => void agir(() => api.desfazerDiretriz(projectId), 'Voltando ao seu texto…', 'Seu texto voltou a ser a diretriz.'),
        editar: () => { setVendo(null); setEditando(true); },
      }}/>
    <FaixasDaDiretriz charter={charter} mostrada={mostrada} pendente={pendente} verAntiga={verAntiga} voltarAVigente={() => setVendo(null)}/>
    {editando
      ? <EditorDaDiretriz textoAtual={charter?.body ?? ''} nomeDoProjeto={nomeDoProjeto} rotuloDoSalvar={rotuloDoSalvar(charter)} busy={busy} salvar={salvar} cancelar={() => setEditando(false)}/>
      : <>
        {resto.length > 0 && <div className="dz-corpo">
          <IndiceDaDiretriz secoes={resto} nomeDoProjeto={nomeDoProjeto} ativo={ativo} irPara={irParaSecao}/>
          <Artigos secoes={resto} nomeDoProjeto={nomeDoProjeto}/>
        </div>}
        {charter && <LinhaDasVersoes versoes={historico} vigente={charter} vendo={vendo} abrir={abrirVersao}/>}
      </>}
  </div>;
}

/** A faixa de "uma IA atualizou" ou de "você está vendo uma versão antiga". */
function FaixasDaDiretriz({ charter, mostrada, pendente, verAntiga, voltarAVigente }: {
  charter: CharterRevision | null; mostrada: CharterRevision | null; pendente: boolean; verAntiga: boolean; voltarAVigente: () => void;
}) {
  if (verAntiga && mostrada) return <div className="dz-faixa">
    {avisoDeVersaoAntiga(mostrada)}
    <button type="button" className="dz-botao" onClick={voltarAVigente}>Voltar à vigente</button>
  </div>;
  return charter && pendente ? <p className="dz-faixa dz-faixa-ia">{avisoDeAtualizacao(charter)}</p> : null;
}
