import { slice } from './stryker.common.mjs'

// Fatia das rotas HTTP das lições (aba Regras, etapa 2): entrada, recusas e dono do projeto.
export default slice({
  name: 'licoes-http',
  mutate: ['server/http/licoes.ts'],
  tests: ['tests/http-licoes.test.ts'],
})
