/** Simplified to Taiwan Traditional runtime conversion: token protection,
 * Taiwan term overrides, and placeholder fidelity over every zh dictionary. */
import { describe, expect, it } from 'vitest'
import { hasInvisibleLocaleCharacters, localeTokens } from '../../../../scripts/shipped-locales.ts'
import {
  loadTraditionalConverter, TAIWAN_TERM_OVERRIDES, toTraditional,
} from '../src/client/traditional.ts'
import { zh } from '../src/locales/index.ts'
import { zh as settingsZh } from '../src/locales/settings.ts'

const convert = await loadTraditionalConverter()

describe('toTraditional', () => {
  it('converts prose to Traditional characters', () => {
    expect(toTraditional('设置', convert)).toBe('設定')
    expect(toTraditional('网络连接失败', convert)).toBe('網路連線失敗')
  })

  it.each([
    // Already right in OpenCC twp.
    ['文件已保存', '檔案已儲存'],
    ['项目设置', '專案設定'],
    ['默认模型', '預設模型'],
    ['用户信息', '使用者資訊'],
    ['复制链接', '複製連結'],
    ['视频菜单', '影片選單'],
    ['屏幕运行', '螢幕執行'],
    ['登录账号', '登入帳號'],
    // Fixed by the override table.
    ['权限与后台任务', '權限與背景任務'],
    ['跟踪发布状态', '追蹤發布狀態'],
    ['凭据与访问控制', '憑證與存取控制'],
    ['当前配置', '目前設定'],
    ['创建窗口', '建立視窗'],
    ['打开终端', '開啟終端機'],
    ['终端机', '終端機'],
    ['通过命令压缩会话', '透過命令壓縮工作階段'],
    ['审查通过', '審查通過'],
    ['检查已通过。', '檢查已通過。'],
    ['这只会影响显示', '這只會影響顯示'],
    ['Git 仓库地址', 'Git 儲存庫位址'],
    ['本轮回复', '本輪回覆'],
    ['安装软件包', '安裝軟體套件'],
  ])('applies Taiwan terms: %s', (input, expected) => {
    expect(toTraditional(input, convert)).toBe(expected)
  })
  it('keeps placeholders, commands, identifiers, URLs and code spans verbatim', () => {
    const text = '运行 /compact 后，{name} 的 tool_call_id 见 https://example.com/a?x=1 与 `设置` 文件'
    const out = toTraditional(text, convert)
    expect(out).toContain('{name}')
    expect(out).toContain('/compact')
    expect(out).toContain('tool_call_id')
    expect(out).toContain('https://example.com/a?x=1')
    expect(out).toContain('`设置`')
    expect(out).toContain('執行')
    expect(out).toContain('檔案')
  })

  it('caches per string and leaves empty text alone', () => {
    expect(toTraditional('', convert)).toBe('')
    expect(toTraditional('设置', convert)).toBe(toTraditional('设置', convert))
  })

  it('has a small, duplicate-free override table', () => {
    const keys = TAIWAN_TERM_OVERRIDES.map(([from]) => from)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBeLessThan(60)
  })

  it('preserves tokens and avoids invisible characters for every zh entry', () => {
    const entries = [...Object.values(zh), ...Object.values(settingsZh)] as string[]
    expect(entries.length).toBeGreaterThan(10)
    for (const entry of entries) {
      const out = toTraditional(entry, convert)
      expect(localeTokens(out), entry).toEqual(localeTokens(entry))
      expect(hasInvisibleLocaleCharacters(out), entry).toBe(false)
    }
  })
})
