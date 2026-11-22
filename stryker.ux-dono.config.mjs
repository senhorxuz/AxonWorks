import { slice } from './stryker.common.mjs'

// Fatia: frente dono-cores e a junção das frentes de tela (ux-juncao). Só regra, sem tela:
// - src/texto/markdown.ts: o leitor de Markdown da Biblioteca (inclui o tempo linear dos fechos);
// - src/identidade/identidade.ts: o nome do dono e a autoria da tela (nome na barra vira IA e relato de agente);
// - src/apagar/removido.ts: a lista "o que será removido" ao excluir um projeto;
// - src/quadro/chegada-do-dono.ts: para onde "Ver no Quadro" leva o dono;
// - src/pendencias-do-dono.ts (só decisoesEsperandoNaAba) e src/regras/texto.ts (só fraseRepetida e palavrasDe).
// - server/store/objetivo.ts (só a origem da diretriz salva pela tela: IA vira atualização de agente).
// As telas que usam esses módulos são provadas por tests/ux-juncao.spec.ts e tests/dono-nome.spec.ts (Playwright).
const fatia = slice({
  name: 'ux-dono',
  mutate: [
    'src/texto/markdown.ts',
    'src/identidade/identidade.ts',
    'src/apagar/removido.ts',
    'src/quadro/chegada-do-dono.ts',
    'src/pendencias-do-dono.ts:20-24',
    'src/regras/texto.ts:87-102',
    'server/store/objetivo.ts:44-49',
  ],
  tests: [
    'tests/markdown.test.ts',
    'tests/markdown-tela.test.ts',
    'tests/identidade.test.ts',
    'tests/apagar-removido.test.ts',
    'tests/quadro-chegada-do-dono.test.ts',
    'tests/pendencias-do-dono.test.ts',
    'tests/regras-helpers.test.ts',
    'tests/diretriz-origem-da-tela.test.ts',
    'tests/objetivo.test.ts',
  ],
})

// A fatia toda roda em cerca de 5 s; um mutante que faz um laço girar sem fim é morto em 25 s (conta como morto).
export default { ...fatia, timeoutMS: 25000 }
