import { test, expect, type Page } from '@playwright/test';

async function newProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  await modal.getByLabel('Nome do projeto').fill(name);
  await modal.getByLabel('Objetivo', { exact: true }).fill('Preservar decisões e continuar o trabalho entre agentes.');
  await modal.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('exclui projeto da biblioteca só depois do nome exato e volta à lista se estava aberto', async ({ page }) => {
  const name = 'Arquivo para exclusão';
  await newProject(page, name);
  await page.getByRole('button', { name: 'Excluir projeto', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Excluir projeto', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Digite o nome do projeto')).toBeFocused();
  await expect(dialog).toContainText('Remove o projeto, backlog, tarefas, checkpoints, mensagens e passagens');
  const confirm = dialog.getByRole('button', { name: 'Excluir projeto', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Digite o nome do projeto').fill('arquivo para exclusão');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Digite o nome do projeto').fill(name);
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projetos' })).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Excluir ' + name })).toHaveCount(0);
});

test('mostra arquivadas para exclusão permanente e nunca oferece isso a promovidas', async ({ page }) => {
  await newProject(page, 'Backlog para exclusão');
  await page.getByLabel('Nome do agente').fill('Astra');
  await page.getByRole('tab', { name: /^Backlog/ }).click();
  await page.getByLabel('Título da ideia').fill('Ideia arquivável');
  await page.getByRole('button', { name: 'Capturar ideia', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ideia arquivável', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Arquivar Ideia arquivável' }).click();
  await expect(page.getByRole('heading', { name: 'Ideia arquivável', exact: true })).toHaveCount(0);

  await page.getByLabel('Título da ideia').fill('Ideia promovível');
  await page.getByRole('button', { name: 'Capturar ideia', exact: true }).click();
  const readyCard = page.locator('article.backlog-entry').filter({ hasText: 'Ideia promovível' });
  await readyCard.getByRole('button', { name: 'Preparar ideia', exact: true }).click();
  await readyCard.getByRole('button', { name: 'Transformar em tarefa' }).click();
  await expect(page.locator('article.task')).toContainText('Ideia promovível');

  await page.getByRole('button', { name: 'Mostrar arquivadas', exact: true }).click();
  const archived = page.getByRole('region', { name: 'Ideias arquivadas' });
  await expect(archived).toContainText('Ideia arquivável');
  await expect(archived).not.toContainText('Ideia promovível');
  await expect(archived.getByRole('button', { name: 'Excluir permanentemente' })).toHaveCount(1);
  await expect(page.locator('article.backlog-entry').filter({ hasText: 'Ideia promovível' }).getByRole('button', { name: 'Excluir permanentemente' })).toHaveCount(0);

  await archived.getByRole('button', { name: 'Excluir permanentemente' }).click();
  const confirm = page.getByRole('dialog', { name: 'Excluir ideia arquivada', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Excluir permanentemente', exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(archived).not.toContainText('Ideia arquivável');
});
