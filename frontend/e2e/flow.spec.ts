import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const samples: {post:{title:string}; level: string; confidence?: number}[] = JSON.parse(readFileSync(new URL('../../samples/posts.json', import.meta.url), 'utf8'));

test('all synthetic scenarios traverse browser, Vite proxy and FastAPI without API key', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● Mock 모드')).toBeVisible();
  for (const [i, sample] of samples.entries()) {
    await page.getByRole('combobox', { name: '시연 예제' }).selectOption(String(i));
    await page.getByRole('button', { name: /Jev로 우선순위 분석/ }).click();
    await expect(page.getByText('Mock 분석 결과', {exact:true})).toBeVisible();
    await expect(page.getByRole('heading', {name: new RegExp(`Level ${sample.level.slice(-1)} ·`)})).toBeVisible();
    await expect(page.getByRole('meter')).toHaveCount(4);
    if (sample.level === 'level_1') await expect(page.getByText(/Mock 시연: Level 1 알림 조건/)).toBeVisible();
    if (i === 0) await page.screenshot({path:'test-results/demo-desktop.png',fullPage:true});
    if ('confidence' in sample) await expect(page.getByText(/판단 신뢰도가 낮습니다/)).toBeVisible();
  }
  await page.getByRole('button',{name:'초기화'}).click();
  await expect(page.getByLabel('대상자 정보', {exact:false})).toHaveValue('');
  await expect(page.getByRole('meter')).toHaveCount(0);
  await page.getByRole('button',{name:new RegExp(`질의 목록 ${samples.length}`)}).click();
  await expect(page.getByRole('heading',{name:'질의 목록'})).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(samples.length);
  await expect(page.getByRole('combobox',{name:'질의 정렬 기준'})).toHaveValue('newest');
  await expect(page.getByRole('option',{name:'우선순위순'})).toBeEnabled();
  await expect(page.getByRole('listitem').first()).toContainText(samples.at(-1)!.post.title);
  await page.getByRole('combobox',{name:'질의 정렬 기준'}).selectOption('priority');
  const sortedLevels = await page.getByRole('listitem').locator('.priority-badge').allTextContents();
  expect(sortedLevels.map(text => Number(text.match(/Level (\d)/)?.[1]))).toEqual([...sortedLevels].map(text => Number(text.match(/Level (\d)/)?.[1])).sort((a,b) => a-b));
  await expect(page.getByRole('listitem').first()).toContainText('Level 1 · 긴급');
  await page.getByRole('combobox',{name:'질의 정렬 기준'}).selectOption('newest');
  await expect(page.getByRole('listitem').first()).toContainText(samples.at(-1)!.post.title);
  await page.screenshot({path:'test-results/query-list-desktop.png',fullPage:true});
});

test('session rule promotes only the matching new query and retains original urgency', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('● Mock 모드')).toBeVisible();
  await page.getByRole('button',{name:'운영 규칙'}).click();
  await page.getByRole('button',{name:'시연 주제 채우기'}).click();
  await page.getByRole('button',{name:'규칙 저장'}).click();
  await page.getByRole('button',{name:'새 분석'}).click();
  await page.getByRole('combobox',{name:'시연 예제'}).selectOption(String(samples.length-1));
  await page.getByRole('button',{name:/Jev로 우선순위 분석/}).click();
  await expect(page.getByRole('heading',{name:'Level 1 · 긴급'})).toBeVisible();
  await expect(page.getByText(/Mock 업무 긴급도 · Level 4/)).toBeVisible();
  await expect(page.getByText(/주제 관련성 96%/)).toBeVisible();
  await expect(page.getByText(/Mock 시연: Level 1 알림 조건/)).toBeVisible();
  await page.getByRole('button',{name:/질의 목록 1/}).click();
  await expect(page.getByRole('listitem').first()).toContainText('운영 규칙 적용');
  await page.getByRole('combobox',{name:'질의 정렬 기준'}).selectOption('priority');
  await expect(page.getByRole('listitem').first().locator('.priority-badge')).toContainText('Level 1');
  await page.getByRole('button',{name:samples.at(-1)!.post.title}).click();
  await expect(page.getByRole('heading',{name:'질의 상세'})).toBeVisible();
  await expect(page.getByText(/Mock 업무 긴급도 · Level 4/)).toBeVisible();
  await expect(page.getByText(/주제 관련성 96%/)).toBeVisible();
  await page.getByRole('button',{name:/목록으로 돌아가기/}).click();
  await expect(page.getByRole('combobox',{name:'질의 정렬 기준'})).toHaveValue('priority');
  await page.reload();
  await page.getByRole('button',{name:'운영 규칙'}).click();
  await expect(page.getByText('설정 없음')).toBeVisible();
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
