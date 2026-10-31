import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const HEADERS = { 'X-Workspace-Client': 'local' };

interface FalhaMedicao {
  tela: string;
  texto: string;
  px: number;
  ratio: number;
  cor: string;
  classe: string;
  motivo: string;
}

function medirLegibilidade() {
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (c: { r: number; g: number; b: number }) =>
    0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);

  const fundo = (el: Element) => {
    const camadas = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        camadas.push(c);
        if (c.a >= 1) break;
      }
    }
    // O canvas base do app é escuro: #141415 (rgb 20, 20, 21)
    let base = { r: 20, g: 20, b: 21 };
    for (const c of camadas.reverse()) {
      base = {
        r: c.r * c.a + base.r * (1 - c.a),
        g: c.g * c.a + base.g * (1 - c.a),
        b: c.b * c.a + base.b * (1 - c.a),
      };
    }
    return base;
  };

  const falhasTamanho: Array<{ texto: string; px: number; classe: string; motivo: string }> = [];
  const falhasContraste: Array<{ texto: string; px: number; ratio: number; cor: string; classe: string; motivo: string }> = [];
  let totalTextos = 0;

  for (const el of document.querySelectorAll('body *')) {
    const texto = [...el.childNodes]
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent?.trim() ?? '')
      .join(' ')
      .trim();
    if (!texto) continue;

    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;

    const px = parseFloat(cs.fontSize);
    const tag = el.tagName.toLowerCase();
    const classe = (el.className && typeof el.className === 'string' && el.className.trim())
      ? el.className.trim().split(/\s+/).join('.')
      : (el.parentElement?.className && typeof el.parentElement.className === 'string' && el.parentElement.className.trim()
        ? el.parentElement.className.trim().split(/\s+/).join('.') + ' > ' + tag
        : tag);

    // Regra 1 de tamanho: nenhum texto visível abaixo de 11 px
    if (px < 10.9) {
      falhasTamanho.push({
        texto: texto.slice(0, 48),
        px: Math.round(px * 10) / 10,
        classe,
        motivo: `Texto abaixo de 11 px (${Math.round(px * 10) / 10} px)`,
      });
    }

    // Regra 2 de tamanho: texto de leitura (frases, descrições, itens de lista) com pelo menos 12 px
    const isTextoLeitura = tag === 'p' || tag === 'li' || el.classList.contains('subtle-text') || el.classList.contains('task-description-snippet') || el.classList.contains('resumo-sub');
    if (isTextoLeitura && px < 11.9) {
      falhasTamanho.push({
        texto: texto.slice(0, 48),
        px: Math.round(px * 10) / 10,
        classe,
        motivo: `Texto de leitura abaixo de 12 px (${Math.round(px * 10) / 10} px)`,
      });
    }

    // Regra de contraste: pelo menos 4.5:1 (ou 3:1 para grande >= 24px ou bold >= 18.66px), exceto desativados
    const desativado = el.closest('button:disabled, [aria-disabled="true"], input:disabled, textarea:disabled, select:disabled');
    const cor = parse(cs.color);
    if (cor) {
      const bg = fundo(el);
      const fg = {
        r: cor.r * cor.a + bg.r * (1 - cor.a),
        g: cor.g * cor.a + bg.g * (1 - cor.a),
        b: cor.b * cor.a + bg.b * (1 - cor.a),
      };
      const L1 = lum(fg);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);

      const bold = parseInt(cs.fontWeight) >= 700;
      const grande = px >= 24 || (bold && px >= 18.66);
      const minimo = grande ? 3.0 : 4.5;

      totalTextos++;

      if (ratio < minimo && !desativado) {
        falhasContraste.push({
          texto: texto.slice(0, 48),
          px: Math.round(px),
          ratio: Math.round(ratio * 100) / 100,
          cor: cs.color,
          classe,
          motivo: `Contraste ${Math.round(ratio * 100) / 100}:1 abaixo do mínimo ${minimo}:1`,
        });
      }
    }
  }

  return { totalTextos, falhasTamanho, falhasContraste };
}

