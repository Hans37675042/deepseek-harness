// @vitest-environment jsdom
/** Script subtags decide the Chinese variant over the region. */
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

async function active(languages: readonly string[]): Promise<string> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const locale = new LocaleRuntime(ctx, undefined, { languages, preference: null })
  ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
  await locale.converterReady()
  return locale.getLocale().active
}

describe('edge tags', () => {
  it.each([
    ['zh-Hans-TW', 'zh'], ['zh-Hant-CN', 'zh-TW'], ['zh-Hant-SG', 'zh-TW'], ['ZH-hant', 'zh-TW'],
    ['zh-tw', 'zh-TW'],
  ])('%s resolves to %s', async (tag, expected) => {
    expect(await active([tag])).toBe(expected)
  })

  it('takes the first matching language in the browser list', async () => {
    expect(await active(['zh-HK', 'en-US'])).toBe('zh-TW')
    expect(await active(['en-US', 'zh-TW'])).toBe('en')
  })
})
