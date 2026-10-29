// @vitest-environment jsdom
/** A browser-derived zh-TW waits for the stored Host preference before it pays for the converter. */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime, type LocaleSettings, type LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'

const imports = vi.hoisted(() => ({ count: 0 }))

vi.mock('opencc-js/cn2t', async (importOriginal) => {
  imports.count += 1
  return importOriginal()
})

afterEach(() => { vi.useRealTimers() })

function make(languages: readonly string[]) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const host = stubConfigForm<LocaleSettings>()
  const events: LocaleSnapshot[] = []
  ctx.on('locale/change', (snapshot) => { events.push(snapshot) })
  const locale = new LocaleRuntime(ctx, host.scope, { languages, preference: null })
  ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
  ctx.effect(() => locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }), 'test: ja')
  return { locale, host, events }
}

describe('browser-derived zh-TW and the Host preference', () => {
  it('never imports the converter when the Host later stores another locale', async () => {
    const { locale, host } = make(['zh-TW'])
    expect(imports.count).toBe(0)
    expect(locale.getLocale().active).toBe('zh')
    host.publish({ status: 'ready', value: { preference: 'en' } })
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('en')
    expect(imports.count).toBe(0)
    expect(locale.converterLoaded).toBe(false)
  })

  it('loads and switches once when the Host stores zh-TW', async () => {
    const { locale, host, events } = make(['zh-HK'])
    const ready = locale.converterReady()
    expect(imports.count).toBe(0)
    host.publish({ status: 'ready', value: { preference: 'zh-TW' } })
    await ready
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(events.map(event => event.active)).toEqual(['zh-TW'])
  })

  it('loads when the Host stores nothing', async () => {
    const { locale, host } = make(['zh-Hant'])
    host.publish({ status: 'ready', value: {} })
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
  })

  it('loads when the Host read fails', async () => {
    const { locale, host } = make(['zh-Hant'])
    host.publish({ status: 'unavailable' })
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
  })

  it('stops waiting for a Host that never answers', async () => {
    vi.useFakeTimers()
    const { locale } = make(['zh-Hant'])
    const ready = locale.converterReady()
    await vi.advanceTimersByTimeAsync(1000)
    vi.useRealTimers()
    await ready
    expect(locale.getLocale().active).toBe('zh-TW')
  })

  it('does not wait for the Host when the user picks zh-TW', async () => {
    vi.useFakeTimers()
    const { locale, host } = make(['en-US'])
    locale.setLocale('zh-TW')
    // The Host is still loading and the wait timer has not fired.
    vi.useRealTimers()
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(host.set).toHaveBeenCalledWith('preference', 'zh-TW')
  })
})
