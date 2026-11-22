import { slice } from './stryker.common.mjs'

// Fatia: pente fino de estados de carga, decisões à vista e checkpoints enxutos (frente ux-estados).
// Módulos puros, sem tela:
// - src/carga/falhas.ts: classifica a falha de carga e a contagem da barra lateral;
// - src/pendencias-do-dono.ts: as pendências únicas do dono;
// - src/decisoes/separar.ts: propostas abertas, vigentes e histórico;
// - src/checkpoints/agrupar.ts e evidencias.ts: o que cada checkpoint mostra;
// - src/regras/busca.ts e src/mensagens/destinatario.ts: busca em Regras e destinatário de mensagem.
// As telas que usam esses módulos são provadas por tests/estados.spec.ts (Playwright).
export default slice({
  name: 'ux-estados',
  mutate: [
    'src/carga/falhas.ts',
    'src/pendencias-do-dono.ts',
    'src/decisoes/separar.ts',
    'src/checkpoints/agrupar.ts',
    'src/checkpoints/evidencias.ts',
    'src/regras/busca.ts',
    'src/mensagens/destinatario.ts',
  ],
  tests: [
    'tests/carga-falhas.test.ts',
    'tests/pendencias-do-dono.test.ts',
    'tests/decisoes-separar.test.ts',
    'tests/checkpoints-agrupar.test.ts',
    'tests/checkpoints-evidencias.test.ts',
    'tests/regras-busca.test.ts',
    'tests/mensagens-destinatario.test.ts',
  ],
})
