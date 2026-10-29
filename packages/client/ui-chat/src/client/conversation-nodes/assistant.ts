import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantBlock, AssistantMessageNode, ConversationLocation, ConversationMatch,
  ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm/assistant-stream'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AssistantChatData, AssistantMessageNodeWithLatency } from '../contract/chat-nodes.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'
import {
  emptyAssistantBlock, isTokenDelta, toAssistantBlock, toAssistantBlocks,
} from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Streaming, settled, or interrupted Assistant step. */
    'assistant-step': AssistantChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationStepDataMap {
    /** Streaming, settled, or interrupted Assistant material for this Step. */
    'assistant-step': AssistantChatData
  }
}

interface AssistantState {
  readonly turn: number
  readonly step: number
  readonly blocks: readonly (AssistantBlock | undefined)[]
  readonly visibleBlocks: number
  readonly firstVisibleSeq: number | undefined
  readonly firstVisibleTime: number | undefined
  readonly firstTokenTime: number | undefined
  /** Start of the current request attempt while it has produced no token delta; cleared by the first one. */
  readonly waitSince: number | undefined
  /** First token time read from a durable stream; display-only, so live-chunk `firstTokenTime` stays authoritative. */
  readonly streamFirstTokenTime: number | undefined
  readonly final: ConversationMatch | undefined
  readonly usage: unknown
}

function initialState(turn: number, step: number, waitSince?: number): AssistantState {
  return {
    turn,
    step,
    blocks: [],
    visibleBlocks: 0,
    firstVisibleSeq: undefined,
    firstVisibleTime: undefined,
    firstTokenTime: undefined,
    waitSince,
    streamFirstTokenTime: undefined,
    final: undefined,
    usage: undefined,
  }
}

function compactBlocks(blocks: readonly (AssistantBlock | undefined)[]): AssistantBlock[] {
  return blocks.filter((block): block is AssistantBlock => block !== undefined)
}

function blockIsVisible(block: AssistantBlock | undefined): boolean {
  if (block === undefined || block.kind === 'tool-call') return false
  if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
  return true
}

function countVisibleBlocks(blocks: readonly AssistantBlock[]): number {
  let count = 0
  for (const block of blocks) if (blockIsVisible(block)) count++
  return count
}

function hasVisibleContent(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some(blockIsVisible)
}

function hasInterruptionEvidence(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
    return true
  })
}

/** The retry restarts only the live wait; `firstTokenTime` keeps the first attempt's value so settled timing is unchanged. */
function resetForRetry(state: AssistantState, time: number): AssistantState {
  return {
    ...initialState(state.turn, state.step, time),
    firstTokenTime: state.firstTokenTime,
  }
}

function updateChunk(
  state: AssistantState,
  chunk: StreamChunk,
  seq: number,
  time: number,
): AssistantState {
  if (chunk.type === 'tool-call-delta') {
    const previous = state.blocks[chunk.index]
    if (previous?.kind === 'tool-call' && previous.callId !== ''
      && (chunk.name === undefined || chunk.name === previous.name)
      && (state.firstTokenTime !== undefined || !isTokenDelta(chunk))) {
      // A retried attempt inherits the first attempt's `firstTokenTime`, so this attempt's first token ends the wait here.
      return state.waitSince !== undefined && isTokenDelta(chunk) ? { ...state, waitSince: undefined } : state
    }
  }
  const blocks = [...state.blocks]
  let changedIndex = -1
  let previousVisible = false
  switch (chunk.type) {
    case 'block-start':
      changedIndex = chunk.index
      previousVisible = blockIsVisible(blocks[chunk.index])
      blocks[chunk.index] = emptyAssistantBlock(chunk.blockType)
      break
    case 'text-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      blocks[chunk.index] = { kind: 'text', text: (previous?.kind === 'text' ? previous.text : '') + chunk.text }
      break
    }
    case 'reasoning-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      blocks[chunk.index] = { kind: 'reasoning', text: (previous?.kind === 'reasoning' ? previous.text : '') + chunk.text }
      break
    }
    case 'tool-call-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      // Tool Nodes own streamed arguments; Assistant protocol blocks retain identity until full settlement.
      blocks[chunk.index] = {
        kind: 'tool-call',
        callId: (previous?.kind === 'tool-call' ? previous.callId : '') || String(chunk.id),
        name: chunk.name ?? (previous?.kind === 'tool-call' ? previous.name : ''),
        argsRaw: previous?.kind === 'tool-call' ? previous.argsRaw : '',
      }
      break
    }
    case 'block-end':
      changedIndex = chunk.index
      previousVisible = blockIsVisible(blocks[chunk.index])
      blocks[chunk.index] = toAssistantBlock(chunk.block)
      break
    case 'usage':
      return { ...state, usage: chunk.usage }
    default:
      return state
  }
  const visibleBlocks = state.visibleBlocks
    - Number(previousVisible)
    + Number(blockIsVisible(blocks[changedIndex]))
  const firstToken = isTokenDelta(chunk)
  return {
    ...state,
    blocks,
    visibleBlocks,
    ...visibleBlocks > 0 && state.firstVisibleSeq === undefined
      ? { firstVisibleSeq: seq, firstVisibleTime: time }
      : {},
    ...firstToken && state.firstTokenTime === undefined
      ? { firstTokenTime: time }
      : {},
    ...firstToken ? { waitSince: undefined } : {},
  }
}

