import { test, expect } from '@playwright/test'

// playwright.config.ts 가 전역 locale 을 ko-KR 로 고정한다(기존 스펙들의 한국어
// 쿼리 유지). EN 감지 경로는 이 파일에서 locale 을 명시적으로 되돌려 검증한다.

test.describe('EN 감지 (비 ko 로케일)', () => {
  test.use({ locale: 'en-US' })

  test('첫 방문이 EN 이고, KO 전환이 새로고침을 넘어 유지된다', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    await expect(page.getByText('Problems only the command line can solve. Pick a level.')).toBeVisible()
    await expect(page.getByText('Exploration')).toBeVisible()

    await page.getByRole('button', { name: 'KO' }).click()
    await expect(page.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeVisible()

    await page.reload()
    await expect(page.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeVisible()
  })

  test('EN 으로 문제 진입·해결·해설까지 영어로 동작한다', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    await page.getByRole('button', { name: /LEVEL 1/ }).click()
    await expect(page.getByText('First Contact')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Previous problem' })).toBeVisible()

    await page.getByRole('textbox').fill('cat readme.txt')
    await page.getByRole('textbox').press('Enter')

    const sheet = page.getByRole('dialog', { name: 'Explanation' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('SOLUTION')).toBeVisible()
    await expect(sheet.getByText('cat readme.txt')).toBeVisible()
  })
})

test('ko 로케일(전역 기본)은 첫 방문이 KO 다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByText('명령줄로만 풀 수 있는 문제들. 레벨을 고르세요.')).toBeVisible()
})
