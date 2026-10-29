---
kind: upgrade-guide
description: "The web UI registers the zh-TW language, so third-party language packs using that id fail to register."
---

# The web UI registers the zh-TW language

English | [中文](guide.zh.md)

## Change

The locale plugin registers `zh-TW` (繁體中文, fallback `zh`) in the web UI. It has no dictionaries of its own: text from `zh` converts to Taiwan Traditional when read. The desktop shell does not register it. A third-party language pack that calls `ctx.locale.addLanguage({ id: 'zh-TW', ... })` now fails with an already-registered error, and its `zh-TW` dictionaries replace the conversion only if they register under the same namespaces.

## Migration

1. In the language pack's client entry, remove `ctx.locale.addLanguage(...)` for `zh-TW`. Keep `ctx.locale.register(ns, 'zh-TW', dictionary)` for namespaces your plugin owns; an explicit dictionary takes precedence over conversion. For package metadata, keep `locale/zh-tw.json`; it wins over the converted `zh` text. Plugin detail pages (`meta.detail`) are the exception: the client cannot tell which file the Host served, so every detail page read for `zh-TW` is converted, including a `zh-tw` file written in Traditional Chinese.
2. If the pack is a distinct variant, register a separate id such as `zh-HK` instead.
3. Reload with the pack enabled. Confirm it starts without a duplicate-registration error and that selecting 繁體中文 shows your translations.
