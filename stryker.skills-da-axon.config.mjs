import { slice } from './stryker.common.mjs'

// Fatia das skills da Axon no instalador (lote 2, D5): a lista das skills (parte pura) e só as linhas
// novas do instalador, que passa a copiar e a tirar as duas skills.
export default slice({
  name: 'skills-da-axon',
  mutate: [
    'scripts/claude/configuracao.ts:40-43',
    'scripts/claude/instalar.ts:114-117',
    'scripts/claude/instalar.ts:156-159',
    'scripts/claude/instalar.ts:219-221',
    'scripts/claude/instalar.ts:229-233',
    'scripts/claude/instalar.ts:239-239',
    'scripts/claude/instalar.ts:249-249',
    'scripts/claude/instalar.ts:259-266',
    'scripts/claude/instalar.ts:272-275',
  ],
  tests: ['tests/claude-configuracao.test.ts', 'tests/claude-instalar.test.ts'],
})
