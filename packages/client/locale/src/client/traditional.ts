/**
 * Simplified to Taiwan Traditional conversion for the zh-TW locale. zh-TW has
 * no dictionaries of its own: text resolved from `zh` is converted on the fly
 * with OpenCC (`cn` to `twp`, Taiwan characters and phrases), then a table
 * fixes UI terms the phrase dictionary leaves in mainland usage.
 */

/** Converts Simplified Chinese prose to Taiwan Traditional. */
export type TraditionalConverter = (text: string) => string

/** Context before 通過 that makes it mean "passed": 審查通過, 已通過, 全部通過. */
const PASSED_BEFORE = ['已', '未', '不', '全部', '均', '都', '成功', '順利', '是否', '沒有', '審查', '測試', '驗證', '檢查', '校驗', '審核', '審批', '稽核', '驗收', '認證']
/** Context after 通過 that makes it mean "passed": 通過校驗, 通過後, 通過率. */
const PASSED_AFTER = ['校驗', '驗證', '檢查', '審查', '審核', '審批', '測試', '稽核', '驗收', '認證', '後', '率', '並', '才', '而', '了', '之後', '以後', '即', '時', '的']
/** Punctuation that ends a clause right after 通過, as in 檢查已通過。 */
const CLAUSE_END = /^(?:$|[，。；：、！？,.;:)）」』])/u

/**
 * 通過 means "by means of" (透過) in Taiwan usage and "passed" in the sense of
 * a check; only the first is rewritten.
 */
function byMeansOf(match: string, offset: number, whole: string): string {
  const before = whole.slice(0, offset)
  const after = whole.slice(offset + match.length)
  if (PASSED_BEFORE.some(word => before.endsWith(word))) return match
  if (PASSED_AFTER.some(word => after.startsWith(word)) || CLAUSE_END.test(after)) return match
  return '透過'
}

/** Not a package: 包括 包含 包裹 包裝 包容 包圍 包辦 包庇 包子 包廂 包場, and 錢包 書包 背包 紅包 行包 郵包 皮包 麵包 打包 提包 組合包. */
const PACKAGE = /(?<!錢|書|背|紅|行|郵|皮|麵|打|提|組合|紙|揹)包(?![括含裹裝容圍辦庇子廂場])/gu

/**
 * Taiwan UI terms applied to the converted text, in order, with the reason a
 * row exists. OpenCC `twp` already covers 檔案, 設定, 使用者, 連結, 選單, 螢幕,
 * 預設 and 專案; these are the mainland usages and mis-segmentations it leaves
 * behind. Rows are ordered so that a compound is fixed before its parts.
 */
export const TAIWAN_TERM_OVERRIDES: readonly (readonly [from: string | RegExp, to: string])[] = [
  // twp writes 後臺; administrator consoles are 後台, background work is 背景.
  [/管理後臺(?!執行|任務|行程|程序)/gu, '管理後台'],
  [/後臺管理(?=頁|介面|員|系統|端|入口)/gu, '後台管理'],
  ['後臺', '背景'],
  // twp keeps 會話 and 智慧體; the product says 工作階段 and 代理.
  ['會話', '工作階段'],
  ['智慧體', '代理'],
  ['退出登入', '登出'],
  // 獲取 as "fetch a page" is 擷取 in Taiwan; elsewhere 取得.
  ['網頁獲取', '網頁擷取'],
  ['獲取', '取得'],
  // 訪問: "visit" for pages, "access" for resources and permissions.
  [/訪問(?=網頁|網站|頁面|網址|連結)/gu, '瀏覽'],
  ['訪問', '存取'],
  ['登錄檔', '註冊表'],
  ['許可權', '權限'],
  ['跟蹤', '追蹤'],
  ['釋出', '發布'],
  ['賬', '帳'],
  // twp leaves 用戶 outside a few phrases.
  ['用戶', '使用者'],
  ['憑據', '憑證'],
  ['協議', '協定'],
  ['安裝源', '安裝來源'],
  ['下載源', '下載來源'],
  ['複用', '重複使用'],
  ['自定義', '自訂'],
  ['反饋', '意見回饋'],
  ['字首', '前綴'],
  ['配置', '設定'],
  ['創建', '建立'],
  ['窗口', '視窗'],
  ['復制', '複製'],
  ['響應', '回應'],
  // 終端 alone is a terminal emulator; 終端使用者 and 終端設備 are end users and devices.
  [/終端(?![機使設裝節])/gu, '終端機'],
  ['彈窗', '彈出視窗'],
  ['標籤頁', '分頁'],
  ['迴復', '回覆'],
  // twp writes 併 for the conjunction 并 before verbs; 一併 and 併入 stay.
  [/併(?=為|發送|將)/gu, '並'],
  [/隻(?=[會根影是有能需要在對為用讀可])/gu, '只'],
  ['倉庫', '儲存庫'],
  ['程序', '行程'],
  ['當前', '目前'],
  // E-mail addresses are 地址; network and resource addresses are 位址.
  [/(?:郵箱|電子郵件)(?:地址|位址)/gu, '電子郵件地址'],
  ['郵箱', '電子郵件'],
  [/(?<!電子郵件)地址/gu, '位址'],
  ['文本', '文字'],
  // 包 as a software package: 外掛包, 包名, npm 包; archives are 壓縮檔.
  ['壓縮包', '壓縮檔'],
  ['包名', '套件名稱'],
  [PACKAGE, '套件'],
  // Quotation marks: 「」 and 『』 instead of curly quotes; apostrophes stay.
  [/“([^”]*)”/gu, '「$1」'],
  [/‘([^’]*)’/gu, '『$1』'],
]

