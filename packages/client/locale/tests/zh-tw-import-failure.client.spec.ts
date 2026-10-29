// @vitest-environment jsdom
/** The dictionary chunk itself fails to load (offline, 404): the previous locale stays and nothing throws. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

vi.mock('opencc-js/cn2t', () => { throw new Error('Failed to fetch dynamically imported module') })

describe('rejected dictionary import', () => {
  it('keeps the previous locale and the stored preference', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const locale = new LocaleRuntime(ctx, undefined, { languages: ['en-US'], preference: null })
    ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
    locale.setLocale('zh-TW')
    await expect(locale.converterReady()).resolves.toBeUndefined()
    expect(locale.converterLoaded).toBe(false)
    expect(locale.getLocale().active).toBe('en')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('converter'), expect.any(Error))
  })
})
