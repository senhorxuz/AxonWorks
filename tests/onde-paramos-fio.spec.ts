import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { medirLegibilidade } from './apoio/legibilidade';

/**
 * O fio novo e as duas colunas de "Onde paramos": uma prova de tela para cada função.
 *
 * Os dados nascem de verdade pela API e o servidor real responde. Checkpoints são imutáveis (um gatilho do banco
 * trava `created_at`), então os dias antigos do projeto de teste são CARTÕES concluídos, datados no passado direto
 * no banco da suíte (`AXON_E2E_DB_PATH`, a mesma técnica de tests/onde-paramos.spec.ts). O que é de hoje (a tarefa
 * e os registros) nasce pelo caminho normal. Servidor e tela continuam reais.
 */

const HEADERS = { 'X-Workspace-Client': 'local' };
const DIA = 86_400_000;

type Coluna = 'ideas' | 'pending' | 'in_progress' | 'testing' | 'done' | 'blocked';
interface Projeto { id: string; name: string }
/** Um cartão concluído no passado: quem fez e há quantos dias (às 12h de São Paulo, mais `minutos`). */
interface Feito { texto: string; quem: string; dias: number; minutos?: number; /** Data exata, quando "dias" não serve (um instante de hoje, antes do registro). */ quando?: string }

const nomeUnico = (base: string) => `${base} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** A data de São Paulo de `dias` atrás, ao meio-dia (UTC-3, sem horário de verão desde 2019). */
function meioDia(dias: number, minutos = 0): string {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() - dias * DIA));
  const [ano, mes, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(ano!, mes! - 1, d!, 15, minutos)).toISOString();
}

function datarCartao(cardId: string, quando: string) {
  const db = new DatabaseSync(process.env.AXON_E2E_DB_PATH!);
  db.prepare('UPDATE board_cards SET updated_at = ? WHERE id = ?').run(quando, cardId);
  db.close();
}

async function criarProjeto(request: APIRequestContext, nome: string): Promise<Projeto> {
  const res = await request.post('/api/projects', { headers: HEADERS, data: { name: nome, objective: 'Provar o fio e as colunas na tela.' } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Projeto;
}

async function criarCartao(request: APIRequestContext, projectId: string, titulo: string, coluna: Coluna, ator = 'Claude', descricao?: string) {
  const res = await request.post(`/api/projects/${projectId}/board/cards`, {
    headers: HEADERS,
    data: { actor: ator, title: titulo, column: coluna, ...(descricao ? { description: descricao } : {}) },
  });
  expect(res.ok(), `criar cartão "${titulo}"`).toBeTruthy();
  return (await res.json()) as { id: string };
}

/** Cartões concluídos no passado: devolve o id de cada um, na ordem em que foram dados. */
async function concluirNoPassado(request: APIRequestContext, projectId: string, feitos: Feito[]): Promise<string[]> {
  const ids: string[] = [];
  for (const feito of feitos) {
    const cartao = await criarCartao(request, projectId, feito.texto, 'done', feito.quem);
    datarCartao(cartao.id, feito.quando ?? meioDia(feito.dias, feito.minutos ?? 0));
    ids.push(cartao.id);
  }
  return ids;
}

async function registrar(request: APIRequestContext, projectId: string, agente: string, frase: string, chave: string) {
  const atual = await (await request.get(`/api/projects/${projectId}`, { headers: HEADERS })).json();
  const res = await request.post(`/api/projects/${projectId}/checkpoints`, { headers: HEADERS, data: {
    agent: agente, expectedRevision: atual.project.revision, idempotencyKey: chave, summary: 'Feito.', humanSummary: frase, nextStep: 'Seguir.',
  } });
  expect(res.ok(), `registro "${frase}"`).toBeTruthy();
}

/** Uma tarefa concluída por uma IA, hoje (o registro dela também é uma coisa feita). */
async function tarefaConcluida(request: APIRequestContext, projectId: string, titulo: string, agente: string, frase: string, chave: string) {
  const tarefa = await (await request.post(`/api/projects/${projectId}/tasks`, { headers: HEADERS, data: { title: titulo } })).json();
  expect((await request.post(`/api/projects/${projectId}/tasks/${tarefa.id}/claim`, { headers: HEADERS, data: { agent: agente, expectedVersion: 0 } })).ok()).toBeTruthy();
  const atual = await (await request.get(`/api/projects/${projectId}`, { headers: HEADERS })).json();
  const res = await request.post(`/api/projects/${projectId}/finalize`, { headers: HEADERS, data: {
    agent: agente, expectedRevision: atual.project.revision, idempotencyKey: chave, summary: 'Feito.', humanSummary: frase,
    nextStep: 'Seguir.', taskId: tarefa.id, taskTransition: { kind: 'declare_done' },
  } });
  expect(res.ok(), `concluir a tarefa "${titulo}"`).toBeTruthy();
  return tarefa.id as string;
}

async function guardarIdeia(request: APIRequestContext, projectId: string, titulo: string) {
  const res = await request.post(`/api/projects/${projectId}/backlog`, {
    headers: HEADERS, data: { title: titulo, description: 'Ideia guardada para depois.', priority: 'low', stage: 'idea', createdBy: 'Claude' },
  });
  expect(res.ok(), `guardar ideia "${titulo}"`).toBeTruthy();
}

/** A pendência de três grupos: em andamento, a fazer e ideias. */
async function pendenciasEmTresGrupos(request: APIRequestContext, projectId: string) {
  await criarCartao(request, projectId, 'Publicar o site', 'in_progress');
  await criarCartao(request, projectId, 'Escolher o domínio', 'pending');
  await guardarIdeia(request, projectId, 'Modo claro para a vitrine');
}

const FRASE_DO_ESTADO = 'A vitrine está no ar e já recebe os primeiros pedidos de cursos.';

/**
 * O projeto de referência: três IAs (Astra, Claude Opus 5.5 e Codex), um silêncio de 17 dias, dias em mês antigo,
 * dias recentes, uma tarefa e um registro de hoje, e pendências em três grupos.
 */
async function projetoComFio(request: APIRequestContext, nome = nomeUnico('Projeto do fio')) {
  const projeto = await criarProjeto(request, nome);
  const ids = await concluirNoPassado(request, projeto.id, [
    { texto: 'Estrutura inicial: pastas, banco e tela de entrada prontos.', quem: 'Astra', dias: 40 },
    { texto: 'Cadastro de alunos: criar conta e entrar funcionam.', quem: 'Astra', dias: 40, minutos: 30 },
    { texto: 'Página de preços: três planos, com botão de compra.', quem: 'Claude Opus 5.5', dias: 39 },
    { texto: 'Pagamento por cartão: o aluno compra e entra na hora.', quem: 'Codex', dias: 30 },
    { texto: 'Recibo por e-mail: cada compra gera um recibo.', quem: 'Codex', dias: 29 },
    { texto: 'Painel do professor: alunos, notas e pedidos numa tela.', quem: 'Claude Opus 5.5', dias: 12 },
    { texto: 'Aulas em vídeo: o player lembra onde o aluno parou.', quem: 'Astra', dias: 11 },
    { texto: 'Certificado em PDF: gerado ao fim do curso.', quem: 'Codex', dias: 5 },
    { texto: 'Cupom de boas-vindas: o primeiro curso sai com desconto.', quem: 'Claude Opus 5.5', dias: 2 },
    // Hoje, um instante antes do registro: o dia de onde paramos tem duas famílias (Astra e Codex) e o ◉ continua sendo o mais novo.
    { texto: 'Revisão de textos: os avisos da vitrine foram reescritos.', quem: 'Astra', dias: 0, quando: new Date(Date.now() - 30_000).toISOString() },
  ]);
  await tarefaConcluida(request, projeto.id, 'Publicar a vitrine', 'Codex', FRASE_DO_ESTADO, `fio-${projeto.id}`);
  await pendenciasEmTresGrupos(request, projeto.id);
  return { projeto, ids, chavesDosCartoes: ids.map(id => `cartao:${id}`) };
}

async function abrirCarta(page: Page, projeto: Projeto) {
  await page.goto(`/#project/${projeto.id}`);
  await expect(page.getByRole('heading', { name: projeto.name, level: 1 })).toBeVisible();
  const aba = page.getByRole('tab', { name: 'Onde paramos' });
  if ((await aba.getAttribute('aria-selected')) !== 'true') await aba.click();
  await expect(page.getByRole('heading', { name: 'Onde paramos', level: 2 })).toBeVisible();
}

