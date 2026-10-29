// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type {
  AssistantMessageNode, ChatSnapshot, LegacyConversationSlice, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import {
  ActivityPill, UsagePill, deriveStats, formatDuration, latestAnswerTokensPerSecond, latestTtftMs, type StatPillProps,
} from '../src/client/chat/StatsPills.tsx'
import type { AssistantMessageNodeWithLatency } from '../src/client/contract/chat-nodes.ts'
import { formatTokens } from '../src/client/chat/token-format.ts'
import { en, zh } from '../src/client/locale.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const t: StatPillProps['t'] = makeTranslate(zh, commonZh)
const tEn: StatPillProps['t'] = makeTranslate(en, commonEn)

/** Both composer-dock entries in their registered order, as the dock renders them. */
function StatsPills(props: StatPillProps) {
  return (
    <>
      <ActivityPill {...props} />
      <UsagePill {...props} />
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const assistant = (seq: number, turn: number, usage?: unknown): AssistantMessageNode => ({
  kind: 'assistant', seq, time: seq * 1_000, turn, step: seq, blocks: [{ kind: 'text', text: `t${seq}` }],
  ...(usage === undefined ? {} : { usage }),
})

type ChatUpdate = Partial<LegacyConversationSlice>

function makeSource(init: ChatUpdate = {}) {
  let snap = chatSnapshotFixture(init)
  const subs = new Set<() => void>()
  return {
    set: (next: ChatUpdate) => {
      snap = chatSnapshotFixture({ ...snap.legacy, ...next }, snap)
      for (const fn of [...subs]) fn()
    },
    source: {
      getSnapshot: () => snap,
      subscribe: (fn: () => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
    },
  }
}

describe('deriveStats', () => {
  it('counts turns and steps and never folds node usage into accounting', () => {
    const stats = deriveStats([
      assistant(1, 1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 900 }),
      assistant(2, 1, { inputTokens: 100, outputTokens: 50 }),
      assistant(3, 2),
    ])
    expect(stats.turns).toBe(2)
    expect(stats.steps).toBe(3)
    // The window fold's counts are only the fallback for assemblies without
    // the sessionStats projection; the paged window is not an accounting
    // source either, so the fold exposes no billing fields (billing rides the
    // tokenUsage projection); decodeTokens is a throughput input, not a
    // billed total.
    expect(Object.keys(stats).sort()).toEqual(
      ['decodeMs', 'decodeTokens', 'llmMs', 'steps', 'toolMs', 'ttftMs', 'ttftSteps', 'turns'],
    )
  })

  it('ignores tool results with no call time', () => {
    const tool: ToolResultNode = {
      kind: 'tool-result', seq: 5, time: 5_000, callId: 'c', call: null, callTime: null, content: [],
      name: '', args: PartialArguments.EMPTY,
      isError: false, subCalls: [],
    }
    const stats = deriveStats([tool, assistant(1, 1)])
    expect(stats.steps).toBe(1)
    expect(stats.toolMs).toBe(0)
  })

  it('sums LLM wall time from assistant timing and tool wall time from call/result pairs', () => {
    const timed: AssistantMessageNode = {
      ...assistant(1, 1),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_200, completedTime: 3_500 },
    }
    const untimed: AssistantMessageNode = {
      ...assistant(2, 1),
      timing: { stepStartTime: null, firstTokenTime: null, completedTime: 9_000 },
    }
    const tool: ToolResultNode = {
      kind: 'tool-result', seq: 5, time: 7_000, callId: 'c', call: null, callTime: 4_000, content: [],
      name: '', args: PartialArguments.EMPTY,
      isError: false, subCalls: [],
    }
    const stats = deriveStats([timed, untimed, tool])
    expect(stats.llmMs).toBe(2_500)
    expect(stats.toolMs).toBe(3_000)
  })

  it('sums ttft per recorded step and decode throughput inputs per usage-carrying step', () => {
    const sampled: AssistantMessageNode = {
      ...assistant(1, 1, { outputTokens: 40 }),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 4_800 },
    }
    const ttftOnly: AssistantMessageNode = {
      ...assistant(2, 1),
      timing: { stepStartTime: 5_000, firstTokenTime: 5_400, completedTime: 7_400 },
    }
    const stats = deriveStats([sampled, ttftOnly, assistant(3, 2)])
    expect(stats.ttftMs).toBe(1_200)
    expect(stats.ttftSteps).toBe(2)
    // The usage-less step contributes no decode share, keeping the ratio honest.
    expect(stats.decodeMs).toBe(3_000)
    expect(stats.decodeTokens).toBe(40)
  })
})