async function prepararDadosCompletos(request: APIRequestContext) {
  const tempWorkspace = mkdtempSync(path.join(tmpdir(), 'axon-legibilidade-'));
  const relativeFile = 'src/service.ts';
  const fullFilePath = path.join(tempWorkspace, relativeFile);
  mkdirSync(path.dirname(fullFilePath), { recursive: true });
  writeFileSync(fullFilePath, 'export const version = 1;\n');
  const initialSha = createHash('sha256').update('export const version = 1;\n').digest('hex');

  // Cria projeto real vinculado ao workspace temporário
  const pRes = await request.post('/api/projects', {
    headers: HEADERS,
    data: {
      name: 'Projeto Auditoria Legibilidade',
      objective: 'Validar permanentemente tamanho de letra e contraste WCAG em todas as telas.',
      workspacePath: tempWorkspace,
    },
  });
  expect(pRes.ok()).toBeTruthy();
  const project = await pRes.json();

  // Tarefa 1 com prioridade urgente (concluída)
  const t1Res = await request.post(`/api/projects/${project.id}/tasks`, {
    headers: HEADERS,
    data: { title: 'Implementar auditoria visual' },
  });
  const t1 = await t1Res.json();
  const t1ContractRes = await request.post(`/api/projects/${project.id}/tasks/${t1.id}/contract`, {
    headers: HEADERS,
    data: {
      expectedVersion: t1.version,
      priority: 'urgent',
      description: 'Garantir que toda a tipografia atenda aos requisitos mínimos de legibilidade.',
      acceptanceCriteria: [
        { description: 'Fontes >= 11px em todos os componentes', completed: true },
        { description: 'Contraste >= 4.5:1 confirmado', completed: true },
      ],
      expectedOutputs: [
        { kind: 'file_path', title: 'Relatório de conformidade', locator: 'docs/reports/audit.md' },
      ],
    },
  });
  const t1Fresh = await t1ContractRes.json();

  await request.post(`/api/projects/${project.id}/tasks/${t1.id}/claim`, {
    headers: HEADERS,
    data: { agent: 'Astra', expectedVersion: t1Fresh.version },
  });

  // Finaliza t1 gravando checkpoint com evidência de artefato real
  await request.post(`/api/projects/${project.id}/finalize`, {
    headers: HEADERS,
    data: {
      agent: 'Astra',
      expectedRevision: 0,
      idempotencyKey: 'legibilidade-cp-1',
      summary: 'Auditoria visual implementada e validada.',
      humanSummary: 'A auditoria visual agora protege toda a tipografia e contraste.',
      nextStep: 'Conferir os resultados em todas as telas.',
      taskId: t1.id,
      taskTransition: { kind: 'declare_done' },
      decisions: ['Manter tipografia mínima de 11px em toda a interface.'],
      blockers: [],
      evidence: [
        {
          command: 'npm test',
          outcome: 'passed',
          details: '100% verde na suíte de testes.',
          artifacts: [
            {
              path: relativeFile,
              sha256: initialSha,
            },
          ],
        },
      ],
    },
  });

  // Modifica o arquivo no disco de verdade para forçar a evidência a se tornar stale
  writeFileSync(fullFilePath, 'export const version = 2; // modificado para desatualizar\n');

  // Registra conferência cruzada por outra IA na evidência gerada
  const evRes = await request.get(`/api/projects/${project.id}/evidence`);
  const evList = await evRes.json();
  if (evList.length > 0) {
    await request.post(`/api/projects/${project.id}/evidence/${evList[0].id}/cross-check`, {
      headers: HEADERS,
      data: {
        verifiedBy: 'Grok',
        note: 'Conferi a execução independente e os arquivos bateram.',
      },
    });
  }

  // Tarefa 2 com prioridade alta (em andamento)
  const t2Res = await request.post(`/api/projects/${project.id}/tasks`, {
    headers: HEADERS,
    data: { title: 'Revisar contraste da aba Relações' },
  });
  const t2 = await t2Res.json();
  const t2ContractRes = await request.post(`/api/projects/${project.id}/tasks/${t2.id}/contract`, {
    headers: HEADERS,
    data: {
      expectedVersion: t2.version,
      priority: 'high',
      description: 'Ajustar cores secundárias para cumprir contraste WCAG AA.',
    },
  });
  const t2Fresh = await t2ContractRes.json();
  await request.post(`/api/projects/${project.id}/tasks/${t2.id}/claim`, {
    headers: HEADERS,
    data: { agent: 'Grok', expectedVersion: t2Fresh.version },
  });

  // Bloqueio aberto
  await request.post(`/api/projects/${project.id}/blockers`, {
    headers: HEADERS,
    data: {
      agent: 'Astra',
      title: 'Aguardando validação de contraste no CI',
      body: 'O runner do CI precisa de suporte a Chromium headless.',
    },
  });

  // Ideia no backlog
  await request.post(`/api/projects/${project.id}/backlog`, {
    headers: HEADERS,
    data: {
      title: 'Implementar modo de alto contraste',
      description: 'Permitir ativar tema com contraste 7:1 para baixa visão.',
      priority: 'medium',
      stage: 'idea',
    },
  });

  // Decisão aceita
  const decRes = await request.post(`/api/projects/${project.id}/decisions`, {
    headers: HEADERS,
    data: {
      agent: 'Astra',
      title: 'Padrão WCAG AA obrigatório',
      body: 'Garantir contraste de 4.5:1 em todos os elementos visíveis.',
    },
  });
  expect(decRes.ok(), 'a decisão precisa existir para a aba Decisões ser medida').toBeTruthy();
  const dec = await decRes.json();
  const aceiteRes = await request.post(`/api/projects/${project.id}/decisions/${dec.id}/accept`, {
    headers: HEADERS,
    data: { actor: 'Astra', expectedVersion: dec.version },
  });
  expect(aceiteRes.ok(), 'a decisão aceita precisa existir para a Retrospectiva ser medida').toBeTruthy();

  // Cartões do quadro com etiqueta, prioridade e lista de verificação
  const cartaoRes = await request.post(`/api/projects/${project.id}/board/cards`, {
    headers: HEADERS,
    data: {
      actor: 'Gemini',
      title: 'Revisar contraste do quadro',
      description: 'Conferir leitura de etiquetas e prioridade.',
      column: 'in_progress',
      labels: ['bug', 'design'],
      priority: 'urgent',
      checklist: [{ text: 'Medir contraste', done: true }, { text: 'Ajustar cores', done: false }],
    },
  });
  expect(cartaoRes.ok(), 'o cartão precisa existir para a aba Quadro ser medida').toBeTruthy();

  // Mensagem entre agentes
  await request.post(`/api/projects/${project.id}/messages`, {
    headers: HEADERS,
    data: {
      from: 'Astra',
      to: 'Grok',
      kind: 'note',
      body: 'Lembrar de testar todas as 8 abas e a navegação lateral.',
    },
  });

  // Conteúdo na biblioteca do projeto
  await request.post(`/api/projects/${project.id}/content`, {
    headers: HEADERS,
    data: {
      title: 'Guia de Estilo Tipográfico',
      kind: 'reference',
      body: 'Diretrizes completas de fontes e cores para acessibilidade.',
      createdBy: 'Astra',
      sourceKind: 'agent_report',
    },
  });

  // Proposta de aprovação pendente
  await request.post(`/api/projects/${project.id}/approvals`, {
    headers: HEADERS,
    data: {
      agent: 'Gemini',
      kind: 'note',
      title: 'Ajuste de contraste em rótulos',
      body: 'Substituir #64748b por cor com contraste >= 4.5:1.',
      rationale: 'Cumprir WCAG AA em toda a interface.',
    },
  });

  return { project, tempWorkspace };
}

