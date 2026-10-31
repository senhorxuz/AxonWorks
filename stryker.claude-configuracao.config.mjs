import { slice } from './stryker.common.mjs'

// Fatia: a parte pura da ligação do Claude Code à Axon (mesclar e remover ganchos, entrada do MCP, citação de argumentos).
// O teste também confere as instruções do servidor MCP (server/mcp-instrucoes.ts), que não entram na mutação: é texto fixo.
export default slice({
  name: 'claude-configuracao',
  mutate: ['scripts/claude/configuracao.ts'],
  tests: ['tests/claude-configuracao.test.ts'],
})
