// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantChatData } from '../src/client/contract/chat-nodes.ts'
import { useWaitingSince, type AssistantStepSource } from '../src/client/chat/use-waiting-since.ts'

afterEach(cleanup)

function scriptedStore(initial: AssistantChatData) {
  let steps: readonly AssistantChatData[] = [initial]
  const listeners = new Set<() => void>()
  const store: AssistantStepSource = {
    turnDataSource: () => ({
      getSnapshot: () => steps,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }),
  }
  return {
    store,
    /** Publish a new array, as the real turn collection does on every streamed delta. */
    publish: (next: AssistantChatData) => {
      steps = [next]
      for (const listener of [...listeners]) listener()
    },
  }
}

const step = (patch: Partial<AssistantChatData>): AssistantChatData => ({
  status: 'running', turn: 1, step: 1, blocks: [], time: 0, ...patch,
})

describe('useWaitingSince', () => {
  it('re-renders only when the wait itself changes, not on every streamed delta', () => {
    const source = scriptedStore(step({ waitingSince: 100 }))
    let renders = 0
    const seen: Array<number | undefined> = []
    function Probe() {
      renders++
      seen.push(useWaitingSince(source.store, 1))
      return null
    }
    render(<Probe />)
    expect(renders).toBe(1)
    act(() => { source.publish(step({ waitingSince: 100, blocks: [{ kind: 'text', text: 'a' }] })) })
    act(() => { source.publish(step({ waitingSince: 100, blocks: [{ kind: 'text', text: 'ab' }] })) })
    expect(renders).toBe(1)
    act(() => { source.publish(step({ blocks: [{ kind: 'text', text: 'abc' }] })) })
    expect(seen.at(-1)).toBeUndefined()
    expect(renders).toBe(2)
    act(() => { source.publish(step({ blocks: [{ kind: 'text', text: 'abcd' }] })) })
    expect(renders).toBe(2)
  })
})
