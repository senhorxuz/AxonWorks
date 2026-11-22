import { slice } from './stryker.common.mjs'

// Fatia dos tipos de memória (etapa 1, frente A): erro, regra e verificação, a migração aditiva da tabela,
// as recusas com código estável, a substituição numa transação e os filtros da listagem.
export default slice({
  name: 'licoes-tipos',
  mutate: ['server/store/licoes.ts'],
  tests: ['tests/licoes.test.ts', 'tests/licoes-tipos.test.ts', 'tests/licoes-correcoes.test.ts'],
})
