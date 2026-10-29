import { useSyncExternalStore } from 'react'
import type { AssistantChatData } from '../contract/chat-nodes.ts'

/** The slice of the Chat node store this hook reads: one Turn's Assistant step data. */
export interface AssistantStepSource {
  turnDataSource: (turn: number, kind: 'assistant-step') => {
    getSnapshot: () => readonly AssistantChatData[]
    subscribe: (listener: () => void) => () => void
  }
}

const NO_STEPS: readonly never[] = []
const EMPTY_SOURCE = { getSnapshot: () => NO_STEPS, subscribe: () => () => {} }

/**
 * Subscribe to the first-token wait of a Turn's newest Assistant step, including its hidden pre-token Node.
 * @param nodes - Chat node store; only its per-Turn collection source is read.
 * @param turn - Turn to observe, or absence while no Turn is loaded.
 * @returns the session-clock start of the wait, or undefined once a token arrived or the step settled.
 */
export function useWaitingSince(nodes: AssistantStepSource, turn: number | undefined): number | undefined {
  const source = turn === undefined ? EMPTY_SOURCE : nodes.turnDataSource(turn, 'assistant-step')
  // The turn collection is rebuilt on every delta; a primitive snapshot keeps the Flow from re-rendering per frame.
  return useSyncExternalStore(source.subscribe, () => {
    const latest = source.getSnapshot().at(-1)
    return latest?.status === 'running' ? latest.waitingSince : undefined
  })
}
