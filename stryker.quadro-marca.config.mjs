import { slice } from './stryker.common.mjs'

const tests = ['tests/board.test.ts']

// Fatia da marca "depende de você" do cartão (Task 2): a regra nova mora em board-marca.ts (módulo inteiro)
// e a ligação no board.ts entra só pelas linhas que a tarefa tocou (faixas do Stryker `arquivo:início-fim`).
const fatia = slice({
  name: 'quadro-marca',
  mutate: [
    'server/store/board-marca.ts',
    'server/store/board.ts:29-29', // lista de colunas lidas do cartão
    'server/store/board.ts:71-71', // cria a coluna em bancos antigos
    'server/store/board.ts:85-85', // leitura da marca
    'server/store/board.ts:316-316', // marca na criação
    'server/store/board.ts:324-325', // INSERT com a coluna nova
    'server/store/board.ts:336-336',
    'server/store/board.ts:375-375', // marca na edição
    'server/store/board.ts:396-396', // frase do histórico
    'server/store/board.ts:442-442', // UPDATE com a coluna nova
    'server/store/board.ts:452-452',
  ],
  tests,
})

export default fatia