/** Read the durable stream's first token; a stream that carries one ends the live wait. */
function settleStream(
  state: AssistantState,
  event: SessionEvent<'assistant/message' | 'assistant/attempt'>,
): AssistantState {
  const streamFirstTokenTime = state.streamFirstTokenTime ?? assistantStreamFirstTokenTime(event.data.stream)
  return {
    ...state,
    streamFirstTokenTime,
    ...streamFirstTokenTime === undefined ? {} : { waitSince: undefined },
  }
}

function settleMessage(
  state: AssistantState,
  match: ConversationMatch,
  event: SessionEvent<'assistant/message'>,
): AssistantState {
  const blocks = toAssistantBlocks(event.data.message.content)
  return {
    ...settleStream(state, event),
    blocks,
    visibleBlocks: countVisibleBlocks(blocks),
    final: match,
    usage: event.data.usage,
  }
}

function closedBoundary(location: ConversationLocation): { seq: number; time: number } | undefined {
  if (location.kind === 'step' && location.step.status === 'closed' && location.step.end !== undefined) {
    return location.step.end
  }
  if ((location.kind === 'step' || location.kind === 'turn')
    && location.turn.status === 'closed' && location.turn.end !== undefined) {
    return location.turn.end
  }
  return undefined
}

function boundaryClosed(context: ConversationNodeContext<AssistantState>): boolean {
  const location = context.start?.location ?? context.matches.at(-1)?.location
  return location !== undefined && closedBoundary(location) !== undefined
}

function firstTokenLatency(
  state: AssistantState,
  context: ConversationNodeContext<AssistantState>,
): number | undefined {
  const first = state.firstTokenTime ?? state.streamFirstTokenTime
  const start = context.start?.event.time
  return first === undefined || start === undefined ? undefined : Math.max(0, first - start)
}

function finalNode(
  state: AssistantState,
  context: ConversationNodeContext<AssistantState>,
): AssistantMessageNodeWithLatency | undefined {
  const final = state.final
  if (final?.event.type === 'assistant/message') {
    const event = final.event
    const latencyMs = firstTokenLatency(state, context)
    return {
      kind: 'assistant',
      seq: event.seq,
      messageId: event.data.message.id,
      time: event.time,
      turn: state.turn,
      step: state.step,
      blocks: toAssistantBlocks(event.data.message.content),
      usage: event.data.usage,
      timing: {
        stepStartTime: context.start?.event.time ?? null,
        firstTokenTime: state.firstTokenTime ?? null,
        completedTime: event.time,
      },
      ...latencyMs === undefined ? {} : { firstTokenLatencyMs: latencyMs },
      ...event.data.interrupted === true ? { interrupted: true } : {},
    }
  }
  const location = context.start?.location ?? context.matches.at(-1)?.location
  const boundary = location === undefined ? undefined : closedBoundary(location)
  if (boundary === undefined) return undefined
  const blocks = compactBlocks(state.blocks)
  if (!hasInterruptionEvidence(blocks)) return undefined
  return {
    kind: 'assistant',
    seq: boundary.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedAssistant,
    time: boundary.time,
    turn: state.turn,
    step: state.step,
    blocks,
    interrupted: true,
  }
}

function fallbackState(context: ConversationNodeContext<AssistantState>): AssistantState | undefined {
  let state: AssistantState | undefined
  for (const match of context.matches) {
    if (match.event.type === 'assistant/live-chunk') {
      state ??= initialState(match.event.data.turn, match.event.data.step)
      state = updateChunk(state, match.event.data.chunk, match.event.seq, match.event.time)
      continue
    }
    if (match.event.type === 'assistant/message') {
      state ??= initialState(match.event.data.turn, match.event.data.step)
      state = settleMessage(state, match, match.event)
      continue
    }
    if (match.event.type === 'assistant/attempt' && state !== undefined) {
      state = settleStream(state, match.event)
      continue
    }
    if (match.event.type === 'llm/retry' && state !== undefined) {
      state = resetForRetry(state, match.event.time)
    }
  }
  return state
}

