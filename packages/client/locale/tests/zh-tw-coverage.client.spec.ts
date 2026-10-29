// @vitest-environment node
/** Every Simplified string the product ships converts to zh-TW with its copy
 * tokens intact and no invisible characters. Strings are discovered from the
 * source AST of every workspace package (zh dictionaries, inline zh registrations)
 * and from every plugin `locale/zh.json`, not from a hand-picked sample. */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { hasInvisibleLocaleCharacters, localeTokens } from '../../../../scripts/shipped-locales.ts'
import { loadTraditionalConverter, toTraditional } from '../src/client/traditional.ts'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage'])

function walk(dir: string, accept: (name: string) => boolean, out: string[]): string[] {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, accept, out) }
    else if (accept(entry.name)) out.push(full)
  }
  return out
}

function stringsOf(literal: ts.ObjectLiteralExpression, out: string[]): void {
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const init = prop.initializer
    if (ts.isStringLiteralLike(init)) out.push(init.text)
    else if (ts.isObjectLiteralExpression(init)) stringsOf(init, out)
  }
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isSatisfiesExpression(current) || ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

/**
 * Strings of zh dictionaries: exported `zh*`/`*Zh` consts, `register(ns, 'zh', {...})`, `['zh', {...}]` pairs.
 */
function zhStrings(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  if (!/zh|Zh/u.test(text)) return []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  const out: string[] = []
  const consts = new Map<string, ts.Expression>()
  for (const st of source.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer !== undefined) {
        consts.set(d.name.text, d.initializer)
        const lit = unwrap(d.initializer)
        if (/^zh(?![a-z])|Zh$/u.test(d.name.text) && ts.isObjectLiteralExpression(lit)) stringsOf(lit, out)
      }
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length >= 3) {
      const [, tag, dict] = node.arguments
      if (tag !== undefined && ts.isStringLiteral(tag) && tag.text === 'zh' && dict !== undefined) {
        let lit = unwrap(dict)
        if (ts.isIdentifier(lit)) { const r = consts.get(lit.text); if (r !== undefined) lit = unwrap(r) }
        if (ts.isObjectLiteralExpression(lit)) stringsOf(lit, out)
      }
    }
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 2) {
      const [tag, dict] = node.elements
      if (tag !== undefined && dict !== undefined && ts.isStringLiteral(tag) && tag.text === 'zh') {
        const lit = unwrap(dict)
        if (ts.isObjectLiteralExpression(lit)) stringsOf(lit, out)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

function jsonStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) jsonStrings(v, out)
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) jsonStrings(v, out)
}

const convert = await loadTraditionalConverter()

function check(entries: readonly string[]): void {
  for (const entry of entries) {
    const out = toTraditional(entry, convert)
    expect(localeTokens(out), entry).toEqual(localeTokens(entry))
    expect(hasInvisibleLocaleCharacters(out), entry).toBe(false)
    expect(out === '' && entry !== '', entry).toBe(false)
  }
}

describe('zh-TW conversion over every shipped zh string', () => {
  it('converts every zh dictionary string in every workspace package', () => {
    const files = walk(resolve(root, 'packages'), n => /\.tsx?$/u.test(n) && !n.endsWith('.d.ts'), [])
      .filter(f => f.includes(sep + 'src' + sep))
    const perFile = files.map(f => [f, zhStrings(f)] as const).filter(([, s]) => s.length > 0)
    const all = perFile.flatMap(([, s]) => s)
    // Guard against silent narrowing: the sweep must keep reaching many packages and namespaces.
    expect(perFile.length).toBeGreaterThan(20)
    expect(all.length).toBeGreaterThan(500)
    check(all)
  }, 30_000)

  it('converts every plugin locale/zh.json string', () => {
    const files = walk(resolve(root, 'packages'), n => n === 'zh.json', []).filter(f => f.endsWith(sep + 'locale' + sep + 'zh.json'))
    expect(files.length).toBeGreaterThan(5)
    const all: string[] = []
    for (const f of files) jsonStrings(JSON.parse(readFileSync(f, 'utf8')), all)
    expect(all.length).toBeGreaterThan(50)
    check(all)
  })

  it('leaves no Simplified-only glyph from a common UI sample in converted output', () => {
    const out = toTraditional('设置 文件 打开 关闭 删除 选择 项目 窗口 创建 账号', convert)
    expect(out).not.toMatch(/[设开关删选项创账]/u)
  })
})
