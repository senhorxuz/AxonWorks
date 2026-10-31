import { slice } from './stryker.common.mjs'

// Fatia do git na abertura da sessão (lote 2, D1: tempo-limite, status da pasta, log). A correção "o aviso de
// trabalho não registrado olha todos os ramos" mexeu só nas linhas abaixo de server/ganchos/git.ts, e a de
// 26/10/2026 ("falhas do git separadas e notas fora do aviso") mexeu nas mesmas e em mais algumas: a lista
// `TODOS_OS_RAMOS` (git.ts:25, agora com `--exclude=refs/notes/*`), a função pura `estadoDaLeitura`
// (git.ts:90-92) e a leitura dos dois comandos até o prazo em `lerEstadoDoGit` (git.ts:119-143). Mutação só
// nelas. O restante do módulo e as faixas de extras, acoes e principal que esta configuração tinha foram
// medidos na entrega do lote 2 e não mudaram (placar em docs/QUALIDADE.md).
export default slice({
  name: 'ganchos-git',
  mutate: ['server/ganchos/git.ts:25-25', 'server/ganchos/git.ts:90-92', 'server/ganchos/git.ts:119-143'],
  tests: ['tests/ganchos-git.test.ts'],
})
