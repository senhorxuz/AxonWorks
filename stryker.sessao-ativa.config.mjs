import { slice } from './stryker.common.mjs'

// Fatia da correção "o gancho não recupera sessão que ainda está escrevendo na conversa" (25/10/2026): o módulo
// novo inteiro (server/ganchos/sessao-parada.ts) e só as linhas mudadas de acoes.ts (a reexportação do prazo e o
// laço de recuperarSessoesAbertas, que agora consulta a data da conversa). O restante de acoes.ts não mudou e
// está na fatia dos ganchos (stryker.ganchos.config.mjs). Em 26/10/2026 o prazo passou de 30 minutos para 6 horas
// (só o valor de `MINUTOS_PARA_RECUPERAR`, no módulo inteiro desta fatia; as faixas de acoes.ts não mudaram).
// Placar em docs/QUALIDADE.md.
export default {
  ...slice({
    name: 'sessao-ativa',
    mutate: ['server/ganchos/sessao-parada.ts', 'server/ganchos/acoes.ts:52-52', 'server/ganchos/acoes.ts:160-168'],
    tests: ['tests/ganchos-sessao-parada.test.ts', 'tests/ganchos-acoes.test.ts'],
  }),
  concurrency: 4,
}
