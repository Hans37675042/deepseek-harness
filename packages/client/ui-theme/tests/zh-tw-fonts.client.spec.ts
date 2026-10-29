/** zh-TW prefers Traditional Chinese system fonts so Han characters do not take Simplified glyph shapes. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const themeCss = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8')
const webCss = readFileSync(new URL('../../web/src/base.css', import.meta.url), 'utf8')

/** The declaration block of the first rule whose selector contains `selector`. */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(css.indexOf('{', start), css.indexOf('}', start))
}

describe('zh-TW font stacks', () => {
  it('puts PingFang TC and Microsoft JhengHei ahead of the Simplified faces in the theme stacks', () => {
    const rule = block(themeCss, ':root:lang(zh-TW)')
    for (const variable of ['--dsh-font-family-text-default', '--dsh-font-family-code-default']) expect(rule).toContain(variable)
    const text = rule.slice(rule.indexOf('--dsh-font-family-text-default'), rule.indexOf('--dsh-font-family-code-default'))
    expect(text.indexOf("'PingFang TC'")).toBeGreaterThan(-1)
    expect(text.indexOf("'Microsoft JhengHei'")).toBeGreaterThan(-1)
    expect(text).not.toContain('PingFang SC')
    expect(text).not.toContain('Microsoft YaHei')
    expect(rule).toContain("'PingFang TC', 'Microsoft JhengHei'")
  })

  it('applies the same order to the Web application fallback stack', () => {
    const rule = block(webCss, ':lang(zh-TW) body')
    expect(rule.indexOf("'PingFang TC'")).toBeGreaterThan(-1)
    expect(rule.indexOf("'PingFang TC'")).toBeLessThan(rule.indexOf("'Microsoft JhengHei'"))
    expect(rule).not.toContain('PingFang SC')
  })
})
