import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const samples: {level: string; confidence?: number}[] = JSON.parse(readFileSync(new URL('../../samples/posts.json', import.meta.url), 'utf8'));

test('all synthetic scenarios traverse browser, Vite proxy and FastAPI without API key', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● Mock 모드')).toBeVisible();
  for (const [i, sample] of samples.entries()) {
    await page.getByRole('combobox', { name: '시연 예제' }).selectOption(String(i));
    await page.getByRole('button', { name: /Jev로 우선순위 분석/ }).click();
    await expect(page.getByText('Mock 분석 결과', {exact:true})).toBeVisible();
    await expect(page.getByRole('heading', {name: new RegExp(`Level ${sample.level.slice(-1)} ·`)})).toBeVisible();
    await expect(page.getByRole('meter')).toHaveCount(4);
    if (i === 0) await page.screenshot({path:'test-results/demo-desktop.png',fullPage:true});
    if ('confidence' in sample) await expect(page.getByText(/판단 신뢰도가 낮습니다/)).toBeVisible();
  }
  await page.getByRole('button',{name:'초기화'}).click();
  await expect(page.getByLabel('대상자 정보', {exact:false})).toHaveValue('');
  await expect(page.getByRole('meter')).toHaveCount(0);
  await page.getByRole('button',{name:/질의 목록 12/}).click();
  await expect(page.getByRole('heading',{name:'질의 목록'})).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(12);
  await expect(page.getByRole('combobox',{name:'질의 정렬 기준'})).toHaveValue('newest');
  await expect(page.getByRole('option',{name:'우선순위순 · 준비 중'})).toHaveAttribute('disabled','');
  await expect(page.getByRole('listitem').first()).toContainText('주요 결재 기능 처리 지연');
  await page.screenshot({path:'test-results/query-list-desktop.png',fullPage:true});
});

test('mobile layout and client validation', async ({ page }) => {
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await expect(page.getByText('● Mock 모드')).toBeVisible();
  await page.getByRole('button',{name:/Jev로 우선순위 분석/}).click();
  await expect(page.getByRole('alert')).toHaveCount(3);
  await page.getByRole('combobox',{name:'시연 예제'}).selectOption('0');
  await page.getByRole('button',{name:/Jev로 우선순위 분석/}).click();
  await expect(page.getByText('Mock 분석 결과',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/질의 목록 1/}).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/query-list-mobile.png',fullPage:true});
});
