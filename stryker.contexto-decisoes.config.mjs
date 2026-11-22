import { slice } from './stryker.common.mjs'

// Fatia das decisões do contexto compilado (etapa 1, correção da frente A): quem manda na fonte, qual tarefa
// fica em foco, quais lições são do dono e quando uma seção entra. Módulo puro, chamado por `secoes.ts`.
export default slice({
  name: 'contexto-decisoes',
  mutate: ['server/contexto/decisoes.ts'],
  tests: ['tests/contexto-decisoes.test.ts', 'tests/contexto-secoes.test.ts', 'tests/leitura-curta-contexto.test.ts'],
})
