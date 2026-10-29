import { useSyncExternalStore } from 'react'
import type { ChatNodeDataMap } from '../contract/chat-nodes.ts'
import type { ChatNodeStore } from '../contract/snapshot.ts'

const NO_STEPS: readonly never[] = []
const EMPTY_SOURCE = { getSnapshot: () => NO_STEPS, subscribe: () => () => {} }

/**
 * Subscribe to the first-token wait of a Turn's newest Assistant step, including its hidden pre-token Node.
 * @param nodes - Chat node store.
 * @param turn - Turn to observe, or absence while no Turn is loaded.
 * @returns the session-clock start of the wait, or undefined once a token arrived or the step settled.
 */
export function useWaitingSince(nodes: ChatNodeStore, turn: number | undefined): number | undefined {
  const source = turn === undefined ? EMPTY_SOURCE : nodes.turnDataSource(turn, 'assistant-step')
  const steps: readonly ChatNodeDataMap['assistant-step'][] = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const latest = steps.at(-1)
  return latest?.status === 'running' ? latest.waitingSince : undefined
}
