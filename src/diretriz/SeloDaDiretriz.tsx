import { LADO_DO_SELO, montarSelo } from './selo';

/** O selo da diretriz: um anel por versão. As contas estão em ./selo.ts; aqui só se pinta. O compacto (64 px) não leva texto no miolo. */
export function SeloDaDiretriz({ revisoes, idDoProjeto, vendo, compacto = false }: { revisoes: number[]; idDoProjeto: string; vendo: number | null; compacto?: boolean }) {
  const selo = montarSelo(revisoes, idDoProjeto, vendo);
  const meio = LADO_DO_SELO / 2;
  return <svg className={compacto ? 'dz-selo compacto' : 'dz-selo'} viewBox={`0 0 ${LADO_DO_SELO} ${LADO_DO_SELO}`} role="img" aria-label={selo.descricao}>
    {selo.aneis.map(anel => <path key={anel.chave} d={anel.d} className={`dz-anel${anel.vigente ? ' vigente' : ''}${anel.foco ? ' foco' : ''}`}/>)}
    {!compacto && <>
      <text x={meio} y={meio - 2} className="dz-centro-n">{selo.numero}</text>
      <text x={meio} y={meio + 22} className="dz-centro-r">{selo.rotulo}</text>
    </>}
  </svg>;
}