/** O fio pronto: desenhado e com a abertura (a escrita da esquerda para a direita) já terminada. */
async function abrirFio(page: Page, projeto: Projeto) {
  await abrirCarta(page, projeto);
  const quadro = page.locator('.fio-quadro');
  await expect(quadro.locator('button.fio-simbolo').first()).toBeVisible();
  await expect(quadro).not.toHaveClass(/fio-abrindo/, { timeout: 15_000 });
  return quadro;
}

const simbolo = (quadro: Locator, chave: string) => quadro.locator(`button.fio-simbolo[data-chave="${chave}"]`);
const linha = (page: Page, chave: string) => page.locator(`.feito-linha[data-linha="${chave}"]`);
const grupo = (page: Page, id: string) => page.locator(`.carta-grupo[data-grupo="${id}"]`);

/** O destaque de chegada dura 2,2 s: a classe aparece e depois some. */
async function esperarChegada(destino: Locator) {
  await expect(destino).toHaveClass(/carta-chegou/);
  await expect(destino).toBeFocused();
  await expect(destino).not.toHaveClass(/carta-chegou/, { timeout: 4000 });
}

/** A caixa na tela, com os mesmos eixos para todo mundo (a ampliação do monitor de 27" vale para todos). */
async function caixa(el: Locator) {
  const c = await el.boundingBox();
  expect(c, 'o elemento precisa estar na tela').not.toBeNull();
  return c!;
}

test.describe('os dados de teste', () => {
  test('a carta do projeto de referência tem três IAs, um silêncio de mais de 7 dias, dias em mês antigo e dois itens no último dia', async ({ request }) => {
    const { projeto } = await projetoComFio(request);
    const carta = await (await request.get(`/api/projects/${projeto.id}/carta`, { headers: HEADERS })).json();
    const feitos = [...carta.feitoRecente, ...carta.feitoPorMes.flatMap((m: { itens: unknown[] }) => m.itens)] as { quem?: string; quando: string; origem: string }[];
    expect(new Set(feitos.map(f => f.quem).filter(Boolean))).toEqual(new Set(['Astra', 'Claude Opus 5.5', 'Codex']));
    const dias = [...new Set(feitos.map(f => f.quando.slice(0, 10)))].sort();
    const vaos = dias.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dias[i]!)) / DIA);
    expect(Math.max(...vaos)).toBeGreaterThan(7);
    expect(carta.feitoPorMes.length).toBeGreaterThan(0);
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    expect(feitos.filter(f => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(f.quando)) === hoje).length).toBeGreaterThanOrEqual(2);
    expect(feitos.map(f => f.origem).sort()).toEqual(expect.arrayContaining(['cartao', 'registro', 'tarefa']));
    expect(carta.emUmaFrase).toBe(FRASE_DO_ESTADO);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Dados maiores: o projeto com muita pendência (rolagem das colunas) e o projeto denso (7 IAs, um dia cheio).
// ---------------------------------------------------------------------------------------------------------------

async function projetoGrande(request: APIRequestContext) {
  const base = await projetoComFio(request, nomeUnico('Projeto grande'));
  for (let i = 1; i <= 30; i++) await criarCartao(request, base.projeto.id, `Tarefa de teste número ${String(i).padStart(2, '0')} para encher a coluna`, 'pending');
  return base;
}

const IAS_DO_PROJETO_DENSO = ['Astra', 'Claude Opus 5.5', 'Codex', 'Gemini', 'Fundação', 'Atlas', 'Boreal'];

/** Sete IAs, uma a cada `passo` dias, e um dia com 30 coisas de uma IA só: com passo 7, o fio precisa comprimir sem estourar. */
async function projetoDenso(request: APIRequestContext, passo = 2) {
  const projeto = await criarProjeto(request, nomeUnico('Projeto denso'));
  await concluirNoPassado(request, projeto.id, IAS_DO_PROJETO_DENSO.map((quem, i) => ({ texto: `Entrega da semana ${i + 1}: ${quem} fechou a sua parte.`, quem, dias: 8 * passo - i * passo + 1 })));
  await concluirNoPassado(request, projeto.id, Array.from({ length: 30 }, (_, i) => ({ texto: `Ajuste ${i + 1}: detalhe do dia cheio, feito de uma vez.`, quem: 'Astra', dias: 1, minutos: i })));
  return projeto;
}

// ---------------------------------------------------------------------------------------------------------------
// Clique no fio e nos atalhos: o destino é alcançado, aceso e com o foco
// ---------------------------------------------------------------------------------------------------------------

