import { slice } from './stryker.common.mjs'

// Fatia das lições que o Claude não repete (lote 2, D4): registrar sem duplicar, listar, aposentar e escopo.
export default slice({
  name: 'licoes',
  mutate: ['server/store/licoes.ts'],
  tests: ['tests/licoes.test.ts'],
})