test.describe('Parte 9 — Leitura confortável e contraste permanente', () => {
  test('todo texto visível tem pelo menos 11 px (leitura >= 12 px) e contraste >= 4,5:1 em todas as telas e abas', async ({ page, request }) => {
    const { project, tempWorkspace } = await prepararDadosCompletos(request);

    try {
      await page.setViewportSize({ width: 1440, height: 900 });

      const todasFalhasTamanho: FalhaMedicao[] = [];
      const todasFalhasContraste: FalhaMedicao[] = [];
      let totalTextosGeral = 0;

      // 1. Tela Projetos (em lista)
      await page.goto('/#projects');
      await expect(page.locator('.library-project').first()).toBeVisible();
      const listBtn = page.locator('.view-switch button[aria-label="Visualização em lista"]');
      await listBtn.click();
      await expect(listBtn).toHaveAttribute('aria-pressed', 'true');
      {
        const res = await page.evaluate(medirLegibilidade);
        totalTextosGeral += res.totalTextos;
        for (const f of res.falhasTamanho) todasFalhasTamanho.push({ tela: 'Projetos (lista)', ratio: 0, cor: '', ...f });
        for (const f of res.falhasContraste) todasFalhasContraste.push({ tela: 'Projetos (lista)', ...f });
      }

      // 2. Tela Projetos (em grade)
      const gridBtn = page.locator('.view-switch button[aria-label="Visualização em grade"]');
      await gridBtn.click();
      await expect(gridBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.library-projects.as-grid')).toBeVisible();
      {
        const res = await page.evaluate(medirLegibilidade);
        totalTextosGeral += res.totalTextos;
        for (const f of res.falhasTamanho) todasFalhasTamanho.push({ tela: 'Projetos (grade)', ratio: 0, cor: '', ...f });
        for (const f of res.falhasContraste) todasFalhasContraste.push({ tela: 'Projetos (grade)', ...f });
      }

      // 3. Conexões
      await page.locator('.sidebar nav a[href="#connect"]').click();
      await expect(page.getByRole('heading', { name: 'Conexões', level: 1 })).toBeVisible();
      await page.waitForTimeout(300);
      {
        const res = await page.evaluate(medirLegibilidade);
        totalTextosGeral += res.totalTextos;
        for (const f of res.falhasTamanho) todasFalhasTamanho.push({ tela: 'Conexões', ratio: 0, cor: '', ...f });
        for (const f of res.falhasContraste) todasFalhasContraste.push({ tela: 'Conexões', ...f });
      }

      // 4. Guia para IAs
      await page.locator('.sidebar nav a[href="#guide"]').click();
      await expect(page.getByRole('heading', { name: 'Guia para IAs', level: 1 })).toBeVisible();
      await page.waitForTimeout(300);
      {
        const res = await page.evaluate(medirLegibilidade);
        totalTextosGeral += res.totalTextos;
        for (const f of res.falhasTamanho) todasFalhasTamanho.push({ tela: 'Guia para IAs', ratio: 0, cor: '', ...f });
        for (const f of res.falhasContraste) todasFalhasContraste.push({ tela: 'Guia para IAs', ...f });
      }

      // 5. As 8 abas do projeto
      await page.goto(`/#project/${project.id}`);
      await expect(page.getByRole('heading', { name: project.name, level: 1 })).toBeVisible();
      await page.getByLabel('Nome do agente').fill('Astra');

      // Visão geral (com detalhes de tarefa concluída expandidos)
      const toggleBtn = page.locator('.task.is-done .task-details-toggle');
      await expect(toggleBtn.first()).toBeVisible();
      await toggleBtn.first().click();
      await expect(page.locator('.task.is-done.is-expanded').first()).toBeVisible();
      {
        const res = await page.evaluate(medirLegibilidade);
        totalTextosGeral += res.totalTextos;
        for (const f of res.falhasTamanho) todasFalhasTamanho.push({ tela: 'Visão geral', ratio: 0, cor: '', ...f });
        for (const f of res.falhasContraste) todasFalhasContraste.push({ tela: 'Visão geral', ...f });
      }

      // As outras 7 abas
      const outrasAbas = [
        'Quadro',
        'Retrospectiva',
        'Relações',
        'Biblioteca',
        'Backlog',
        'Decisões',
        'Checkpoints',
        'Mensagens',
        'Retomar',
      ];

      for (const tabName of outrasAbas) {
        await page.getByRole('tab', { name: new RegExp(`^${tabName}`) }).click();
        await page.waitForTimeout(600);
        const res = await page.evaluate(medirLegibilidade);
        totalTextosGeral += res.totalTextos;
        for (const f of res.falhasTamanho) todasFalhasTamanho.push({ tela: tabName, ratio: 0, cor: '', ...f });
        for (const f of res.falhasContraste) todasFalhasContraste.push({ tela: tabName, ...f });
      }

      if (todasFalhasTamanho.length > 0) {
        console.log(`\nFALHAS DE TAMANHO DE FONTE (${todasFalhasTamanho.length}):`);
        for (const f of todasFalhasTamanho) {
          console.log(`  [${f.tela}] .${f.classe} (${f.px}px): "${f.texto}" -> ${f.motivo}`);
        }
      }

      if (todasFalhasContraste.length > 0) {
        console.log(`\nFALHAS DE CONTRASTE (${todasFalhasContraste.length} de ${totalTextosGeral} textos):`);
        for (const f of todasFalhasContraste) {
          console.log(`  [${f.tela}] .${f.classe} (${f.px}px, ${f.cor}) ratio ${f.ratio}:1: "${f.texto}"`);
        }
      }

      expect(todasFalhasTamanho, `Encontrados ${todasFalhasTamanho.length} textos abaixo do tamanho mínimo`).toEqual([]);
      expect(todasFalhasContraste, `Encontrados ${todasFalhasContraste.length} textos com contraste insuficiente`).toEqual([]);
    } finally {
      try {
        rmSync(tempWorkspace, { recursive: true, force: true });
      } catch {
        // Limpeza de workspace temporário
      }
    }
  });
});
