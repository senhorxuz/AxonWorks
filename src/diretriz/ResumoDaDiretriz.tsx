import { ArrowRight } from 'lucide-react';
import { SeloDaDiretriz } from './SeloDaDiretriz';
import { resumoDaDiretriz } from './resumo';
import { useDiretriz } from './useDiretriz';

/** A diretriz na Visão geral: só o resumo. O documento inteiro mora na aba Diretriz, a um clique daqui. */
export function ResumoDaDiretriz({ projectId, nomeDoProjeto, refresh, abrir }: {
  projectId: string; nomeDoProjeto: string; refresh: () => Promise<void>; abrir: () => void;
}) {
  const { charter, historico, loading, falhaNaLeitura, error, tentarNovamente } = useDiretriz(projectId, refresh);
  const resumo = resumoDaDiretriz(charter, nomeDoProjeto);
  return <section className="dz-resumo" aria-label="Resumo da diretriz do projeto">
    <div className="dz-resumo-texto">
      <p className="dz-resumo-rotulo">Diretriz do projeto</p>
      {loading && <p role="status" className="dz-resumo-frase">Buscando a diretriz…</p>}
      {falhaNaLeitura && <>
        <p role="alert" className="dz-resumo-frase">{error}</p>
        <button type="button" className="text-button" onClick={tentarNovamente}>Tentar novamente</button>
      </>}
      {!loading && !falhaNaLeitura && <>
        <p className="dz-resumo-frase">{resumo.frase}</p>
        {resumo.versao && <p className="dz-resumo-versao">{resumo.versao}</p>}
        {resumo.aviso && <p className="dz-resumo-aviso">{resumo.aviso}</p>}
        <button type="button" className="text-button dz-resumo-abrir" onClick={abrir}>Abrir a diretriz<ArrowRight size={14}/></button>
      </>}
    </div>
    {charter && !loading && !falhaNaLeitura && <SeloDaDiretriz compacto revisoes={historico.map(v => v.revision)} idDoProjeto={projectId} vendo={null}/>}
  </section>;
}