describe('formatters', () => {
  it('formats token counts compactly', () => {
    expect(formatTokens(517, tEn)).toBe('517')
    expect(formatTokens(12_240, tEn)).toBe('12.2K')
    expect(formatTokens(517_000, tEn)).toBe('517K')
    expect(formatTokens(1_230_000, tEn)).toBe('1.2M')
  })

  it('formats durations under and over a minute', () => {
    expect(formatDuration(45_230, tEn)).toBe('45.2s')
    expect(formatDuration(162_000, tEn)).toBe('2m42s')
  })
})

describe('composer stats pills', () => {
  const USAGE = { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0 }

  /** A whole-log sessionStats value: zeros plus overrides. */
  function sessionStats(overrides: Record<string, number>): Record<string, number> {
    return {
      turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
      ...overrides,
    }
  }

  /** Stub the projection seat: a key-addressed table of whole values. */
  function projections(values: Record<string, unknown>): StatPillProps['useProjection'] {
    return (key: string) => values[key]
  }

  function props(
    source: { getSnapshot(): ChatSnapshot; subscribe(fn: () => void): () => void },
    values: Record<string, unknown> = { tokenUsage: USAGE },
  ): StatPillProps {
    return { usePerformanceUsage: selector => selector('detailed'), useChat: bindSnapshotSelector(source), useProjection: projections(values), t: tEn }
  }

  function tokenUsage(cacheReadTokens: number, uncachedInputTokens: number) {
    return { uncachedInputTokens, outputTokens: 1, cacheReadTokens, cacheWriteTokens: 0 }
  }

  /** A step whose timing yields 3.8s LLM, 0.8s TTFT, and 20 tok/s over 60 tokens. */
  const timedStep = (): AssistantMessageNode => ({
    ...assistant(1, 1, { outputTokens: 60 }),
    timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 4_800 },
  })

  it('compact keeps only speed and cache hit, with no interactive statistics', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} usePerformanceUsage={selector => selector('compact')} />)
    expect(view.container.textContent).toBe('20 tok/s ·TTFT 0.8sCache hit 90%')
    expect(view.queryByRole('button')).toBeNull()
    fireEvent.mouseOver(view.getByText(/20 tok\/s/))
    expect(view.queryByRole('dialog')).toBeNull()
    view.rerender(<StatsPills {...props(source)} />)
    expect(view.getAllByRole('button')).toHaveLength(2)
    fireEvent.click(view.getAllByRole('button')[0]!)
    expect(view.getByRole('dialog')).toBeTruthy()
    view.rerender(<StatsPills {...props(source)} usePerformanceUsage={selector => selector('compact')} />)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('compact omits unavailable metrics instead of showing counts', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {})} usePerformanceUsage={selector => selector('compact')} />)
    expect(view.container.textContent).toBe('')
  })

  it('renders the counts reading and usage pill and hides a brand-new empty session', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source)} />)
    // No timing on the fixture: the speed segment drops out and the dialog
    // would have no rows, so the counts reading stays a static pill (no button).
    expect(view.getByText('1 turns 1 steps').closest('button')).toBeNull()
    // Cache hit comes from the projection, so paging the window cannot change
    // it; the usage pill leads with the whole-log token total. Its accessible
    // name separates the segments the visual sep glyph joins.
    const usagePill = view.getAllByRole('button')
    expect(usagePill.map(pill => pill.textContent)).toEqual(['105 tok·Cache hit 90%'])
    expect(usagePill[0]!.getAttribute('aria-label')).toBe('105 tok · Cache hit 90%')
    const empty = makeSource()
    const emptyView = render(<StatsPills {...props(empty.source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      contextPressure: {},
    })} />)
    expect(emptyView.container.textContent).toBe('')
  })

  it.each([
    { actual: '98.6%', tokenUsageValue: tokenUsage(986, 14), expected: 'Cache hit 99%' },
    { actual: '99.1%', tokenUsageValue: tokenUsage(991, 9), expected: 'Cache hit 99%' },
    { actual: '99.49%', tokenUsageValue: tokenUsage(9_949, 51), expected: 'Cache hit 99%' },
    { actual: '99.5%', tokenUsageValue: tokenUsage(995, 5), expected: 'Cache hit 99.5%' },
    { actual: '99.94%', tokenUsageValue: tokenUsage(9_994, 6), expected: 'Cache hit 99.9%' },
    { actual: '99.95%', tokenUsageValue: tokenUsage(9_995, 5), expected: 'Cache hit 99.95%' },
    { actual: '99.955%', tokenUsageValue: tokenUsage(19_991, 9), expected: 'Cache hit 99.96%' },
    { actual: '99.985%', tokenUsageValue: tokenUsage(19_997, 3), expected: 'Cache hit 99.99%' },
    { actual: '99.995%', tokenUsageValue: tokenUsage(19_999, 1), expected: 'Cache hit 99.995%' },
    { actual: '99.9975%', tokenUsageValue: tokenUsage(39_999, 1), expected: 'Cache hit 99.998%' },
    {
      actual: 'the closest non-full ratio available from safe integer cumulative counts',
      tokenUsageValue: tokenUsage(Number.MAX_SAFE_INTEGER - 1, 1),
      expected: 'Cache hit 99.99999999999999%',
    },
    { actual: '100%', tokenUsageValue: tokenUsage(10_000, 0), expected: 'Cache hit 100%' },
  ])('formats an actual $actual cache-hit ratio as $expected', ({ tokenUsageValue, expected }) => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, { tokenUsage: tokenUsageValue })} />)
    expect(view.getAllByRole('button')[0]!.textContent).toContain(expected)
  })

  it('exposes output speed on the counts pill when decode timing exists', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)
    const timePill = view.getAllByRole('button')[0]!
    expect(timePill.textContent).toBe('1 turns 1 steps·20 tok/s ·TTFT 0.8s')
    expect(timePill.getAttribute('aria-label')).toBe('1 turns 1 steps · 20 tok/s · TTFT 0.8s')
  })

  it('marks each pill with its dock entry id', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)
    const pills = [...view.container.querySelectorAll('[data-composer-stat]')]
    expect(pills.map(pill => [pill.getAttribute('data-composer-stat'), pill.textContent])).toEqual([
      ['activity', '1 turns 1 steps·20 tok/s ·TTFT 0.8s'],
      ['usage', '105 tok·Cache hit 90%'],
    ])
  })

  it('click-opens the time-and-speed dialog carrying the time split and speeds', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)

    const timePill = view.getAllByRole('button')[0]!
    expect(timePill.getAttribute('aria-haspopup')).toBe('dialog')
    expect(timePill.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByRole('dialog')).toBeNull()

    fireEvent.click(timePill)
    expect(timePill.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Session statistics')
    // Portaled out of the composer dock.
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.firstChild?.textContent).toBe('Session statistics1 turns 1 steps')
    const details = dialog.querySelector('[data-session-stats-details]') as HTMLElement
    expect(details).toBeTruthy()
    expect(details.textContent).toContain('LLM time3.8s')
    // No tool call in this session: the row is absent, not zeroed.
    expect(details.textContent).not.toContain('Tool time')
    expect(details.textContent).toContain('Avg time to first token (TTFT)0.8s')
    expect(details.textContent).toContain('Avg tokens per second (TPS)20 tok/s')
    expect(details.textContent).toContain('Latest answer tokens per second (TPS)20 tok/s')
    // Token accounting lives on the usage pill's own dialog, not here.
    expect(dialog.textContent).not.toContain('Token usage')
  })

  it('click-opens the token-usage dialog carrying the headline total and exact buckets', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)

    const usagePill = view.getAllByRole('button')[1]!
    fireEvent.click(usagePill)
    expect(usagePill.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Token usage')
    expect(dialog.parentElement).toBe(document.body)
    // Headline total: all prompt-side buckets (10 + 90 + 0) plus output (5).
    expect(dialog.firstChild?.textContent).toBe('Token usage105 tok')
    const tokens = dialog.querySelector('[data-session-stats-usage]') as HTMLElement
    expect(tokens).toBeTruthy()
    expect(tokens.textContent).toContain('Cache hit90%')
    expect(tokens.textContent).toContain('Uncached input10 tok')
    expect(tokens.textContent).toContain('Cached input90 tok')
    // A session that never wrote cache drops the row rather than showing 0.
    expect(tokens.textContent).not.toContain('Cache write')
    expect(tokens.textContent).toContain('Output5 tok')
    // The time split lives on the counts pill's own dialog, not here.
    expect(dialog.textContent).not.toContain('LLM time')
  })

  it('closes the dialog on Escape or an outside pointerdown', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)
    const timePill = view.getAllByRole('button')[0]!

    fireEvent.click(timePill)
    expect(view.queryByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(timePill.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(timePill)
    // A pointerdown inside the panel keeps it open; one outside closes it.
    fireEvent.pointerDown(view.getByRole('dialog'))
    expect(view.queryByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('keeps at most one dialog open: a sibling pill click swaps, never stacks', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)
    const [timePill, usagePill] = [...view.getAllByRole('button')] as [HTMLElement, HTMLElement]

    fireEvent.click(timePill)
    expect(view.getByRole('dialog').getAttribute('aria-label')).toBe('Session statistics')
    // A sibling pill's pointerdown lands outside the open dialog and closes it.
    fireEvent.pointerDown(usagePill)
    fireEvent.click(usagePill)
    const dialogs = view.getAllByRole('dialog')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]!.getAttribute('aria-label')).toBe('Token usage')
    expect(timePill.getAttribute('aria-expanded')).toBe('false')
    expect(usagePill.getAttribute('aria-expanded')).toBe('true')
  })

  it('swaps dialogs on keyboard activation of a sibling pill, which fires click without pointerdown', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)
    const [timePill, usagePill] = [...view.getAllByRole('button')] as [HTMLElement, HTMLElement]
    fireEvent.click(timePill)
    // A click inside the panel keeps it open; focus moving away does not close it.
    fireEvent.click(view.getByRole('dialog'))
    fireEvent.focusIn(usagePill)
    expect(view.getByRole('dialog').getAttribute('aria-label')).toBe('Session statistics')
    fireEvent.click(usagePill)
    const dialogs = view.getAllByRole('dialog')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]!.getAttribute('aria-label')).toBe('Token usage')
  })

  it('takes every pill and dialog label from the active locale', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source, { tokenUsage: tokenUsage(9_995, 5) })} t={t} />)
    const [timePill, usagePill] = [...view.getAllByRole('button')] as [HTMLElement, HTMLElement]
    expect(timePill.textContent).toBe('1 轮 1 步·20 tok/s ·TTFT 0.8秒')
    // Whole-log total 9995 + 5 + 1 compacts to 10K.
    expect(usagePill.textContent).toBe('10K tok·缓存命中 99.95%')
    fireEvent.click(timePill)
    const timeDialog = view.getByRole('dialog')
    expect(timeDialog.getAttribute('aria-label')).toBe('会话统计')
    expect(timeDialog.textContent).toContain('模型用时3.8秒')
    expect(timeDialog.textContent).toContain('首 token 平均（TTFT）0.8秒')
    expect(timeDialog.textContent).toContain('平均输出速度（TPS）20 tok/s')
    expect(timeDialog.textContent).toContain('本次回答输出速度（TPS）20 tok/s')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(usagePill)
    const usageDialog = view.getByRole('dialog')
    expect(usageDialog.getAttribute('aria-label')).toBe('Token 用量')
    expect(usageDialog.textContent).toContain('未缓存输入5 tok')
  })

  describe('full reading of a cut-off pill', () => {
    const FULL = '105 tok · Cache hit 90%'

    function renderCut(overflow: boolean, mode: 'detailed' | 'compact' = 'detailed') {
      vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(overflow ? 200 : 80)
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(80)
      vi.useFakeTimers()
      const { source } = makeSource({ nodes: [timedStep()] })
      return render(<StatsPills {...props(source)} usePerformanceUsage={selector => selector(mode)} />)
    }
    const tooltipText = (view: ReturnType<typeof render>) => view.queryByRole('tooltip')?.textContent ?? null
    afterEach(() => { vi.useRealTimers() })

    it.each([false, true])('shows on hover after the dock delay only while the label is cut off: %s', (overflow) => {
      const view = renderCut(overflow)
      fireEvent.pointerEnter(view.getAllByRole('button')[1]!)
      expect(tooltipText(view)).toBeNull()
      act(() => { vi.advanceTimersByTime(200) })
      expect(tooltipText(view)).toBe(overflow ? FULL : null)
    })

    it('shows on keyboard focus of a dialog pill', () => {
      const view = renderCut(true)
      fireEvent.keyDown(document.body, { key: 'Tab' })
      fireEvent.focus(view.getAllByRole('button')[1]!)
      expect(tooltipText(view)).toBe(FULL)
    })

    it('yields to the open dialog, whose head carries the counts', () => {
      const view = renderCut(true)
      const [timePill] = view.getAllByRole('button') as [HTMLElement]
      fireEvent.click(timePill)
      fireEvent.pointerEnter(timePill)
      act(() => { vi.advanceTimersByTime(200) })
      expect(tooltipText(view)).toBeNull()
      expect(view.getByRole('dialog').firstChild?.textContent).toBe('Session statistics1 turns 1 steps')
    })

    it('pins a cut-off static reading on tap', () => {
      const view = renderCut(true, 'compact')
      const plainPill = view.getByText('Cache hit 90%').parentElement!
      fireEvent.pointerDown(plainPill, { pointerType: 'touch' })
      fireEvent.click(plainPill)
      expect(tooltipText(view)).toBe('Cache hit 90%')
    })
  })

  it('keeps the durable usage pill after the visible step window is empty', () => {
    const { source } = makeSource()
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 },
    })} />)
    // Context occupancy lives on the composer's ContextMeter ring, not here.
    const pills = view.getAllByRole('button')
    expect(pills).toHaveLength(1)
    expect(pills[0]!.textContent).toBe('105 tok·Cache hit 90%')
  })

  it('drops the usage pill when no projection is composed', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {})} />)
    expect(view.container.textContent).toBe('1 turns 1 steps')
    // The untimed window has no dialog rows either, so no button renders at all.
    expect(view.queryAllByRole('button')).toHaveLength(0)
  })

  it('renders whole-session counts from the sessionStats projection over the paged window', () => {
    // The bug's acceptance at unit level: one loaded page must not scope the
    // counter — the durable projection's totals win over the window fold.
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({ turns: 10, steps: 89 }),
    })} />)
    expect(view.getByText('10 turns 89 steps')).toBeTruthy()
  })

  it('treats a defined zero-count projection as empty, not as fallback', () => {
    // A composed unit always serves the key; all-zero genuinely means no
    // closed step in the whole log, so nothing renders on a brand-new session.
    const empty = makeSource()
    const view = render(<StatsPills {...props(empty.source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      sessionStats: sessionStats({}),
    })} />)
    expect(view.container.textContent).toBe('')
  })

  it('hides the usage pill when steps closed without any billed activity', () => {
    // A session whose only turn failed before billing (e.g. an auth error):
    // the counts pill renders alone, not an uninformative zero-token pill.
    const { source } = makeSource()
    const view = render(<StatsPills {...props(source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      sessionStats: sessionStats({ turns: 1, steps: 1 }),
    })} />)
    expect(view.container.textContent).toBe('1 turns 1 steps')
    expect(view.queryAllByRole('button')).toHaveLength(0)
  })

  it('keeps the counts pill over an empty visible window when the projection carries totals', () => {
    // Extends the durable-groups guarantee: full-session counts survive a
    // window that compaction (or paging) left without assistant nodes.
    const { source } = makeSource()
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({ turns: 7, steps: 44 }),
    })} />)
    expect(view.getByText('7 turns 44 steps')).toBeTruthy()
  })

  it('renders whole-log speed and dialog figures from the projection, not the loaded window', () => {
    // The 加载更早 hazard beyond counts: the pill's speed segment and the
    // dialog's time split, TTFT, and throughput must not grow per loaded page
    // either. An untimed 1-node window renders the projection's whole-log figures.
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({
        turns: 200, steps: 200, llmMs: 100_000, toolMs: 62_000,
        ttftMs: 1_600, ttftSteps: 2, decodeMs: 3_000, decodeTokens: 60,
      }),
    })} />)
    const timePill = view.getAllByRole('button')[0]!
    // The pill speed is the latest answer's; the untimed window has none, so only the session average remains.
    expect(timePill.textContent).toBe('200 turns 200 steps')
    fireEvent.click(timePill)
    const dialog = view.getByRole('dialog')
    expect(dialog.textContent).toContain('LLM time1m40s')
    expect(dialog.textContent).toContain('Tool time1m2s')
    expect(dialog.textContent).toContain('Avg time to first token (TTFT)0.8s')
    expect(dialog.textContent).toContain('Avg tokens per second (TPS)20 tok/s')
  })

  it('omits the cache-hit segment when nothing was billed on the input side', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })} />)
    const usagePill = view.getAllByRole('button')[0]!
    expect(usagePill.textContent).toBe('7 tok')
    expect(usagePill.getAttribute('aria-label')).toBe('7 tok')
    // Output-only activity still fills the dialog's token rows.
    fireEvent.click(usagePill)
    expect(view.getByRole('dialog').textContent).toContain('Output7 tok')
  })

  it('includes cache writes in the total and the cache-hit denominator', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: {
        uncachedInputTokens: 10,
        outputTokens: 7,
        cacheReadTokens: 90,
        cacheWriteTokens: 100,
      },
    })} />)
    expect(view.getAllByRole('button')[0]!.textContent).toBe('207 tok·Cache hit 45%')
    // A session that did write cache keeps the row, exact.
    fireEvent.click(view.getAllByRole('button')[0]!)
    expect(view.getByRole('dialog').textContent).toContain('Cache write100 tok')
  })

  it('renders ZERO times during streaming chunk frames (RFC hard acceptance)', () => {
    const { set, source } = makeSource({ nodes: [assistant(1, 1)] })
    let renders = 0
    function Counting(p: StatPillProps) {
      renders += 1
      return <StatsPills {...p} />
    }
    render(<Counting {...props(source)} />)
    const before = renders
    // Chunk frames swap partial only; nodes keeps its reference (object-layer contract).
    act(() => { set({ partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'a' }] } }) })
    act(() => { set({ partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'ab' }] } }) })
    expect(renders).toBe(before)
  })
})

