import { slice } from './stryker.common.mjs'

// Fatia dos pedidos do dono no rascunho automático (lote 2, D6): a seção (server/ganchos/pedidos-do-dono.ts)
// e só as linhas novas da leitura da conversa e das ações dos ganchos. Depois da revisão da onda 1 entram também
// o que não é pedido do dono (resumo injetado pela compactação, comandos e interrupção) e o corte do mínimo de pedidos.
// Depois da correção do correção feita depois de uso real entram os blocos que ferramentas injetam na mensagem do dono
// (server/ganchos/blocos-injetados.ts, módulo novo inteiro) e a ligação em `contarDono` (transcricao.ts:137-141).
export default slice({
  name: 'pedidos-do-dono',
  mutate: [
    'server/ganchos/pedidos-do-dono.ts',
    'server/ganchos/blocos-injetados.ts',
    'server/ganchos/transcricao.ts:21-21',
    'server/ganchos/transcricao.ts:116-120',
    'server/ganchos/transcricao.ts:128-128',
    'server/ganchos/transcricao.ts:137-141',
    'server/ganchos/transcricao.ts:173-178',
    'server/ganchos/acoes.ts:101-101',
    'server/ganchos/acoes.ts:104-104',
    'server/ganchos/acoes.ts:204-205',
  ],
  tests: [
    'tests/ganchos-pedidos.test.ts',
    'tests/ganchos-transcricao.test.ts',
    'tests/ganchos-blocos-injetados.test.ts',
    'tests/ganchos-acoes.test.ts',
  ],
})
