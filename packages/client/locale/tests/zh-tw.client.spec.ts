// @vitest-environment jsdom
/** zh-TW is a runtime view over the Simplified dictionaries: resolution of
 * browser tags, lazy conversion, and the picker entry. */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { WEB_LOCALE_IDS } from '../../../../scripts/shipped-locales.ts'

afterEach(() => { vi.unstubAllGlobals() })

function make(languages?: readonly string[], withTraditional = true) {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const locale = new LocaleRuntime(ctx, undefined, languages === undefined ? undefined : { languages, preference: null })
  if (withTraditional) {
    ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
  }
  return { ctx, locale }
}

describe('browser language resolution', () => {
  it.each([
    ['zh-TW', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh-MO', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh-Hant-TW', 'zh-TW'],
    ['zh-hant-hk', 'zh-TW'],
    ['zh', 'zh'], ['zh-CN', 'zh'], ['zh-SG', 'zh'], ['zh-Hans', 'zh'], ['zh-Hans-CN', 'zh'],
    ['en-US', 'en'], ['ja-JP', 'ja'],
  ])('%s resolves to %s', async (tag, expected) => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const locale = new LocaleRuntime(ctx, undefined, { languages: [tag], preference: null })
    ctx.effect(() => locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }), 'test: ja')
    ctx.effect(() => locale.addLanguage({ id: 'zh-TW', label: '繁體中文', fallback: 'zh' }), 'test: zh-TW')
    await locale.converterReady()
    expect(locale.getLocale().active).toBe(expected)
  })

  it('keeps Simplified when zh-TW is not registered', () => {
    const { locale } = make(['zh-TW'], false)
    expect(locale.getLocale().active).toBe('zh')
  })
})

describe('zh-TW conversion', () => {
  it('serves converted zh text once the converter is ready, and revises the snapshot', async () => {
    const { ctx, locale } = make()
    ctx.effect(() => locale.register('ns', 'zh', { open: '打开设置', hi: '你好，{name}' }), 'test: dict')
    ctx.effect(() => locale.register('ns', 'en', { open: 'Open settings', hi: 'Hi, {name}' }), 'test: dict en')
    const t = locale.bind('ns')
    locale.setLocale('zh-TW')
    const before = locale.getSnapshot().revision
    expect(locale.getLocale().active).toBe('en')
    await locale.converterReady()
    expect(locale.getLocale().active).toBe('zh-TW')
    expect(locale.getSnapshot().revision).toBeGreaterThan(before)
    expect(t('open')).toBe('開啟設定')
    expect(t('hi', { name: '设置' })).toBe('你好，设置')
    locale.setLocale('zh')
    expect(t('open')).toBe('打开设置')
    locale.setLocale('en')
    expect(t('open')).toBe('Open settings')
  })

  it('prefers an explicit zh-TW dictionary over conversion', async () => {
    const { ctx, locale } = make()
    ctx.effect(() => locale.register('ns', 'zh', { open: '打开' }), 'test: zh')
    ctx.effect(() => locale.register('ns', 'zh-TW', { open: '開啟' }), 'test: zh-TW dict')
    locale.setLocale('zh-TW')
    await locale.converterReady()
    expect(locale.bind('ns')('open')).toBe('開啟')
  })

  it('converts package text resolved from the zh entry', async () => {
    const { locale } = make()
    locale.setLocale('zh-TW')
    await locale.converterReady()
    expect(locale.resolveText({ en: 'Tools', zh: '工具与设置' })).toBe('工具與設定')
    expect(locale.resolveText({ en: 'Tools', zh: '工具', 'zh-tw': '工具箱' })).toBe('工具箱')
    expect(locale.resolveText({ en: 'Tools' })).toBe('Tools')
  })

  it('does not load the converter for other locales', async () => {
    const { locale } = make(['en-US'])
    await locale.converterReady()
    expect(locale.converterLoaded).toBe(false)
    locale.setLocale('zh')
    await locale.converterReady()
    expect(locale.converterLoaded).toBe(false)
    locale.setLocale('zh-TW')
    await locale.converterReady()
    expect(locale.converterLoaded).toBe(true)
  })

})

describe('web locale list', () => {
  it('adds zh-TW after the shipped locales', () => {
    expect(WEB_LOCALE_IDS).toEqual(['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'zh-TW'])
  })
})