describe('latest step TTFT', () => {
  const timed = (seq: number, firstTokenTime: number | null, stepStartTime: number | null = seq * 1_000): AssistantMessageNode => ({
    ...assistant(seq, 1),
    timing: { stepStartTime, firstTokenTime, completedTime: seq * 1_000 + 5_000 },
  })

  it('reads the most recent settled step that recorded a TTFT', () => {
    expect(latestTtftMs([timed(1, 1_800), timed(2, 2_300)])).toBe(300)
  })

  it('skips steps without timing or without a first token', () => {
    expect(latestTtftMs([timed(1, 1_800), assistant(2, 1), timed(3, null), timed(4, 4_500, null)])).toBe(800)
  })

  it('is null when no step recorded a TTFT', () => {
    expect(latestTtftMs([assistant(1, 1)])).toBeNull()
    expect(latestTtftMs([])).toBeNull()
  })
})

describe('latest TTFT on the activity pill', () => {
  const USAGE = { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0 }
  const step = (seq: number, ttft: number): AssistantMessageNode => ({
    ...assistant(seq, 1, { outputTokens: 60 }),
    timing: { stepStartTime: seq * 10_000, firstTokenTime: seq * 10_000 + ttft, completedTime: seq * 10_000 + ttft + 3_000 },
  })
  const props = (source: ReturnType<typeof makeSource>['source']): StatPillProps => ({
    usePerformanceUsage: selector => selector('detailed'),
    useChat: bindSnapshotSelector(source),
    useProjection: (key: string) => (key === 'tokenUsage' ? USAGE : undefined),
    t: tEn,
  })

  it('shows the newest step TTFT beside tok/s and a dialog row next to the average', () => {
    const { source } = makeSource({ nodes: [step(1, 800), step(2, 3_200)] })
    const view = render(<StatsPills {...props(source)} />)
    const pill = view.getAllByRole('button')[0]!
    expect(pill.textContent).toBe('1 turns 2 steps·20 tok/s ·TTFT 3.2s')
    expect(pill.getAttribute('aria-label')).toBe('1 turns 2 steps · 20 tok/s · TTFT 3.2s')
    fireEvent.click(pill)
    const details = view.getByRole('dialog').querySelector('[data-session-stats-details]') as HTMLElement
    expect(details.textContent).toContain('Avg time to first token (TTFT)2s')
    expect(details.textContent).toContain('Latest time to first token (TTFT)3.2s')
  })

  /** Text an accessibility tree exposes: aria-hidden subtrees drop out. */
  function accessibleText(node: Node): string {
    if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return ''
    return [...node.childNodes].map(child => child.nodeType === Node.TEXT_NODE ? child.textContent ?? '' : accessibleText(child)).join('')
  }
  const separators = (root: HTMLElement) => [...root.querySelectorAll('span')].filter(element => element.textContent === '·')

  it('keeps tok/s and the TTFT reading apart in the accessible text while separators stay hidden', () => {
    const { source } = makeSource({ nodes: [step(1, 800)] })
    const view = render(<StatsPills {...props(source)} usePerformanceUsage={selector => selector('compact')} />)
    const pill = view.container.querySelector<HTMLElement>('[data-composer-stat="activity"]')!
    // Hidden separators would otherwise fuse the readings into "tok/sTTFT"; the scaffold normalizer needs "tok/s ".
    expect(accessibleText(pill)).toBe('20 tok/s TTFT 0.8s')
    expect(separators(pill).every(sep => sep.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('keeps the accessible text of a pill without TTFT as it was', () => {
    // Decode timing without a step start: the speed is known, the TTFT is not.
    const untimedStart: AssistantMessageNode = {
      ...assistant(1, 1, { outputTokens: 60 }),
      timing: { stepStartTime: null, firstTokenTime: 1_000, completedTime: 4_000 },
    }
    const { source } = makeSource({ nodes: [untimedStart] })
    const view = render(<ActivityPill {...props(source)} useProjection={(key: string) => (key === 'sessionStats'
      ? { turns: 1, steps: 1, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 3_000, decodeTokens: 60 }
      : undefined)} />)
    const pill = view.container.querySelector<HTMLElement>('[data-composer-stat="activity"]')!
    expect(accessibleText(pill)).toBe('1 turns 1 steps20 tok/s')
    expect(separators(pill)).toHaveLength(1)
    expect(separators(pill).every(sep => sep.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('keeps the TTFT in compact mode and localizes it', () => {
    const { source } = makeSource({ nodes: [step(1, 800)] })
    const view = render(<StatsPills {...props(source)} usePerformanceUsage={selector => selector('compact')} />)
    expect(view.container.textContent).toBe('20 tok/s ·TTFT 0.8sCache hit 90%')
    cleanup()
    const zhView = render(<StatsPills {...props(source)} t={t} />)
    expect(zhView.getAllByRole('button')[0]!.textContent).toBe('1 轮 1 步·20 tok/s ·TTFT 0.8秒')
  })

  it('omits the segment and row when no step recorded a TTFT', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source)} />)
    expect(view.container.textContent).not.toContain('TTFT')
  })
})

describe('latest answer speed', () => {
  /** A settled step whose timing yields exactly `decodeMs` of decode time. */
  const step = (seq: number, turn: number, outputTokens: number, decodeMs: number): AssistantMessageNode => ({
    ...assistant(seq, turn, { outputTokens }),
    timing: { stepStartTime: seq * 10_000, firstTokenTime: seq * 10_000 + 500, completedTime: seq * 10_000 + 500 + decodeMs },
  })
  /** The live-settled shape: transient chunks are gone, so only the display latency survives. */
  const liveSettled = (seq: number, turn: number, outputTokens: number, decodeMs: number): AssistantMessageNodeWithLatency => ({
    ...assistant(seq, turn, { outputTokens }),
    timing: { stepStartTime: seq * 10_000, firstTokenTime: null, completedTime: seq * 10_000 + 500 + decodeMs },
    firstTokenLatencyMs: 500,
  })

  it('weights the newest turn by tokens and ignores earlier turns', () => {
    const nodes = [step(1, 1, 38, 1_580), step(2, 2, 117, 2_810), step(3, 2, 160, 3_590)]
    expect(latestAnswerTokensPerSecond(nodes)).toBeCloseTo(277 / 6.4, 6)
  })

  it('reads the decode time of live-settled steps from the display latency', () => {
    expect(latestAnswerTokensPerSecond([liveSettled(1, 1, 100, 2_000)])).toBeCloseTo(50, 6)
    expect(latestAnswerTokensPerSecond([step(1, 1, 38, 1_580), liveSettled(2, 2, 117, 2_810), step(3, 2, 160, 3_590)]))
      .toBeCloseTo(277 / 6.4, 6)
  })

  it('counts only steps with both decode time and output tokens', () => {
    const noTokens = step(3, 2, 0, 9_000)
    const noUsage: AssistantMessageNode = {
      ...assistant(4, 2), timing: { stepStartTime: 40_000, firstTokenTime: 40_500, completedTime: 49_500 },
    }
    const noTiming = assistant(5, 2, { outputTokens: 500 })
    const counted = step(2, 2, 100, 2_000)
    // Only `counted` has both: the zero-token step adds neither tokens nor its 9 s of decode time.
    expect(latestAnswerTokensPerSecond([step(1, 1, 38, 1_580), counted, noUsage, noTiming, noTokens]))
      .toBeCloseTo(50, 6)
  })

  it('falls back to an earlier turn when the newest turn produced no output tokens', () => {
    expect(latestAnswerTokensPerSecond([step(1, 1, 38, 1_580), step(2, 2, 0, 3_000)])).toBeCloseTo(38 / 1.58, 6)
    expect(latestAnswerTokensPerSecond([step(1, 1, 0, 1_000)])).toBeNull()
  })

  it('prefers the current attempt first token time over the step first token time', () => {
    const retried: AssistantMessageNodeWithLatency = { ...step(1, 1, 100, 6_000), attemptFirstTokenTime: 10_000 + 500 + 4_000 }
    // Decode runs from the retried attempt's first token (4 s into the failed step) to completion: 2 s.
    expect(latestAnswerTokensPerSecond([retried])).toBeCloseTo(50, 6)
    const liveSettledRetried: AssistantMessageNodeWithLatency = { ...liveSettled(1, 1, 100, 6_000), attemptFirstTokenTime: 14_500 }
    expect(latestAnswerTokensPerSecond([liveSettledRetried])).toBeCloseTo(50, 6)
  })

  it('falls back to the newest turn that has timing and is null without one', () => {
    expect(latestAnswerTokensPerSecond([step(1, 1, 38, 1_580), assistant(2, 2, { outputTokens: 50 })]))
      .toBeCloseTo(38 / 1.58, 6)
    expect(latestAnswerTokensPerSecond([assistant(1, 1, { outputTokens: 5 })])).toBeNull()
    expect(latestAnswerTokensPerSecond([])).toBeNull()
  })

  it('falls back to an earlier turn when the newest turn has only a non-positive-decode step', () => {
    expect(latestAnswerTokensPerSecond([step(1, 1, 38, 1_580), step(2, 2, 50, 0)])).toBeCloseTo(38 / 1.58, 6)
  })

  it('sums only the newest turn when tool results and other turns interleave', () => {
    const tool: ToolResultNode = {
      kind: 'tool-result', seq: 9, time: 9_000, callId: 'c', call: null, callTime: 4_000, content: [],
      name: '', args: PartialArguments.EMPTY, isError: false, subCalls: [],
    }
    const nodes = [step(1, 1, 38, 1_580), step(2, 2, 100, 2_000), tool, step(3, 1, 20, 1_000), step(4, 2, 100, 2_000)]
    // Walking from the end: turn 2 steps (seq 4, 2) count; the turn 1 step between them does not.
    expect(latestAnswerTokensPerSecond(nodes)).toBeCloseTo(50, 6)
    expect(latestAnswerTokensPerSecond([step(1, 1, 38, 1_580), tool])).toBeCloseTo(38 / 1.58, 6)
  })

  it('skips a live-settled step without a step start or whose latency exceeds its duration', () => {
    const noStart: AssistantMessageNodeWithLatency = {
      ...liveSettled(2, 2, 100, 2_000), timing: { stepStartTime: null, firstTokenTime: null, completedTime: 30_000 },
    }
    const negative: AssistantMessageNodeWithLatency = {
      ...liveSettled(3, 3, 100, 2_000), firstTokenLatencyMs: 99_000,
    }
    expect(latestAnswerTokensPerSecond([step(1, 1, 38, 1_580), noStart])).toBeCloseTo(38 / 1.58, 6)
    expect(latestAnswerTokensPerSecond([step(1, 1, 38, 1_580), negative])).toBeCloseTo(38 / 1.58, 6)
    expect(latestAnswerTokensPerSecond([noStart])).toBeNull()
  })

  it('prefers the recorded first token time over the display latency', () => {
    const both: AssistantMessageNodeWithLatency = { ...step(1, 1, 100, 2_000), firstTokenLatencyMs: 1_500 }
    expect(latestAnswerTokensPerSecond([both])).toBeCloseTo(50, 6)
  })

  it('mixes live-settled and replayed steps of one turn token-weighted', () => {
    expect(latestAnswerTokensPerSecond([liveSettled(1, 1, 100, 2_000), step(2, 1, 60, 1_000), liveSettled(3, 1, 40, 1_000)]))
      .toBeCloseTo(200 / 4, 6)
  })

  it('reports a very short step without clamping the rate', () => {
    expect(latestAnswerTokensPerSecond([step(1, 1, 10, 1)])).toBeCloseTo(10_000, 6)
  })

  describe('on the activity pill', () => {
    const USAGE = { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0 }
    const props = (source: ReturnType<typeof makeSource>['source'], mode: 'detailed' | 'compact' = 'detailed'): StatPillProps => ({
      usePerformanceUsage: selector => selector(mode),
      useChat: bindSnapshotSelector(source),
      useProjection: (key: string) => (key === 'tokenUsage' ? USAGE : undefined),
      t: tEn,
    })
    const slowThenFast = () => [step(1, 1, 38, 1_580), step(2, 2, 117, 2_810), step(3, 2, 160, 3_590)]

    it('shows the latest answer speed, not the session average, and keeps the average in the dialog', () => {
      const { source } = makeSource({ nodes: slowThenFast() })
      const view = render(<StatsPills {...props(source)} />)
      const pill = view.getAllByRole('button')[0]!
      // Session average would be 315 / 7.98 = 39.5; the latest answer is 277 / 6.4 = 43.3.
      expect(pill.textContent).toBe('2 turns 3 steps·43 tok/s ·TTFT 0.5s')
      fireEvent.click(pill)
      const details = view.getByRole('dialog').querySelector('[data-session-stats-details]') as HTMLElement
      expect(details.textContent).toContain('Avg tokens per second (TPS)39 tok/s')
      expect(details.textContent).toContain('Latest answer tokens per second (TPS)43 tok/s')
    })

    it('keeps the previous answer value while the new turn has settled nothing', () => {
      const { source, set } = makeSource({ nodes: slowThenFast() })
      const view = render(<StatsPills {...props(source)} />)
      act(() => { set({ partial: { turn: 3, step: 1, blocks: [{ kind: 'text', text: 'streaming' }] } }) })
      expect(view.getAllByRole('button')[0]!.textContent).toContain('43 tok/s')
    })

    it('shows the live-settled value, and the same value for a step with a recorded first token time', () => {
      const live = makeSource({ nodes: [liveSettled(1, 1, 100, 2_000)] })
      const view = render(<StatsPills {...props(live.source)} />)
      expect(view.getAllByRole('button')[0]!.textContent).toContain('50 tok/s')
      view.unmount()
      const replayed = makeSource({ nodes: [step(1, 1, 100, 2_000)] })
      const again = render(<StatsPills {...props(replayed.source)} />)
      expect(again.getAllByRole('button')[0]!.textContent).toContain('50 tok/s')
    })

    it('omits the speed segment when no turn has timing', () => {
      const { source } = makeSource({ nodes: [assistant(1, 1, { outputTokens: 5 })] })
      const view = render(<StatsPills {...props(source)} />)
      expect(view.container.textContent).toContain('1 turns 1 steps')
      expect(view.container.textContent).not.toContain('tok/s')
    })

    it('uses the latest answer speed in compact mode', () => {
      const { source } = makeSource({ nodes: slowThenFast() })
      const view = render(<StatsPills {...props(source, 'compact')} />)
      expect(view.container.textContent).toContain('43 tok/s ·TTFT 0.5s')
    })

    it('labels the answer row in the active locale', () => {
      const { source } = makeSource({ nodes: slowThenFast() })
      const view = render(<StatsPills {...props(source)} t={t} />)
      fireEvent.click(view.getAllByRole('button')[0]!)
      expect(view.getByRole('dialog').textContent).toContain('本次回答输出速度（TPS）43 tok/s')
    })
  })
})