interface AssistantProjection {
  readonly data: AssistantChatData
  readonly anchorSeq: number
  readonly visible: boolean
  readonly settled: AssistantMessageNode | undefined
}

function projectAssistant(context: ConversationNodeContext<AssistantState>): AssistantProjection | undefined {
  const state = context.state ?? fallbackState(context)
  if (state === undefined) return undefined
  const settled = finalNode(state, context)
  const blocks = settled?.blocks ?? compactBlocks(state.blocks)
  const visible = settled === undefined ? state.visibleBlocks > 0 : hasVisibleContent(blocks)
  const status = settled?.interrupted === true
    ? 'interrupted'
    : settled === undefined ? 'running' : 'settled'
  const anchorSeq = (settled?.interrupted === true ? settled.seq : state.firstVisibleSeq ?? settled?.seq)
    ?? context.matches[0]?.event.seq ?? 0
  const time = settled?.time ?? state.firstVisibleTime ?? context.matches[0]?.event.time ?? 0
  return {
    anchorSeq,
    visible,
    settled,
    data: {
      status,
      turn: state.turn,
      step: state.step,
      blocks,
      time,
      ...state.usage === undefined ? {} : { usage: state.usage },
      ...settled === undefined && state.waitSince !== undefined && !boundaryClosed(context)
        ? { waitingSince: state.waitSince }
        : {},
      ...settled === undefined ? {} : { finalNode: settled },
    },
  }
}

function publishedAssistantData(
  context: ConversationNodeContext<AssistantState>,
): Readonly<AssistantChatData> | undefined {
  const location = context.start?.location ?? context.matches.at(-1)?.location
  return location?.kind === 'step' ? location.step.data.get('assistant-step') : undefined
}

/** Per-step Assistant lifecycle; materialized keys survive cleared stream content as hidden Nodes. */
export const assistantDefinition: ConversationNodeDefinition<AssistantState> = {
  kind: 'assistant-step',
  target: 'chat',
  match: (event) => {
    if (event.type === 'step/start') return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
    if (event.type === 'assistant/live-chunk'
      || event.type === 'assistant/attempt'
      || (event.type === 'assistant/message' && event.surfaceOp === 'append')) {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    if (event.type === 'llm/retry') {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') throw new Error('assistant-step start requires step/start')
    return initialState(match.event.data.turn, match.event.data.step, match.event.time)
  },
  update: (context, match) => {
    if (match.event.type === 'assistant/live-chunk') {
      return updateChunk(context.state, match.event.data.chunk, match.event.seq, match.event.time)
    }
    if (match.event.type === 'assistant/message') return settleMessage(context.state, match, match.event)
    if (match.event.type === 'assistant/attempt') return settleStream(context.state, match.event)
    if (match.event.type === 'llm/retry') {
      return resetForRetry(context.state, match.event.time)
    }
    return context.state
  },
  publication: (match) => {
    if (match.event.type === 'step/start') return 'immediate'
    if (match.event.type !== 'assistant/live-chunk') return 'immediate'
    const type = match.event.data.chunk.type
    return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame'
  },
  buildLocationData: (context, scope) => {
    if (scope !== 'step') return null
    const projected = projectAssistant(context)
    if (projected === undefined) return null
    return {
      kind: 'step',
      turn: projected.data.turn,
      step: projected.data.step,
      key: 'assistant-step',
      value: projected.data,
    }
  },
  buildViewNode: (context) => {
    const current = context.current.get('chat')
    const state = context.state ?? fallbackState(context)
    const data = publishedAssistantData(context)
    if (state === undefined || data === undefined) {
      return current == null ? null : { ...current, visibility: 'hidden' }
    }
    const settled = data.finalNode
    const visible = settled === undefined ? state.visibleBlocks > 0 : hasVisibleContent(data.blocks)
    if (settled === undefined && !visible && current == null && data.waitingSince === undefined) return null
    // A successful message retains its live anchor alongside pending Tool calls.
    const anchorSeq = (settled?.interrupted === true ? settled.seq : state.firstVisibleSeq ?? settled?.seq)
      ?? context.matches[0]?.event.seq ?? 0
    return chatNode(context, 'assistant-step', anchorSeq, data, {
      visibility: settled?.interrupted === true || visible ? 'visible' : 'hidden',
    })
  },
}

/**
 * Register the Assistant lifecycle business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerAssistantConversationNode(ctx: Context): void {
  const match = assistantDefinition.match.bind(assistantDefinition)
  ctx.uiConversation.events.register({
    ...assistantDefinition,
    match: {
      'step/start': match,
      'assistant/live-chunk': match,
      'assistant/message': match,
      'assistant/attempt': match,
      'llm/retry': match,
    },
  })
}