test.describe('clique que leva a outro ponto da tela destaca o destino', () => {
  test('símbolo de um dia antigo: abre o mês, o dia e a linha; a linha acende, recebe o foco e o destaque some em cerca de 2 s', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const antigo = chavesDosCartoes[0]!;
    const alvo = linha(page, antigo);
    await expect(alvo).toBeHidden();

    await simbolo(quadro, antigo).click();

    await expect(alvo).toHaveClass(/carta-chegou/);
    const chegouEm = Date.now();
    await expect(alvo).toBeFocused();
    await expect(alvo).toBeVisible();
    await expect(alvo).toHaveAttribute('aria-expanded', 'true');
    const abertos = await alvo.evaluate(el => ({ mes: (el.closest('details.carta-mes') as HTMLDetailsElement | null)?.open, dia: (el.closest('details.feito-dia') as HTMLDetailsElement).open }));
    expect(abertos).toEqual({ mes: true, dia: true });
    await expect(alvo).not.toHaveClass(/carta-chegou/, { timeout: 4000 });
    expect(Date.now() - chegouEm, 'o destaque dura cerca de 2,2 s').toBeGreaterThan(1200);
    await expect(alvo).toHaveAttribute('aria-expanded', 'true');
  });

  test('símbolo de um dia recente (sem mês): abre só o dia e a linha', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const recente = chavesDosCartoes[7]!;
    const alvo = linha(page, recente);

    await simbolo(quadro, recente).click();

    await esperarChegada(alvo);
    await expect(alvo).toHaveAttribute('aria-expanded', 'true');
    expect(await alvo.evaluate(el => el.closest('details.carta-mes'))).toBeNull();
    expect(await alvo.evaluate(el => (el.closest('details.feito-dia') as HTMLDetailsElement).open)).toBe(true);
  });

  test('o símbolo de onde paramos leva à linha "Onde paramos", que já está aberta', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const agora = await quadro.locator('button.fio-agora').getAttribute('data-chave');

    await simbolo(quadro, agora!).click();

    await esperarChegada(page.locator('.feito-agora'));
    await expect(page.locator('.feito-agora')).toHaveAttribute('data-linha', agora!);
  });

  test('cada botão de "Daqui em diante" leva ao grupo certo, com destaque e foco', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const botoes = quadro.locator('button.fio-adiante-grupo[data-destino]');
    expect(await botoes.evaluateAll(els => els.map(el => el.getAttribute('data-destino')))).toEqual(['em_andamento', 'a_fazer', 'ideias']);

    for (const destino of ['em_andamento', 'a_fazer', 'ideias']) {
      await quadro.locator(`button.fio-adiante-grupo[data-destino="${destino}"]`).click();
      await esperarChegada(grupo(page, destino));
    }
  });

  test('cada atalho de grupo no alto de "O que falta" leva ao grupo certo, com destaque e foco', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    await abrirFio(page, projeto);
    const atalhos = page.locator('button.coluna-atalho[data-destino]');
    expect(await atalhos.evaluateAll(els => els.map(el => el.getAttribute('data-destino')))).toEqual(['em_andamento', 'a_fazer', 'ideias']);

    for (const destino of ['ideias', 'em_andamento', 'a_fazer']) {
      await page.locator(`button.coluna-atalho[data-destino="${destino}"]`).click();
      await esperarChegada(grupo(page, destino));
    }
  });

  test('na tela larga, com a coluna rolando por dentro, o atalho traz o último grupo para dentro da coluna', async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const { projeto } = await projetoGrande(request);
    await abrirFio(page, projeto);
    const coluna = page.locator('.carta-bloco-falta .coluna-rolagem');
    expect(await coluna.evaluate(el => el.scrollHeight - el.clientHeight), 'a coluna precisa rolar por dentro').toBeGreaterThan(100);
    expect(await coluna.evaluate(el => el.scrollTop)).toBe(0);

    await page.locator('button.coluna-atalho[data-destino="ideias"]').click();

    await expect(grupo(page, 'ideias')).toHaveClass(/carta-chegou/);
    await expect(grupo(page, 'ideias')).toBeFocused();
    await expect.poll(() => coluna.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    await expect.poll(async () => {
      const g = await caixa(grupo(page, 'ideias'));
      const c = await caixa(coluna);
      return g.y >= c.y - 1 && g.y + g.height <= c.y + c.height + 1;
    }).toBe(true);
  });

  test('na tela larga, o símbolo do fio leva a linha para a coluna e a deixa à vista', async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const { projeto, chavesDosCartoes } = await projetoGrande(request);
    const quadro = await abrirFio(page, projeto);

    await simbolo(quadro, chavesDosCartoes[0]!).click();

    const alvo = linha(page, chavesDosCartoes[0]!);
    await expect(alvo).toHaveClass(/carta-chegou/);
    await expect(alvo).toBeFocused();
    const coluna = page.locator('.carta-bloco-feito .coluna-rolagem');
    await expect.poll(async () => {
      const a = await caixa(alvo);
      const c = await caixa(coluna);
      return a.y >= c.y - 1 && a.y + a.height <= c.y + c.height + 1;
    }).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Ligação fio <-> lista e destaque de trilho
// ---------------------------------------------------------------------------------------------------------------

test.describe('ligação entre o fio e a lista', () => {
  test('passar o mouse num símbolo acende a linha dele na lista, e sair apaga', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const outras = page.locator('details.feito-dia[open] .feito-linha:not(.feito-agora)');
    const chave = (await outras.first().getAttribute('data-linha'))!;

    await simbolo(quadro, chave).hover();
    await expect(linha(page, chave)).toHaveClass(/feito-ligada/);
    const agora = (await quadro.locator('button.fio-agora').getAttribute('data-chave'))!;
    await simbolo(quadro, agora).hover();
    await expect(page.locator('.feito-agora')).toHaveClass(/feito-ligada/);
    await expect(linha(page, chave)).not.toHaveClass(/feito-ligada/);

    await page.mouse.move(5, 5);
    await expect(page.locator('.feito-ligada')).toHaveCount(0);
  });

  test('passar o mouse numa linha da lista acende o símbolo dela no fio, e sair apaga', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const outras = page.locator('details.feito-dia[open] .feito-linha:not(.feito-agora)');
    const chave = (await outras.first().getAttribute('data-linha'))!;

    await linha(page, chave).hover();
    await expect(simbolo(quadro, chave)).toHaveClass(/fio-ligado/);
    await expect(quadro.locator('.fio-ligado')).toHaveCount(1);

    await page.mouse.move(5, 5);
    await expect(quadro.locator('.fio-ligado')).toHaveCount(0);
  });

  test('focar uma linha da lista (teclado) acende o símbolo dela no fio, e sair apaga', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const chave = (await page.locator('details.feito-dia[open] .feito-linha:not(.feito-agora)').first().getAttribute('data-linha'))!;

    await linha(page, chave).focus();
    await expect(simbolo(quadro, chave)).toHaveClass(/fio-ligado/);
    await expect(quadro.locator('.fio-ligado')).toHaveCount(1);
    await page.locator('.feito-agora').focus();
    await expect(simbolo(quadro, chave)).not.toHaveClass(/fio-ligado/);
    await expect(quadro.locator('button.fio-agora')).toHaveClass(/fio-ligado/);

    await page.locator('.feito-agora').blur();
    await expect(quadro.locator('.fio-ligado')).toHaveCount(0);
  });

  test('passar o mouse no nome do trilho mostra os nomes declarados (e o aria-label continua)', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const claude = quadro.locator('.fio-nome').filter({ hasText: 'Claude' });
    const dica = () => claude.evaluate(el => getComputedStyle(el, '::after').content);
    expect(await dica()).toBe('none');

    await claude.hover();

    await expect.poll(dica).toBe('"Claude: 3 coisas. Nomes declarados: Claude Opus 5.5"');
    await expect(claude).toHaveAttribute('aria-label', 'Claude: 3 coisas. Nomes declarados: Claude Opus 5.5');
    await page.mouse.move(5, 5);
    await expect.poll(dica).toBe('none');
  });

  test('passar o mouse no nome de um trilho apaga os outros trilhos; sair devolve tudo', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const nomes = quadro.locator('.fio-nome');
    await expect(nomes).toHaveCount(3);
    expect(await nomes.evaluateAll(els => els.map(el => el.firstChild?.textContent))).toEqual(expect.arrayContaining(['Astra', 'Claude', 'Codex']));
    await expect(nomes.filter({ hasText: 'Claude' })).toHaveAttribute('aria-label', /^Claude: 3 coisas\. Nomes declarados: Claude Opus 5\.5$/);
    await expect(quadro).not.toHaveAttribute('data-trilho', /.*/);

    await nomes.first().hover();

    await expect(quadro).toHaveAttribute('data-trilho', '0');
    await expect(quadro.locator('.fio-c.fio-sel').first()).toBeVisible();
    const deOutroTrilho = quadro.locator('button.fio-simbolo:not(.fio-sel)').first();
    await expect.poll(() => deOutroTrilho.evaluate(el => parseFloat(getComputedStyle(el).opacity))).toBeLessThan(0.3);
    await expect(quadro.locator('.fio-nome.fio-sel')).toHaveCount(1);

    await page.mouse.move(5, 5);
    await expect(quadro).not.toHaveAttribute('data-trilho', /.*/);
    await expect.poll(() => deOutroTrilho.evaluate(el => parseFloat(getComputedStyle(el).opacity))).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Teclado
// ---------------------------------------------------------------------------------------------------------------

test.describe('teclado no fio', () => {
  const focado = (page: Page) => page.locator('button.fio-simbolo:focus');
  const posicao = (el: Locator) => el.evaluate(e => ({ left: parseFloat((e as HTMLElement).style.left), top: parseFloat((e as HTMLElement).style.top) }));

  test('o fio tem uma parada só de Tab: o ◉; o Tab seguinte sai dos símbolos e Shift+Tab volta ao mesmo', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const total = await quadro.locator('button.fio-simbolo').count();
    expect(total).toBeGreaterThan(8);
    await expect(quadro.locator('button.fio-simbolo[tabindex="0"]')).toHaveCount(1);
    await expect(quadro.locator('button.fio-simbolo[tabindex="-1"]')).toHaveCount(total - 1);
    await expect(quadro.locator('button.fio-simbolo[tabindex="0"]')).toHaveClass(/fio-agora/);

    // O nome do último trilho é a parada de antes (os nomes são botões e também recebem o foco).
    await quadro.locator('.fio-nome').last().focus();
    await page.keyboard.press('Tab');
    await expect(focado(page)).toHaveCount(1);
    await expect(focado(page)).toHaveClass(/fio-agora/);
    await page.keyboard.press('Tab');
    await expect(focado(page)).toHaveCount(0);
    await page.keyboard.press('Shift+Tab');
    await expect(focado(page)).toHaveClass(/fio-agora/);
  });

  test('setas, Home e End movem o foco entre os símbolos, em ordem de tempo e entre trilhos', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const agora = quadro.locator('button.fio-agora');
    await agora.focus();
    const fim = await posicao(agora);

    await page.keyboard.press('ArrowLeft');
    const aEsquerda = await posicao(focado(page));
    expect(aEsquerda.left, 'a seta para a esquerda vai ao símbolo anterior no tempo').toBeLessThan(fim.left);
    await page.keyboard.press('ArrowRight');
    await expect(focado(page)).toHaveClass(/fio-agora/);

    await page.keyboard.press('Home');
    const comeco = await posicao(focado(page));
    expect(comeco.left, 'Home vai ao primeiro símbolo').toBeLessThan(aEsquerda.left);
    const todos = await quadro.locator('button.fio-simbolo').evaluateAll(els => els.map(el => parseFloat((el as HTMLElement).style.left)));
    expect(comeco.left).toBe(Math.min(...todos));

    await page.keyboard.press('ArrowDown');
    expect((await posicao(focado(page))).top, 'a seta para baixo vai ao trilho de baixo').toBeGreaterThan(comeco.top);
    await page.keyboard.press('ArrowUp');
    expect((await posicao(focado(page))).top, 'a seta para cima volta ao trilho de cima').toBe(comeco.top);

    await page.keyboard.press('End');
    await expect(focado(page)).toHaveClass(/fio-agora/);
    // Nas pontas, o foco fica onde está.
    await page.keyboard.press('ArrowRight');
    await expect(focado(page)).toHaveClass(/fio-agora/);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    expect((await posicao(focado(page))).left).toBe(comeco.left);
  });

  test('a dica abre no foco do teclado e o Esc a fecha sem tirar o foco', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    await expect(quadro.locator('.fio-dica')).toHaveCount(0);

    await quadro.locator('button.fio-agora').focus();

    const dica = quadro.locator('.fio-dica[role="tooltip"]');
    await expect(dica).toBeVisible();
    await expect(dica.locator('.fio-dica-quando')).toContainText('onde paramos');
    await expect(dica.locator('.fio-dica-quem')).toHaveText('Codex');
    await page.keyboard.press('Escape');
    await expect(dica).toHaveCount(0);
    await expect(focado(page)).toHaveClass(/fio-agora/);
  });

  test('o Esc fecha a dica e apaga a linha acesa na lista', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    await quadro.locator('button.fio-agora').focus();
    await expect(page.locator('.feito-agora')).toHaveClass(/feito-ligada/);

    await page.keyboard.press('Escape');

    await expect(quadro.locator('.fio-dica')).toHaveCount(0);
    await expect(page.locator('.feito-ligada')).toHaveCount(0);
  });

  test('mudar a largura da janela não troca a coisa do foco nem a parada de Tab', async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const chave = chavesDosCartoes[3]!;
    await simbolo(quadro, chave).focus();
    await expect(quadro.locator('.fio-dica')).toHaveCount(1);
    const antes = await quadro.locator('button.fio-simbolo').evaluateAll(els => els.map(el => el.getAttribute('data-chave')));

    for (const largura of [1100, 1900]) {
      await page.setViewportSize({ width: largura, height: 900 });
      await expect.poll(() => quadro.locator('button.fio-simbolo[tabindex="0"]').getAttribute('data-chave')).toBe(chave);
      expect(await quadro.locator('button.fio-simbolo').evaluateAll(els => els.map(el => el.getAttribute('data-chave')))).toEqual(antes);
      await expect(simbolo(quadro, chave)).toBeFocused();
      await expect(quadro.locator('.fio-dica .fio-dica-texto')).toContainText('Pagamento por cartão');
    }
  });

  test('Enter num símbolo leva à linha dele com o destaque e o foco', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const chave = chavesDosCartoes[2]!;

    await simbolo(quadro, chave).focus();
    await page.keyboard.press('Enter');

    await esperarChegada(linha(page, chave));
    await expect(linha(page, chave)).toHaveAttribute('aria-expanded', 'true');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A lista "O que foi feito": abrir e fechar, estado que sobrevive à releitura, onde paramos
// ---------------------------------------------------------------------------------------------------------------

test.describe('lista por dia', () => {
  const aberto = (el: Locator) => el.evaluate(e => (e as HTMLDetailsElement).open);

  test('só o dia de onde paramos começa aberto; os outros dias e os meses começam recolhidos', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    await abrirCarta(page, projeto);

    const abertos = page.locator('details.feito-dia[open]');
    await expect(abertos).toHaveCount(1);
    await expect(abertos.locator('.feito-agora')).toHaveCount(1);
    expect(await page.locator('details.feito-dia').count()).toBeGreaterThan(5);
    await expect(page.locator('details.carta-mes[open]')).toHaveCount(0);
    expect(await page.locator('details.carta-mes').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('details.carta-mes > summary').first()).toHaveText(/ · \d+ itens?$/);
  });

  test('a linha "Onde paramos" mostra "A frase do alto da tela." quando repete a manchete, e a dica do fio traz o texto inteiro', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);

    await expect(page.locator('.carta-manchete')).toHaveText(FRASE_DO_ESTADO);
    const agora = page.locator('.feito-agora');
    await expect(agora.locator('.feito-selo')).toHaveText('Onde paramos');
    await expect(agora.locator('.feito-repetida')).toHaveText('A frase do alto da tela.');
    await expect(agora).not.toContainText(FRASE_DO_ESTADO);
    await expect(agora).toHaveAttribute('data-linha', /^registro:/);

    await quadro.locator('button.fio-agora').hover();
    await expect(quadro.locator('.fio-dica-texto')).toHaveText(FRASE_DO_ESTADO);
  });

  test('quando o texto de onde paramos é diferente da manchete, a linha mostra o texto inteiro', async ({ page, request }) => {
    const projeto = await criarProjeto(request, nomeUnico('Projeto sem repetição'));
    await registrar(request, projeto.id, 'Claude', 'A vitrine está no ar e já recebe pedidos.', `sem-repeticao-${projeto.id}`);
    await criarCartao(request, projeto.id, 'Domínio próprio: o endereço novo já aponta para a vitrine.', 'done', 'Codex');
    await abrirCarta(page, projeto);

    const agora = page.locator('.feito-agora');
    await expect(page.locator('.carta-manchete')).toHaveText('A vitrine está no ar e já recebe pedidos.');
    await expect(agora).toContainText('Domínio próprio: o endereço novo já aponta para a vitrine.');
    await expect(agora.locator('.feito-repetida')).toHaveCount(0);
  });

  test('abrir e fechar um dia: com o clique, com Enter e com Espaço', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    await abrirCarta(page, projeto);
    const dia = page.locator('details.feito-dia', { has: linha(page, chavesDosCartoes[8]!) });
    const resumo = dia.locator('> summary');
    expect(await aberto(dia)).toBe(false);

    await resumo.click();
    expect(await aberto(dia)).toBe(true);
    await expect(linha(page, chavesDosCartoes[8]!)).toBeVisible();
    await resumo.click();
    expect(await aberto(dia)).toBe(false);

    await resumo.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => aberto(dia)).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => aberto(dia)).toBe(false);
    await page.keyboard.press('Space');
    await expect.poll(() => aberto(dia)).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => aberto(dia)).toBe(false);
  });

  test('o dia fechado resume o dia em uma linha: data, dia da semana, a primeira afirmação do item mais recente e "N coisas · Família"', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    await abrirCarta(page, projeto);
    const dia = page.locator('details.feito-dia', { has: linha(page, chavesDosCartoes[1]!) });

    await expect(dia).toHaveJSProperty('open', false);
    await expect(dia.locator('.feito-data')).toHaveText(/^\d{1,2} \p{L}{3}\p{L}*\.?\s*\p{L}+/u);
    // O item mais recente do dia é o das 12h30, "Cadastro de alunos:" (sem os dois pontos no fim).
    await expect(dia.locator('.feito-fecho')).toHaveText('Cadastro de alunos');
    await expect(dia.locator('.feito-quem')).toHaveText('2 coisas · Astra');
  });

  test('abrir e fechar um mês, com o clique e com o teclado', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    await abrirCarta(page, projeto);
    const mes = page.locator('details.carta-mes').first();
    const resumo = mes.locator('> summary');
    expect(await aberto(mes)).toBe(false);

    await resumo.click();
    expect(await aberto(mes)).toBe(true);
    await expect(mes.locator('details.feito-dia').first()).toBeVisible();
    await resumo.click();
    expect(await aberto(mes)).toBe(false);

    await resumo.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => aberto(mes)).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => aberto(mes)).toBe(false);
  });

  test('abrir e fechar uma linha: com o clique, com Enter e com Espaço; aberta, mostra o tipo e quem fez', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    // O dia de onde paramos tem outras linhas, já visíveis.
    const alvo = page.locator('details.feito-dia[open] .feito-linha:not(.feito-agora)').first();
    await expect(alvo).toHaveAttribute('role', 'button');
    await expect(alvo).toHaveAttribute('tabindex', '0');
    await expect(alvo).toHaveAttribute('aria-expanded', 'false');
    await expect(alvo.locator('.feito-assina')).toHaveCount(0);

    await alvo.click();
    await expect(alvo).toHaveAttribute('aria-expanded', 'true');
    // Dia com duas famílias (Astra e Codex): cada linha diz quem fez.
    // A linha aberta diz sempre o tipo e a família (aqui, entrega da Codex ou cartão da Astra).
    await expect(alvo.locator('.feito-assina')).toHaveText(/^(Entrega|Cartão concluído) · (Astra|Codex)$/);
    await alvo.click();
    await expect(alvo).toHaveAttribute('aria-expanded', 'false');

    await alvo.focus();
    await page.keyboard.press('Enter');
    await expect(alvo).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(alvo).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(alvo).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(alvo).toHaveAttribute('aria-expanded', 'false');
    // Abrir a linha pelo teclado não leva a tela para outro lugar nem acende o destaque de chegada.
    await expect(alvo).not.toHaveClass(/carta-chegou/);
    expect(chavesDosCartoes.length).toBeGreaterThan(0);
    await expect(quadro).toBeVisible();
  });

  test('a linha "Onde paramos" não recolhe: clicar nela não fecha nada', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    await abrirCarta(page, projeto);
    const agora = page.locator('.feito-agora');

    await agora.click();

    await expect(agora).toBeVisible();
    await expect(agora.locator('.feito-repetida')).toBeVisible();
    await expect(agora).not.toHaveAttribute('aria-expanded', /.*/);
  });

  test('o que foi aberto continua aberto quando a carta é relida, e a abertura do fio não se repete', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    const recente = chavesDosCartoes[7]!;
    const antigo = chavesDosCartoes[0]!;
    // Abre um dia recente com a linha dele, e um mês antigo com o dia e a linha.
    await simbolo(quadro, recente).click();
    await esperarChegada(linha(page, recente));
    await simbolo(quadro, antigo).click();
    await esperarChegada(linha(page, antigo));
    const contaAntes = await page.locator('.carta-bloco-feito .coluna-conta').textContent();
    const simbolosAntes = await quadro.locator('button.fio-simbolo').count();

    // O projeto muda por fora (um registro novo) e a tela o lê de novo pelo botão de atualizar.
    await registrar(request, projeto.id, 'Codex', 'Relatório semanal enviado ao professor.', `releitura-${projeto.id}`);
    await page.getByRole('button', { name: 'Atualizar projeto' }).click();
    await expect(page.locator('.carta-bloco-feito .coluna-conta')).not.toHaveText(contaAntes!);

    await expect(linha(page, recente)).toBeVisible();
    await expect(linha(page, recente)).toHaveAttribute('aria-expanded', 'true');
    await expect(linha(page, antigo)).toBeVisible();
    await expect(linha(page, antigo)).toHaveAttribute('aria-expanded', 'true');
    expect(await linha(page, antigo).evaluate(el => (el.closest('details.carta-mes') as HTMLDetailsElement).open)).toBe(true);
    // O símbolo novo chegou ao fio, mas o fio não se escreve de novo.
    await expect(quadro.locator('button.fio-simbolo')).toHaveCount(simbolosAntes + 1);
    await expect(quadro).not.toHaveClass(/fio-abrindo/);
    await expect(page.locator('.fio-faisca')).toHaveCount(0);
  });
});

