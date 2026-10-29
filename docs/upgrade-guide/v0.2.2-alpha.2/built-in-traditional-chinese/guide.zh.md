---
kind: upgrade-guide
description: "Web UI 内置注册 zh-TW 语言，使用相同 id 的第三方语言包会注册失败。"
---

# Web UI 内置注册 zh-TW 语言

[English](guide.md) | 中文

## 变更

locale 插件在 Web UI 中注册 `zh-TW`（繁體中文，回退语言为 `zh`）。它没有自己的字典：来自 `zh` 的文案在读取时转换为台湾繁体。桌面壳不注册它。调用 `ctx.locale.addLanguage({ id: 'zh-TW', ... })` 的第三方语言包现在会因已注册而失败；只有在相同命名空间下注册的 `zh-TW` 字典才会取代转换结果。

## 迁移

1. 在语言包的 client 入口中，删除针对 `zh-TW` 的 `ctx.locale.addLanguage(...)`。保留你的插件所拥有命名空间的 `ctx.locale.register(ns, 'zh-TW', dictionary)`；显式字典优先于转换。包元数据请保留 `locale/zh-tw.json`，它优先于转换后的 `zh` 文案。插件详情页（`meta.detail`）是例外：客户端无法得知 Host 提供的是哪个文件，因此为 `zh-TW` 读取的每个详情页都会被转换，包括用繁体中文编写的 `zh-tw` 文件。
2. 如果语言包代表不同的变体，请改为注册另一个 id，例如 `zh-HK`。
3. 启用语言包并重新加载应用。确认启动时没有重复注册错误，且选择“繁體中文”后显示你的翻译。
