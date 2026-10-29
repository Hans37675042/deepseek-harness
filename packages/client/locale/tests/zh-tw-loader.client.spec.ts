// @vitest-environment jsdom
/** zh-TW converter loading: one load shared across locale switches, and a
 * failed load keeps the Simplified text without throwing. */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

const state = vi.hoisted(() => ({ fail: false, calls: 0 }))

vi.mock('opencc-js/cn2t', async (importOriginal) => {
  const real = await importOriginal<typeof import('opencc-js/cn2t')>()
  return {
    ...real,
    Converter: (...args: Parameters<typeof real.Converter>) => {
      state.calls += 1
      if (state.fail) throw new Error('chunk load failed')
      return real.Converter(...args)
    },
  }
})

afterEach(() => {
  state.fail = false
  state.calls = 0
  vi.restoreAllMocks()
})

function make(bootstrap = { languages: ['en-US'] as readonly string[], preference: null as string | null }) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const locale = new LocaleRuntime(ctx, undefined, bootstrap)
  ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
  ctx.effect(() => locale.register('ns', 'zh', { open: '打开设置' }), 'test: zh')
  ctx.effect(() => locale.register('ns', 'en', { open: 'Open settings' }), 'test: en')
  return locale
}

describe('converter loading', () => {
  it('reuses the loaded converter across zh-TW -> en -> zh-TW', async () => {
    const locale = make()
    const t = locale.bind('ns')
    locale.setLocale('zh-TW')
    await locale.converterReady()
    expect(t('open')).toBe('開啟設定')
    expect(state.calls).toBe(1)
    locale.setLocale('en')
    expect(t('open')).toBe('Open settings')
    locale.setLocale('zh-TW')
    await locale.converterReady()
    expect(t('open')).toBe('開啟設定')
    expect(state.calls).toBe(1)
  })

  it('keeps the previous locale and does not throw when the converter fails to load', async () => {
    state.fail = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const locale = make()
    const t = locale.bind('ns')
    locale.setLocale('zh-TW')
    await expect(locale.converterReady()).resolves.toBeUndefined()
    expect(locale.converterLoaded).toBe(false)
    expect(locale.getLocale().active).toBe('en')
    expect(t('open')).toBe('Open settings')
    expect(error).toHaveBeenCalled()
  })

  it('retries on the next setLocale and then switches', async () => {
    state.fail = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const locale = make()
    locale.setLocale('zh-TW')
    await locale.converterReady()
    const failed = state.calls
    expect(failed).toBe(1)
    state.fail = false
    locale.setLocale('zh-TW')
    await locale.converterReady()
    expect(state.calls).toBe(failed + 1)
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(locale.bind('ns')('open')).toBe('開啟設定')
  })

  it('retries when the browser comes back online', async () => {
    state.fail = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const locale = make()
    locale.setLocale('zh-TW')
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('en')
    state.fail = false
    window.dispatchEvent(new Event('online'))
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(locale.bind('ns')('open')).toBe('開啟設定')
  })

  it('drops the online retry when the plugin is disposed', async () => {
    state.fail = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx, undefined, { languages: ['en-US'], preference: null })
    ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
    locale.setLocale('zh-TW')
    await locale.converterReady()
    const remove = vi.spyOn(window, 'removeEventListener')
    await ctx.fiber.dispose()
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function))
    state.fail = false
    const calls = state.calls
    const revision = locale.getSnapshot().revision
    window.dispatchEvent(new Event('online'))
    await locale.converterReady()
    expect(state.calls).toBe(calls)
    expect(locale.getSnapshot().revision).toBe(revision)
  })

  it('does not retry a failed load on unrelated snapshot changes', async () => {
    state.fail = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const locale = make()
    locale.setLocale('zh-TW')
    await locale.converterReady()
    const calls = state.calls
    locale.register('other', 'en', { x: 'x' })
    locale.setLocale('en')
    await locale.converterReady()
    expect(state.calls).toBe(calls)
  })

})

describe('stored preference', () => {
  it('opens in zh-TW and converts when the stored preference is zh-TW', async () => {
    const locale = make({ languages: ['en-US'], preference: 'zh-TW' })
    expect(locale.getLocale().active).toBe('en')
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(locale.converterLoaded).toBe(true)
    expect(locale.bind('ns')('open')).toBe('開啟設定')
  })

  it('applies a stored zh-TW preference registered after construction', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const locale = new LocaleRuntime(ctx, undefined, { languages: ['en-US'], preference: 'zh-TW' })
    ctx.effect(() => locale.register('ns', 'zh', { open: '打开设置' }), 'test: zh')
    expect(locale.getLocale().active).toBe('en')
    ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
    expect(locale.getLocale().active).toBe('en')
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(locale.bind('ns')('open')).toBe('開啟設定')
  })
})