test.describe('releitura com dia novo', () => {
  test('quando a coisa mais nova cai num dia novo, o dia dela abre sozinho e o que o dono abriu continua aberto', async ({ page, request }) => {
    // Só cartões antigos: o último dia é o de 3 dias atrás. Hoje não há nada.
    const projeto = await criarProjeto(request, nomeUnico('Projeto de dia novo'));
    const ids = await concluirNoPassado(request, projeto.id, [
      { texto: 'Cadastro de alunos: criar conta e entrar funcionam.', quem: 'Astra', dias: 5 },
      { texto: 'Painel do professor: alunos, notas e pedidos numa tela.', quem: 'Astra', dias: 3 },
    ]);
    await abrirFio(page, projeto);
    const diaAntigo = page.locator('details.feito-dia', { has: linha(page, `cartao:${ids[0]}`) });
    const diaDeOntem = page.locator('details.feito-dia', { has: linha(page, `cartao:${ids[1]}`) });
    const aberto = (el: Locator) => el.evaluate(e => (e as HTMLDetailsElement).open);
    expect(await aberto(diaDeOntem), 'o último dia começa aberto').toBe(true);
    await diaAntigo.locator('> summary').click();
    expect(await aberto(diaAntigo)).toBe(true);

    // Um registro de hoje: a coisa mais nova passa a ser de um dia que a tela ainda não tinha.
    await registrar(request, projeto.id, 'Codex', 'Relatório semanal enviado ao professor.', `dia-novo-${projeto.id}`);
    await page.getByRole('button', { name: 'Atualizar projeto' }).click();

    const registroDeHoje = page.locator('.feito-agora');
    await expect(registroDeHoje).toBeVisible();
    const diaDeHoje = page.locator('details.feito-dia', { has: registroDeHoje });
    expect(await aberto(diaDeHoje), 'o dia novo abre').toBe(true);
    expect(await aberto(diaAntigo), 'o que o dono abriu continua aberto').toBe(true);
    expect(await aberto(diaDeOntem), 'o dia que já estava aberto continua aberto').toBe(true);
  });
});


