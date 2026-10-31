/**
 * Índice da busca na memória (lote 2, D7): esquema, gatilhos e reconstrução.
 *
 * Duas tabelas. `memoria_itens` guarda, para cada linha indexada, o tipo, o id na tabela de origem, o
 * projeto (NULL = lição global), a data usada no desempate e o peso do tipo (que muda com a situação:
 * decisão revogada, lição aposentada). `memoria_fts` (FTS5, `unicode61 remove_diacritics 2`, prefixos de
 * 2 e 3 letras) guarda só o título e o corpo, com o rowid igual ao `id` do item. Separar os dois deixa a
 * consulta ler o texto só dos poucos resultados finais.
 *
 * Cada tabela de origem tem três gatilhos (criar, editar, apagar); apagar um item apaga o texto dele (um
 * gatilho em `memoria_itens`). Apagar um projeto apaga as linhas de origem, e com elas as do índice.
 *
 * A biblioteca entra no mesmo índice (um item por conteúdo, com o texto da revisão vigente), para a
 * relevância dela ser medida junto com o resto: num índice próprio e pequeno, o BM25 dela ia a quase zero.
 * O `content_fts` continua existindo para a busca da própria biblioteca. O store grava o item antes da
 * revisão (criar) e a revisão antes de apontar o item para ela (revisar), então um gatilho a mais, na
 * revisão, traz o corpo quando a revisão gravada já é a vigente.
 *
 * Os nomes dos gatilhos levam a versão (`memoria_v1_`): uma mudança futura cria `memoria_v2_` e apaga os
 * antigos, sem depender de `IF NOT EXISTS` para trocar uma definição.
 */
import type { DatabaseSync } from 'node:sqlite'
import { PESOS, type TipoDaMemoria } from './consultar.js'

/**
 * Uma tabela de origem. As expressões são SQL sobre a linha, escrita como `$.coluna`: vira `NEW.coluna`
 * nos gatilhos e `t.coluna` na reconstrução.
 */
interface Fonte {
  tipo: TipoDaMemoria
  tabela: string
  titulo: string
  corpo: string
  data: string
  peso: string
  /** Colunas cuja mudança refaz o item (o gatilho de editar é `AFTER UPDATE OF` estas colunas). */
  vigiadas: string
  /** Só entram as linhas que passam neste filtro (padrão: todas). */
  filtro?: string
  /** Quais itens a linha nova substitui (padrão: o dela mesma, para regravação nunca duplicar). */
  substitui?: string
  /** Gatilhos a mais da fonte, em outras tabelas (`$.` vira `NEW.`). */
  outros?: string
}

/**
 * O último gatilho criado. Banco sem ele ainda não tem o índice inteiro (banco antigo, ou o índice de antes
 * da biblioteca entrar): a abertura cria o que falta e refaz o índice.
 */
const MARCA = 'memoria_v1_biblioteca_revisar'

const FONTES: readonly Fonte[] = [
  {
    tipo: 'checkpoint',
    tabela: 'checkpoints',
    titulo: "coalesce($.human_summary, '')",
    corpo: '$.summary || char(10) || $.next_step',
    data: '$.created_at',
    peso: `${PESOS.checkpoint}`,
    vigiadas: 'summary, human_summary, next_step',
  },
  {
    tipo: 'decisao',
    tabela: 'decisions',
    titulo: '$.title',
    corpo: '$.body',
    data: '$.updated_at',
    peso: `CASE $.status WHEN 'accepted' THEN ${PESOS.decisaoAceita} WHEN 'proposed' THEN ${PESOS.decisaoProposta} ELSE ${PESOS.encerrado} END`,
    vigiadas: 'title, body, status, updated_at',
  },
  {
    tipo: 'diretriz',
    tabela: 'charter_revisions',
    titulo: "''",
    corpo: '$.body',
    data: '$.created_at',
    peso: `${PESOS.diretriz}`,
    vigiadas: 'body, created_at',
    // Só a revisão vigente (a maior do projeto); a nova tira a anterior do índice.
    filtro: '$.revision = (SELECT max(r.revision) FROM charter_revisions r WHERE r.project_id = $.project_id)',
    substitui: 'project_id = $.project_id',
  },
  {
    tipo: 'cartao',
    tabela: 'board_cards',
    titulo: '$.title',
    corpo: '$.description',
    data: '$.updated_at',
    peso: `${PESOS.cartao}`,
    vigiadas: 'title, description, updated_at',
  },
  {
    tipo: 'backlog',
    tabela: 'backlog_items',
    titulo: '$.title',
    corpo: '$.description',
    data: '$.updated_at',
    peso: `${PESOS.backlog}`,
    vigiadas: 'title, description, updated_at',
  },
  {
    tipo: 'bloqueio',
    tabela: 'blockers',
    titulo: '$.title',
    corpo: "$.body || char(10) || coalesce($.resolution, '')",
    data: '$.updated_at',
    peso: `${PESOS.bloqueio}`,
    vigiadas: 'title, body, resolution, updated_at',
  },
  {
    tipo: 'mensagem',
    tabela: 'messages',
    titulo: "''",
    corpo: '$.body',
    data: '$.created_at',
    peso: `${PESOS.mensagem}`,
    vigiadas: 'body, created_at',
  },
  {
    tipo: 'licao',
    tabela: 'licoes',
    titulo: "''",
    corpo: '$.texto',
    data: 'coalesce($.aposentada_em, $.criada_em)',
    peso: `CASE WHEN $.aposentada_em IS NULL THEN ${PESOS.licao} ELSE ${PESOS.encerrado} END`,
    vigiadas: 'texto, aposentada_em, criada_em',
  },
  {
    tipo: 'biblioteca',
    tabela: 'content_items',
    titulo: '$.title',
    // Na criação, o item chega antes da revisão: corpo vazio até o gatilho da revisão trazer o texto.
    corpo: "coalesce((SELECT r.body FROM content_revisions r WHERE r.id = $.current_revision_id), '')",
    data: '$.updated_at',
    peso: `CASE $.status WHEN 'active' THEN ${PESOS.biblioteca} ELSE ${PESOS.encerrado} END`,
    vigiadas: 'title, status, current_revision_id, updated_at',
    outros: `
    CREATE TRIGGER IF NOT EXISTS ${MARCA} AFTER INSERT ON content_revisions
    WHEN $.id = (SELECT c.current_revision_id FROM content_items c WHERE c.id = $.item_id)
    BEGIN
      UPDATE memoria_fts SET corpo = $.body
        WHERE rowid = (SELECT id FROM memoria_itens WHERE tipo = 'biblioteca' AND fonte_id = $.item_id);
    END;`,
  },
]

