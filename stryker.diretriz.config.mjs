import { slice } from './stryker.common.mjs'

// Fatia da aba Diretriz: de que jeito o texto vira seções, itens e tom, e as contas das versões (quem escreveu, conferência, registros desde então, avisos).
// O selo (geometria do desenho) e os componentes ficam de fora: são layout, sem regra de negócio.
export default slice({
  name: 'diretriz',
  mutate: ['src/diretriz/secoes.ts', 'src/diretriz/versoes.ts'],
  tests: ['tests/diretriz-secoes.test.ts', 'tests/diretriz-versoes.test.ts'],
})
