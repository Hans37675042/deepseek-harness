// @vitest-environment jsdom
/** Boot is bounded: a stalled zh-TW dictionary chunk does not hold the UI back, and a plugin disposed while waiting stays out. */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, BOOT_WAIT_MS, inject } from '@deepseek-ai/dsh-client-locale/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '../src/locale-settings.ts'

// The chunk never arrives.
vi.mock('opencc-js/cn2t', () => new Promise(() => undefined))

afterEach(() => {
  Reflect.deleteProperty(navigator, 'languages')
  Reflect.deleteProperty(navigator, 'language')
})

async function bench() {
  Object.defineProperty(navigator, 'languages', { value: ['zh-Hant'], configurable: true })
  Object.defineProperty(navigator, 'language', { value: 'zh-Hant', configurable: true })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const namespace = () => ({
    ns: LOCALE_SETTINGS_NAMESPACE, schema: LocaleSettingsSchema.toJSON(), value: {},
    autoGenerate: true, applies: 'live' as const, secrets: [], revision: 0,
  })
  new TestRemote(ctx, {
    settings: {
      describe: vi.fn(async () => ({ ok: true as const, value: { writable: true, hasDocument: true, namespaces: [namespace()] } })),
      mutate: vi.fn(async () => ({ ok: true as const, value: namespace() })),
    },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return ctx
}

describe('bounded boot', () => {
  it('provides the locale in the interim language once the wait runs out', async () => {
    const ctx = await bench()
    const started = Date.now()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const elapsed = Date.now() - started
    const locale = ctx.get('locale') as LocaleRuntime
    expect(elapsed).toBeGreaterThanOrEqual(BOOT_WAIT_MS - 100)
    expect(elapsed).toBeLessThan(BOOT_WAIT_MS + 1500)
    expect(locale.getLocale().active).toBe('zh')
    expect(locale.converterLoaded).toBe(false)
  }, 10_000)

  it('does not provide the locale when the plugin is disposed during the wait', async () => {
    const ctx = await bench()
    const provide = vi.spyOn(Object.getPrototypeOf(ctx.reflect) as { provide: (name: string) => unknown }, 'provide')
    const installLocale = vi.spyOn(ctx.slots, 'installLocale')
    const slotInject = vi.spyOn(ctx.slots, 'inject')
    // Dispose exactly when apply starts to wait; the wait then ends with the fiber already gone.
    let disposal: Promise<void> | undefined
    vi.spyOn(LocaleRuntime.prototype, 'converterReady').mockImplementation(() => {
      disposal = fiber.dispose()
      return Promise.resolve()
    })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await new Promise(resolve => setTimeout(resolve, 300))
    await disposal
    expect(ctx.get('locale')).toBeUndefined()
    expect(installLocale).not.toHaveBeenCalled()
    expect(slotInject).not.toHaveBeenCalled()
    expect(provide.mock.calls.filter(([name]) => name === 'locale')).toHaveLength(0)
  }, 10_000)
})