/** Spans that must reach the output verbatim: placeholders, code, URLs, commands, API identifiers. */
const PROTECTED = /\{\w+\}|`[^`]*`|https?:\/\/[^\s、-〿＀-￯)]+|(?<![A-Za-z0-9/])\/[A-Za-z][\w-]*|\b[a-z]+_[a-z_]+\b/gu

/**
 * Spans of a Markdown document that stay as written: fenced code, inline code,
 * link and image destinations, reference definitions, HTML tags, autolinks,
 * then everything {@link PROTECTED} keeps.
 */
const MARKDOWN_PROTECTED = new RegExp([
  '(?:^|(?<=\\n))[ \\t]*(`{3,}|~{3,})[^\\n]*\\n[\\s\\S]*?(?:\\n[ \\t]*\\1[`~]*[ \\t]*(?=\\n|(?![\\s\\S]))|(?![\\s\\S]))',
  '`+[^`\\n]+`+',
  '(?<=\\]\\()[^)\\s]+',
  '(?<=^\\s*\\[[^\\]\\n]+\\]:[ \\t]*)\\S+',
  '<\\/?[A-Za-z][^>\\n]*>',
  '<(?:https?|mailto):[^>\\n]+>',
  PROTECTED.source,
].join('|'), 'gmu')

/** Private-use marker for one protected span, followed by two index characters. */
const MARK = ''
const DIGIT_MIN = 0xE001
const DIGIT_BASE = 0xF8FF - DIGIT_MIN + 1
const MARKED = /([-])([-])/gu
const PRIVATE_USE = /[-]/u

const cache = new Map<string, string>()

/**
 * Load the OpenCC `cn` to `twp` converter. The dictionaries are a separate
 * chunk, so locales other than zh-TW never download them.
 * @returns the converter function.
 */
export async function loadTraditionalConverter(): Promise<TraditionalConverter> {
  const { Converter } = await import('opencc-js/cn2t')
  return Converter({ from: 'cn', to: 'twp' })
}

/** Apply the Taiwan term table to converted prose. */
function applyOverrides(text: string): string {
  let out = text
  for (const [from, to] of TAIWAN_TERM_OVERRIDES) out = out.replaceAll(from, to)
  return out.replace(/通過/gu, byMeansOf)
}

/**
 * Convert text with the protected spans masked, so the converter and the term
 * table see one string (a rule such as 通過 can look past a command) and the
 * spans come back untouched.
 */
function convertMasked(text: string, convert: TraditionalConverter, protectedSpans: RegExp): string {
  // Text that already holds private-use characters cannot be masked safely.
  if (PRIVATE_USE.test(text)) return text
  const spans: string[] = []
  const masked = text.replace(protectedSpans, (span) => {
    const index = spans.push(span) - 1
    return MARK + String.fromCharCode(DIGIT_MIN + Math.floor(index / DIGIT_BASE)) + String.fromCharCode(DIGIT_MIN + index % DIGIT_BASE)
  })
  const converted = applyOverrides(convert(masked))
  return converted.replace(MARKED, (_match, high: string, low: string) =>
    spans[(high.charCodeAt(0) - DIGIT_MIN) * DIGIT_BASE + low.charCodeAt(0) - DIGIT_MIN] as string)
}

/**
 * Convert Simplified Chinese UI text, leaving protected spans untouched. Results
 * are cached per input string.
 * @param text - Simplified Chinese template text.
 * @param convert - converter returned by {@link loadTraditionalConverter}.
 * @returns the Taiwan Traditional text.
 */
export function toTraditional(text: string, convert: TraditionalConverter): string {
  if (text === '') return text
  const cached = cache.get(text)
  if (cached !== undefined) return cached
  const out = convertMasked(text, convert, PROTECTED)
  cache.set(text, out)
  return out
}

/**
 * Convert a Markdown document (plugin detail pages): prose becomes Taiwan
 * Traditional while code, link destinations, HTML tags and URLs stay as written.
 * @param markdown - Simplified Chinese Markdown.
 * @param convert - converter returned by {@link loadTraditionalConverter}.
 * @returns the converted Markdown.
 */
export function toTraditionalMarkdown(markdown: string, convert: TraditionalConverter): string {
  if (markdown === '') return markdown
  return convertMasked(markdown, convert, MARKDOWN_PROTECTED)
}
