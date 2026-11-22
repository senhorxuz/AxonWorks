import type { AprovacaoDaEntrega, EstadoDaEntrega } from '../../shared/entrega';

type TomDoSelo = 'neutro' | 'brasa' | 'feito' | 'atencao';
type Selo = { texto: string; tom: TomDoSelo };

const TESTES: Record<EstadoDaEntrega['testes']['estado'], Selo> = {
  nao_rodado: { texto: 'Testes ainda não rodados', tom: 'neutro' },
  passando: { texto: 'Testes passando (relato)', tom: 'feito' },
  falhando: { texto: 'Testes falhando (relato)', tom: 'atencao' },
};

const CODIGO: Record<EstadoDaEntrega['codigo']['onde'], Selo> = {
  nao_feito: { texto: 'Código ainda não feito', tom: 'neutro' },
  local: { texto: 'Código no PC', tom: 'brasa' },
  enviado: { texto: 'Código enviado', tom: 'feito' },
};

export function aprovacoesVigentes(aprovacoes: AprovacaoDaEntrega[]) {
  return aprovacoes.filter(aprovacao => aprovacao.desfeitaEm === null);
}

export function origemDaAprovacao(aprovacao: AprovacaoDaEntrega) {
  return aprovacao.origem === 'tela'
    ? 'Aprovado por você na tela'
    : `Dito por você no chat, registrado por ${aprovacao.registradaPor} (nome declarado)`;
}

export function textoDaAprovacaoDesfeita(aprovacao: AprovacaoDaEntrega) {
  const autoria = aprovacao.desfeitaPor;
  if (autoria === undefined) return 'Aprovação desfeita';
  if (autoria.origem === 'tela') return 'Desfeita por você na tela';
  return `Desfeita por ${autoria.agente} (nome declarado) a seu pedido: '${autoria.pedidoDoDono}'`;
}

export function tituloDaAprovacao(aprovacao: AprovacaoDaEntrega) {
  return aprovacao.tipo === 'visual' ? 'Visual' : `Publicação em ${aprovacao.ambiente}`;
}

export function resumoParaODono(resumo: string) {
  return resumo
    .replace(/(^| · )aprovado \(visual\)(?= · |$)/, '$1visual aprovado')
    .replace(/(^| · )commit local /, '$1código no PC, versão ')
    .replace(/(^| · )commit enviado /, '$1código enviado, versão ')
    .replace(/(^| · )código local(?= · |$)/, '$1código no PC')
    .replace(/( · publicado em [^·]*), commit (?=[^·]+ \(relato de )/g, '$1, versão ');
}

function seloDePublicacao(ambiente: string, publicados: Set<string>, autorizados: Set<string | null>): Selo {
  if (publicados.has(ambiente)) return { texto: `${ambiente}: publicada (relato)`, tom: 'feito' };
  if (autorizados.has(ambiente)) return { texto: `${ambiente}: publicação autorizada`, tom: 'brasa' };
  return { texto: `${ambiente}: publicação pendente`, tom: 'neutro' };
}

export function selosDaEntrega(entrega: EstadoDaEntrega) {
  const vigentes = aprovacoesVigentes(entrega.aprovacoes);
  const visual = vigentes.some(aprovacao => aprovacao.tipo === 'visual');
  const publicados = new Set(entrega.publicacoes.map(publicacao => publicacao.ambiente));
  const autorizados = new Set(vigentes.map(aprovacao => aprovacao.ambiente));
  // Só aparece ambiente que alguém citou (publicação ou aprovação, mesmo desfeita); nenhum é suposto.
  const ambientes = new Set(publicados);
  for (const aprovacao of entrega.aprovacoes) {
    if (aprovacao.ambiente !== null) ambientes.add(aprovacao.ambiente);
  }
  const publicacao = ambientes.size === 0
    ? [{ chave: 'publicacao', texto: 'Publicação pendente', tom: 'neutro' }]
    : [...ambientes].map(ambiente => ({ chave: `publicacao-${ambiente}`, ...seloDePublicacao(ambiente, publicados, autorizados) }));

  return [
    {
      chave: 'visual',
      ...(visual ? { texto: 'Visual aprovado', tom: 'feito' } : { texto: 'Visual pendente', tom: 'neutro' }),
    },
    { chave: 'testes', ...TESTES[entrega.testes.estado] },
    { chave: 'codigo', ...CODIGO[entrega.codigo.onde] },
    ...publicacao,
  ];
}
