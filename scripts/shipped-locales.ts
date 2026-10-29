/** Languages whose UI dictionaries and package metadata ship with Harness. */
export const SHIPPED_LOCALE_IDS = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const

/**
 * Languages the web UI offers: the shipped set plus locales derived at runtime.
 * `zh-TW` converts the `zh` dictionaries on the fly, so it has no dictionaries
 * or package metadata of its own and stays out of {@link SHIPPED_LOCALE_IDS}.
 */
export const WEB_LOCALE_IDS = [...SHIPPED_LOCALE_IDS, 'zh-TW'] as const

/** Locale id required by repository translation checks. */
export type ShippedLocaleId = typeof SHIPPED_LOCALE_IDS[number]

/**
 * Extract copy tokens that translations must preserve verbatim.
 * @param text - Dictionary text containing placeholders, slash commands or API field names.
 * @returns Sorted tokens, retaining repeated occurrences.
 */
export function localeTokens(text: string): string[] {
  return (text.match(/\{\w+\}|(?<![A-Za-z0-9/])\/[A-Za-z][\w-]*(?:=[\w-]+| (?:on|off))?|\b[a-z]+_[a-z_]+\b/gu) ?? []).sort()
}

/**
 * Detect translation-service artifacts that must not enter locale resources.
 * @param text - Raw resource or localized text.
 * @returns Whether the text contains a zero-width space or byte-order mark.
 */
export function hasInvisibleLocaleCharacters(text: string): boolean {
  return /[\u200b\ufeff]/u.test(text)
}