const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS memoria_itens (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL,
    fonte_id TEXT NOT NULL,
    project_id TEXT,
    data TEXT NOT NULL,
    peso REAL NOT NULL,
    UNIQUE (tipo, fonte_id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS memoria_fts USING fts5(
    titulo,
    corpo,
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3'
  );
  CREATE TRIGGER IF NOT EXISTS memoria_v1_itens_apagar AFTER DELETE ON memoria_itens
  BEGIN
    DELETE FROM memoria_fts WHERE rowid = OLD.id;
  END;
`

function naLinha(sql: string, linha: string): string {
  return sql.replaceAll('$.', `${linha}.`)
}

function gatilhos(fonte: Fonte): string {
  const { tipo, tabela } = fonte
  const doItem = `tipo = '${tipo}' AND fonte_id = NEW.id`
  return naLinha(
    `
    CREATE TRIGGER IF NOT EXISTS memoria_v1_${tipo}_criar AFTER INSERT ON ${tabela}
    WHEN ${fonte.filtro ?? '1'}
    BEGIN
      DELETE FROM memoria_itens WHERE tipo = '${tipo}' AND ${fonte.substitui ?? 'fonte_id = $.id'};
      INSERT INTO memoria_itens (tipo, fonte_id, project_id, data, peso)
        VALUES ('${tipo}', $.id, $.project_id, ${fonte.data}, ${fonte.peso});
      INSERT INTO memoria_fts (rowid, titulo, corpo) VALUES (last_insert_rowid(), ${fonte.titulo}, ${fonte.corpo});
    END;
    CREATE TRIGGER IF NOT EXISTS memoria_v1_${tipo}_editar AFTER UPDATE OF ${fonte.vigiadas} ON ${tabela}
    BEGIN
      UPDATE memoria_itens SET data = ${fonte.data}, peso = ${fonte.peso} WHERE ${doItem};
      UPDATE memoria_fts SET titulo = ${fonte.titulo}, corpo = ${fonte.corpo}
        WHERE rowid = (SELECT id FROM memoria_itens WHERE ${doItem});
    END;
    CREATE TRIGGER IF NOT EXISTS memoria_v1_${tipo}_apagar AFTER DELETE ON ${tabela}
    BEGIN
      DELETE FROM memoria_itens WHERE tipo = '${tipo}' AND fonte_id = OLD.id;
    END;
    ${fonte.outros ?? ''}
  `,
    'NEW',
  )
}

/** Refaz o índice inteiro a partir das tabelas de origem (quem chama abre a transação). */
export function rebuildMemoriaIndex(db: DatabaseSync): void {
  db.exec('DELETE FROM memoria_fts; DELETE FROM memoria_itens;')
  for (const fonte of FONTES) {
    db.exec(
      naLinha(
        `
        INSERT INTO memoria_itens (tipo, fonte_id, project_id, data, peso)
          SELECT '${fonte.tipo}', $.id, $.project_id, ${fonte.data}, ${fonte.peso} FROM ${fonte.tabela} t
          WHERE ${fonte.filtro ?? '1'};
        INSERT INTO memoria_fts (rowid, titulo, corpo)
          SELECT i.id, ${fonte.titulo}, ${fonte.corpo} FROM ${fonte.tabela} t
          JOIN memoria_itens i ON i.tipo = '${fonte.tipo}' AND i.fonte_id = t.id;
      `,
        't',
      ),
    )
  }
}

/**
 * Cria o índice na primeira abertura (banco novo ou antigo, inclusive o que tem o índice de antes da
 * biblioteca) e o enche com o que o banco já tem, tudo numa transação só: se algo falha, nada fica pela
 * metade. Com o índice inteiro já criado, não faz nada.
 */
export function ensureMemoriaSchema(db: DatabaseSync): void {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(MARCA) !== undefined) return
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(ESQUEMA)
    for (const fonte of FONTES) db.exec(gatilhos(fonte))
    rebuildMemoriaIndex(db)
    db.exec('COMMIT')
  } catch (erro) {
    db.exec('ROLLBACK')
    throw erro
  }
}
