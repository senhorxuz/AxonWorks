import { slice } from './stryker.common.mjs'

export default slice({
  name: 'integracao-mcp',
  mutate: ['server/mcp-instrucoes.ts', 'server/mcp-profile.ts'],
  tests: ['tests/mcp-instrucoes.test.ts', 'tests/mcp-profile.test.ts'],
})
