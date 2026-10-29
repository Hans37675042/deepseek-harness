// @vitest-environment jsdom
/** zh-TW only becomes the active locale once its converter is loaded; the choice itself is stored at once. */
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime, type LocaleSettings, type LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'

function make(languages: readonly string[] = ['en-US']) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const host = stubConfigForm<LocaleSettings>()
  const events: LocaleSnapshot[] = []
  ctx.on('locale/change', (snapshot) => { events.push(snapshot) })
  const locale = new LocaleRuntime(ctx, host.scope, { languages, preference: null })
  ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
  return { ctx, locale, host, events }
}

describe('deferred activation', () => {
  it('stores the choice at once but switches and announces only after the converter loads', async () => {
    const { locale, host, events } = make()
    locale.setLocale('zh-TW')
    expect(host.set).toHaveBeenCalledWith('preference', 'zh-TW')
    expect(locale.getLocale().active).toBe('en')
    expect(events).toHaveLength(0)
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(events.map(event => event.active)).toEqual(['zh-TW'])
  })

  it('does not flash Simplified: the interim locale before the first switch is never zh-TW text', async () => {
    const { locale } = make()
    locale.register('ns', 'zh', { a: '设置' })
    locale.register('ns', 'en', { a: 'Settings' })
    locale.setLocale('zh-TW')
    expect(locale.bind('ns')('a')).toBe('Settings')
    await locale.converterReady()
    expect(locale.bind('ns')('a')).toBe('設定')
  })

  it('opens in zh while a startup zh-TW choice loads, then switches with an announcement', async () => {
    const { locale, events } = make(['zh-Hant'])
    expect(locale.getLocale().active).toBe('zh')
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(events.at(-1)?.active).toBe('zh-TW')
  })

  it('lets a later choice supersede a pending zh-TW switch', async () => {
    const { locale } = make()
    locale.setLocale('zh-TW')
    locale.setLocale('zh')
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh')
  })

  it('converts a Markdown document only for a zh-TW read', async () => {
    const { locale } = make()
    locale.setLocale('zh-TW')
    await locale.converterReady()
    expect(locale.convertDocument('zh-TW', '# 设置\n\n```\n设置\n```')).toBe('# 設定\n\n```\n设置\n```')
    expect(locale.convertDocument('zh', '# 设置')).toBe('# 设置')
    expect(locale.convertDocument('en', '# 设置')).toBe('# 设置')
  })
})

describe('exact registered tags win over the Chinese variant rule', () => {
  function pick(languages: readonly string[], extra: readonly string[]): string {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const locale = new LocaleRuntime(ctx, undefined, { languages, preference: null })
    for (const id of extra) ctx.effect(() => locale.addLanguage({ id, label: id, fallback: 'en' }), `test: ${id}`)
    return locale.getLocale().active
  }

  it('prefers a third-party zh-HK pack for a zh-HK browser', () => {
    expect(pick(['zh-HK'], ['zh-HK'])).toBe('zh-HK')
  })

  it('prefers a third-party zh-CN pack for a zh-CN browser', () => {
    expect(pick(['zh-CN'], ['zh-CN'])).toBe('zh-CN')
  })

  it('falls back to the primary subtag when no variant applies', () => {
    expect(pick(['fr-CA'], ['fr'])).toBe('fr')
  })
})
