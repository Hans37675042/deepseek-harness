// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { RunningStatus } from '../src/client/chat/RunningStatus.tsx'
import { zh } from '../src/client/locale.ts'

const t = makeTranslate(zh, commonZh)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(5_000) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function statusHarness(startTime?: number) {
  const view = render(<RunningStatus startTime={startTime} paused={false} t={t} />)
  return {
    ...view,
    content: () => view.container.querySelector('[data-chat-running] > :last-child'),
    set: (nextStartTime?: number, paused = false) => {
      view.rerender(<RunningStatus startTime={nextStartTime} paused={paused} t={t} />)
    },
  }
}

describe('RunningStatus', () => {
  it('waits for an open Turn start before allocating its clock', () => {
    const view = statusHarness()
    expect(view.content()?.textContent).toBe('深度求索中')
    expect(vi.getTimerCount()).toBe(0)
    view.set(1_000)
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.content()?.querySelectorAll('[data-shimmer="true"]')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    view.set()
    expect(view.content()?.textContent).toBe('深度求索中')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the indicator mounted while a continuous run moves to the next Turn', () => {
    const view = statusHarness(1_000)
    const content = view.content()
    const status = view.getByRole('status')
    const initialText = content?.textContent
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(content?.textContent).not.toBe(initialText)
    view.set(7_000)
    expect(view.content()).toBe(content)
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(vi.getTimerCount()).toBe(1)
    const nextTurnText = content?.textContent
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(content?.textContent).not.toBe(nextTurnText)
    expect(view.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('深度求索中')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the duration nonnegative when the start is ahead of the local clock', () => {
    const view = statusHarness(6_000)
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.content()?.textContent).not.toContain('-')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(view.content()?.textContent).toMatch(/^深度求索中，用时 \d+秒 ···$/)
    expect(view.content()?.textContent).not.toContain('-')
  })

  it('freezes the duration while paused and resumes from the Turn start', () => {
    const view = statusHarness(1_000)
    expect(view.content()?.textContent).toBe('深度求索中，用时 4秒 ···')
    view.set(1_000, true)
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(view.content()?.textContent).toBe('深度求索中，用时 4秒 ···')
    view.set(1_000)
    expect(view.content()?.textContent).toBe('深度求索中，用时 9秒 ···')
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('RunningStatus waiting for the first token', () => {
  const waitingView = (waitingSince?: number, paused = false, holding = false) =>
    <RunningStatus startTime={1_000} waitingSince={waitingSince} paused={paused} holding={holding} t={t} />

  it('replaces the running label with a ticking wait from the attempt start, then restores it', () => {
    const view = render(waitingView(2_000))
    const content = () => view.container.querySelector('[data-chat-running] > :last-child')
    // Anchored to the local clock when the wait appears, so the Host event time (2_000) does not matter.
    expect(content()?.textContent).toBe('等待首个 token：1秒 ···')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content()?.textContent).toBe('等待首个 token：2秒 ···')
    expect(vi.getTimerCount()).toBe(1)
    view.rerender(waitingView(undefined))
    expect(content()?.textContent).toBe('深度求索中，用时 6秒 ···')
  })

  it('restarts the shown wait when a retry moves the attempt start', () => {
    const view = render(waitingView(2_000))
    act(() => { vi.advanceTimersByTime(4_000) })
    view.rerender(waitingView(9_000))
    expect(view.container.querySelector('[data-chat-running] > :last-child')?.textContent).toBe('等待首个 token：1秒 ···')
  })

  it('clears its interval on unmount and when the wait ends', () => {
    const view = render(waitingView(2_000))
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    const noClock = render(<RunningStatus startTime={undefined} waitingSince={2_000} paused={false} t={t} />)
    expect(vi.getTimerCount()).toBe(1)
    noClock.rerender(<RunningStatus startTime={undefined} waitingSince={undefined} paused={false} t={t} />)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the paused and holding behaviour', () => {
    const view = render(waitingView(2_000, true))
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(view.container.querySelector('[data-chat-running] > :last-child')?.textContent).toBe('等待首个 token：1秒 ···')
    view.rerender(waitingView(2_000, false, true))
    expect(vi.getTimerCount()).toBe(0)
    expect(view.container.querySelector('[data-chat-running]')?.getAttribute('aria-hidden')).toBe('true')
  })
})
