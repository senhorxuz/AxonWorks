import { slice } from './stryker.common.mjs'

// Fatia do orçamento por prioridade do contexto compilado (etapa 1, frente C): quem entra, em que forma e o que fica de fora.
export default slice({
  name: 'contexto-orcamento',
  mutate: ['server/contexto/orcamento.ts'],
  tests: ['tests/contexto-orcamento.test.ts'],
})