test.describe('detalhes das colunas e do fio', () => {
  test('com um grupo só, o atalho dele aparece e leva ao grupo', async ({ page, request }) => {
    const projeto = await criarProjeto(request, nomeUnico('Projeto de um grupo'));
    await concluirNoPassado(request, projeto.id, [{ texto: 'Cadastro de alunos: criar conta e entrar funcionam.', quem: 'Astra', dias: 2 }]);
    await criarCartao(request, projeto.id, 'Escolher o domínio', 'pending');
    await abrirFio(page, projeto);

    const atalho = page.locator('button.coluna-atalho[data-destino]');
    await expect(atalho).toHaveCount(1);
    await atalho.click();

    await esperarChegada(grupo(page, (await atalho.getAttribute('data-destino'))!));
  });

  test('a coluna que rola por dentro é uma região com nome e entra no Tab; a que cabe inteira não', async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const { projeto } = await projetoGrande(request);
    await abrirFio(page, projeto);

    const falta = page.locator('.carta-bloco-falta .coluna-rolagem');
    await expect(falta).toHaveAttribute('role', 'region');
    await expect(falta).toHaveAttribute('aria-label', 'O que falta');
    await expect(falta).toHaveAttribute('tabindex', '0');
    await falta.focus();
    await expect(falta).toBeFocused();
    const feito = page.locator('.carta-bloco-feito .coluna-rolagem');
    await expect(feito).not.toHaveAttribute('role', /.*/);
    await expect(feito).not.toHaveAttribute('tabindex', /.*/);
  });

  test('a guia vertical também fica sob o primeiro símbolo do último dia', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    const quadro = await abrirFio(page, projeto);
    // O primeiro símbolo de hoje é a "Revisão de textos" (o último cartão dado); o ◉ vem depois dele.
    const primeiro = simbolo(quadro, chavesDosCartoes[9]!);
    const medida = await primeiro.evaluate(el => ({ esquerda: parseFloat((el as HTMLElement).style.left), casa: parseFloat((el as HTMLElement).style.width) }));
    const guias = await quadro.locator('.fio-guia').evaluateAll(els => els.map(el => parseFloat((el as HTMLElement).style.left)));
    expect(guias.some(g => Math.abs(g - (medida.esquerda + medida.casa / 2)) < 0.01), `guias ${guias.join(', ')}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Duas colunas: pé da rolagem e alturas
// ---------------------------------------------------------------------------------------------------------------

test.describe('colunas com rolagem por dentro', () => {
  test('"Role para ver o resto" vira "Fim da lista" ao rolar a coluna até o fim (1920 px); a coluna que cabe inteira não diz nada', async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const { projeto } = await projetoGrande(request);
    await abrirFio(page, projeto);
    const falta = page.locator('.carta-bloco-falta');
    const rolagem = falta.locator('.coluna-rolagem');
    const pe = falta.locator('.coluna-pe');
    const peDoFeito = page.locator('.carta-bloco-feito .coluna-pe');

    await expect(pe).toHaveText('Role para ver o resto');
    await expect(rolagem).toHaveClass(/coluna-tem-mais/);
    // O feito cabe inteiro: o pé fica vazio e a rolagem não pede degradê.
    await expect(peDoFeito).toHaveText('');
    await expect(page.locator('.carta-bloco-feito .coluna-rolagem')).toHaveClass(/coluna-cabe/);

    await rolagem.evaluate(el => el.scrollTo({ top: el.scrollHeight }));
    await expect(pe).toHaveText('Fim da lista');
    await expect(rolagem).toHaveClass(/coluna-fim/);
    await rolagem.evaluate(el => el.scrollTo({ top: 0 }));
    await expect(pe).toHaveText('Role para ver o resto');
  });

  test('o pé se mede de novo quando o conteúdo muda: abrir um dia comprido faz aparecer "Role para ver o resto", e fechar o apaga', async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const { projeto } = await projetoComFio(request);
    const ids = await concluirNoPassado(request, projeto.id, Array.from({ length: 30 }, (_, i) => ({ texto: `Passo ${i + 1} da semana: mais uma entrega pequena.`, quem: 'Astra', dias: 3, minutos: i })));
    await abrirFio(page, projeto);
    const feito = page.locator('.carta-bloco-feito');
    await expect(feito.locator('.coluna-pe')).toHaveText('');
    const resumo = feito.locator('details.feito-dia', { has: linha(page, `cartao:${ids[0]}`) }).locator('> summary');

    await resumo.click();
    await expect(feito.locator('.coluna-pe')).toHaveText('Role para ver o resto');

    await resumo.click();
    await expect(feito.locator('.coluna-pe')).toHaveText('');
  });

  for (const tela of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    test(`as duas colunas têm a mesma altura em ${tela.width}x${tela.height}, lado a lado, com a rolagem por dentro e sem passar da janela`, async ({ page, request }) => {
      await page.setViewportSize(tela);
      const { projeto } = await projetoGrande(request);
      await abrirFio(page, projeto);
      const feito = await caixa(page.locator('.carta-bloco-feito'));
      const falta = await caixa(page.locator('.carta-bloco-falta'));

      expect(falta.x, 'lado a lado').toBeGreaterThan(feito.x + feito.width - 1);
      expect(Math.abs(falta.y - feito.y), 'mesmo topo').toBeLessThan(2);
      expect(Math.abs(falta.height - feito.height), 'mesma altura').toBeLessThan(2);
      expect(feito.height, 'cada coluna tem no máximo uma tela de altura').toBeLessThanOrEqual(tela.height);
      for (const coluna of ['.carta-bloco-feito', '.carta-bloco-falta']) {
        const interna = page.locator(`${coluna} .coluna-rolagem`);
        expect(await interna.evaluate(el => getComputedStyle(el).overflowY), `${coluna} rola por dentro`).toMatch(/auto|scroll/);
        expect(await interna.evaluate(el => getComputedStyle(el).overscrollBehaviorY), `${coluna} não passa a rolagem para a página`).toBe('contain');
      }
      expect(await page.locator('.carta-bloco-falta .coluna-rolagem').evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
    });
  }

  test('em 1440 px as colunas ficam uma embaixo da outra, sem rolagem interna', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { projeto } = await projetoGrande(request);
    await abrirFio(page, projeto);
    const feito = await caixa(page.locator('.carta-bloco-feito'));
    const falta = await caixa(page.locator('.carta-bloco-falta'));

    expect(falta.y, 'o que falta vem abaixo').toBeGreaterThan(feito.y + feito.height - 1);
    for (const coluna of ['.carta-bloco-feito', '.carta-bloco-falta']) {
      const interna = page.locator(`${coluna} .coluna-rolagem`);
      expect(await interna.evaluate(el => el.scrollHeight - el.clientHeight), `${coluna}: nada fica escondido`).toBeLessThanOrEqual(1);
      await expect(page.locator(`${coluna} .coluna-pe`)).toHaveText('');
    }
    expect((await caixa(page.locator('.carta-bloco-falta'))).height, 'a coluna cresce com o conteúdo').toBeGreaterThan(900);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// "O que falta": corte em 240, etapa só em andamento
// ---------------------------------------------------------------------------------------------------------------

test('"Ver tudo/Ver menos" só aparece quando o texto passa de 240 caracteres, e a etapa só aparece em "Em andamento"', async ({ page, request }) => {
  const projeto = await criarProjeto(request, nomeUnico('Projeto cortes'));
  await criarCartao(request, projeto.id, 'Cabe inteiro', 'pending', 'Claude', 'a'.repeat(240));
  await criarCartao(request, projeto.id, 'Passa por um', 'pending', 'Claude', 'b'.repeat(241));
  await criarCartao(request, projeto.id, 'Em teste agora', 'testing', 'Claude', 'curto');
  await abrirCarta(page, projeto);
  const aFazer = grupo(page, 'a_fazer');

  await expect(aFazer.locator('.carta-ver-mais')).toHaveCount(1);
  await expect(aFazer.getByText('a'.repeat(240), { exact: true })).toBeVisible();
  await expect(aFazer.getByText('b'.repeat(241), { exact: true })).toHaveCount(0);
  const botao = aFazer.getByRole('button', { name: 'Ver tudo' });
  await expect(botao).toHaveAttribute('aria-expanded', 'false');

  await botao.click();

  await expect(aFazer.getByText('b'.repeat(241), { exact: true })).toBeVisible();
  await expect(aFazer.getByRole('button', { name: 'Ver menos' })).toHaveAttribute('aria-expanded', 'true');
  await aFazer.getByRole('button', { name: 'Ver menos' }).click();
  await expect(aFazer.getByText('b'.repeat(241), { exact: true })).toHaveCount(0);

  await expect(grupo(page, 'em_andamento').locator('.carta-etapa')).toHaveText('Em teste');
  await expect(aFazer.locator('.carta-etapa')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------
// Movimento reduzido
// ---------------------------------------------------------------------------------------------------------------

test.describe('com movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('o fio aparece pronto: sem faísca, sem anéis girando; e o destino do clique fica com contorno em vez de animação', async ({ page, request }) => {
    const { projeto, chavesDosCartoes } = await projetoComFio(request);
    await abrirCarta(page, projeto);
    const quadro = page.locator('.fio-quadro');
    await expect(quadro.locator('button.fio-simbolo').first()).toBeVisible();
    const agora = quadro.locator('button.fio-agora');

    // Nada se move: a faísca fica escondida, e os anéis e a escrita não têm animação.
    expect(await page.locator('.fio-faisca').evaluateAll(els => els.every(el => getComputedStyle(el).display === 'none'))).toBe(true);
    for (const pseudo of ['::before', '::after']) {
      expect(await agora.evaluate((el, p) => getComputedStyle(el, p).animationName, pseudo)).toBe('none');
    }
    expect(await quadro.locator('.fio-c').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');

    await simbolo(quadro, chavesDosCartoes[8]!).click();

    const alvo = linha(page, chavesDosCartoes[8]!);
    await expect(alvo).toHaveClass(/carta-chegou/);
    await expect(alvo).toBeFocused();
    const estilo = await alvo.evaluate(el => { const s = getComputedStyle(el); return { animacao: s.animationName, contorno: s.outlineStyle, largura: parseFloat(s.outlineWidth) }; });
    expect(estilo.animacao, 'sem animação').toBe('none');
    expect(estilo.contorno, 'o destino fica marcado por um contorno').not.toBe('none');
    expect(estilo.largura).toBeGreaterThanOrEqual(2);
    const chegouEm = Date.now();
    await expect(alvo).not.toHaveClass(/carta-chegou/, { timeout: 4000 });
    expect(Date.now() - chegouEm, 'o contorno dura cerca de 2 s').toBeGreaterThan(900);
  });

  test('o grupo alcançado por "Daqui em diante" também fica com contorno', async ({ page, request }) => {
    const { projeto } = await projetoComFio(request);
    await abrirFio(page, projeto);

    await page.locator('button.fio-adiante-grupo[data-destino="a_fazer"]').click();

    const alvo = grupo(page, 'a_fazer');
    await expect(alvo).toHaveClass(/carta-chegou/);
    expect(await alvo.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    expect(await alvo.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Estados do fio
// ---------------------------------------------------------------------------------------------------------------

test.describe('estados do fio', () => {
  test('projeto vazio: só o título e a frase "Nada feito ainda: o fio começa no primeiro registro"', async ({ page, request }) => {
    const projeto = await criarProjeto(request, nomeUnico('Projeto vazio'));
    await abrirCarta(page, projeto);

    const quadro = page.locator('.fio-quadro');
    await expect(quadro).toHaveClass(/fio-vazio/);
    await expect(quadro.locator('.fio-titulo')).toHaveText('O fio do projeto');
    await expect(quadro.locator('.fio-resumo')).toHaveText('Nada feito ainda: o fio começa no primeiro registro');
    await expect(quadro.locator('.fio-grade, .fio-regua, .fio-nomes, .fio-adiante, button')).toHaveCount(0);
  });

  test('uma coisa só: o começo do fio, uma casa e o ◉', async ({ page, request }) => {
    const projeto = await criarProjeto(request, nomeUnico('Projeto de uma coisa'));
    await criarCartao(request, projeto.id, 'Primeira entrega: a vitrine abre.', 'done', 'Astra');
    const quadro = await abrirFio(page, projeto);

    await expect(quadro.locator('.fio-resumo')).toHaveText('1 coisa feita em 1 dia de trabalho. Sempre com a mesma IA.');
    await expect(quadro.locator('button.fio-simbolo')).toHaveCount(1);
    await expect(quadro.locator('button.fio-agora')).toHaveText('◉');
    await expect(quadro.locator('.fio-nome')).toHaveCount(1);
    const primeiraLinha = await quadro.locator('.fio-c').evaluateAll(els => els
      .filter(el => parseFloat((el as HTMLElement).style.top) === 0 && !el.classList.contains('fio-aberto'))
      .sort((a, b) => parseFloat((a as HTMLElement).style.left) - parseFloat((b as HTMLElement).style.left))
      .map(el => el.textContent).join(''));
    expect(primeiraLinha).toBe('├─◉');
    await expect(quadro.locator('.fio-aberto')).toHaveCount(1);
  });

  test('mais de 6 IAs: o sexto trilho vira "Outras IAs" e a frase conta todas', async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const projeto = await projetoDenso(request);
    const quadro = await abrirFio(page, projeto);

    await expect(quadro.locator('.fio-nome')).toHaveCount(6);
    await expect(quadro.locator('.fio-nome').last()).toContainText('Outras IAs');
    await expect(quadro.locator('.fio-resumo')).toContainText('Passou por 7 IAs.');
    await expect(quadro.locator('.fio-nome').last()).toHaveAttribute('aria-label', /^Outras IAs: 2 coisas\. Nomes declarados: /);
  });

  test('em tela estreita, o dia cheio é comprimido em "+N" e a página não ganha rolagem lateral', async ({ page, request }) => {
    const projeto = await projetoDenso(request, 7);
    await page.setViewportSize({ width: 700, height: 900 });
    const quadro = await abrirFio(page, projeto);

    // 30 coisas da mesma IA no mesmo dia, sem espaço: o fio mostra 10 e um "+N".
    const mais = quadro.locator('.fio-mais');
    // Cada caractere do "+N" é uma casa do fio, lida da esquerda para a direita.
    await expect(mais.first()).toBeVisible();
    const texto = await mais.evaluateAll(els => els.sort((x, y) => parseFloat((x as HTMLElement).style.left) - parseFloat((y as HTMLElement).style.left)).map(el => el.textContent).join(''));
    expect(texto).toMatch(/^\+\d+$/);
    expect(await quadro.locator('.fio-grade').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect((await caixa(quadro)).width).toBeLessThanOrEqual(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Nenhum símbolo passa da borda do quadro
// ---------------------------------------------------------------------------------------------------------------

test.describe('o fio cabe no quadro', () => {
  for (const tela of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    for (const [nome, montar] of [
      ['o projeto de referência', async (request: APIRequestContext) => (await projetoComFio(request)).projeto],
      ['o projeto denso (7 IAs, vãos longos e um dia cheio)', (request: APIRequestContext) => projetoDenso(request, 7)],
    ] as const) {
      test(`em ${tela.width} px, nenhuma casa do fio passa da borda do quadro (${nome})`, async ({ page, request }) => {
        await page.setViewportSize(tela);
        const projeto = await montar(request);
        const quadro = await abrirFio(page, projeto);

        const medida = await quadro.evaluate(el => {
          const q = el.getBoundingClientRect();
          const g = el.querySelector('.fio-grade')!.getBoundingClientRect();
          const casas = [...el.querySelectorAll('.fio-c, .fio-pauta, .fio-regua > *')].map(c => c.getBoundingClientRect()).filter(r => r.width > 0);
          return {
            casas: casas.length,
            sobraNaDireita: Math.max(...casas.map(r => r.right - q.right)),
            sobraNaEsquerda: Math.max(...casas.map(r => q.left - r.left)),
            sobraDaGrade: Math.max(...[...el.querySelectorAll('.fio-c')].map(c => c.getBoundingClientRect().right - g.right)),
            larguraDaGrade: g.width,
            rolagemLateral: (el.querySelector('.fio-palco') as HTMLElement).scrollWidth - (el.querySelector('.fio-palco') as HTMLElement).clientWidth,
          };
        });

        expect(medida.casas).toBeGreaterThan(20);
        expect(medida.sobraNaDireita, 'passou da borda direita do quadro').toBeLessThanOrEqual(0.5);
        expect(medida.sobraNaEsquerda, 'passou da borda esquerda do quadro').toBeLessThanOrEqual(0.5);
        expect(medida.sobraDaGrade, 'passou da borda da grade').toBeLessThanOrEqual(0.5);
        expect(medida.rolagemLateral, 'o fio rola para o lado').toBeLessThanOrEqual(1);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Legibilidade: 11 px e contraste 4,5:1, com tudo aberto e a dica à mostra
// ---------------------------------------------------------------------------------------------------------------

test.describe('legibilidade', () => {
  test('a aba "Onde paramos" nova (fio, dica, lista aberta, atalhos e pé) não tem texto pequeno nem de pouco contraste', async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const { projeto } = await projetoGrande(request);
    const quadro = await abrirFio(page, projeto);
    // Abre tudo o que nasce recolhido: o que está escondido também precisa ser legível.
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
    await page.locator('details.feito-dia[open] .feito-linha:not(.feito-agora)').first().click();
    await quadro.locator('button.fio-agora').hover();
    await expect(quadro.locator('.fio-dica')).toBeVisible();
    await expect(page.locator('.carta-bloco-falta .coluna-pe')).toHaveText('Role para ver o resto');
    await page.waitForTimeout(500);

    const medida = await page.evaluate(medirLegibilidade);

    expect(medida.totalTextos).toBeGreaterThan(40);
    expect(medida.falhasTamanho, 'textos abaixo do tamanho mínimo').toEqual([]);
    expect(medida.falhasContraste, 'textos com contraste insuficiente').toEqual([]);
  });

  test('a lista de projetos, com a miniatura do fio, não tem texto pequeno nem de pouco contraste', async ({ page, request }) => {
    await projetoComFio(request, nomeUnico('Projeto da miniatura'));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/#projects');
    const minis = page.locator('.library-project .fio-mini');
    await expect(minis.first()).toBeVisible();
    // A miniatura usa letra de pelo menos 11 px e o tom claro da casa.
    expect(await minis.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(11);
    await expect(page.locator('.tear-quando', { hasText: 'lendo…' })).toHaveCount(0);
    await page.waitForTimeout(500);

    const medida = await page.evaluate(medirLegibilidade);

    expect(medida.totalTextos).toBeGreaterThan(10);
    expect(medida.falhasTamanho, 'textos abaixo do tamanho mínimo').toEqual([]);
    expect(medida.falhasContraste, 'textos com contraste insuficiente').toEqual([]);
  });
});
