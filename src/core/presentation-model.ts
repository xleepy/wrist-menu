import {
  createPresentationItems,
  type HostSnapshot,
  type MenuDefinitionEntry,
  type MenuInteraction,
  type PresentationItem,
} from './host-snapshot.js'
import type { RevealPhase } from './reveal-state.js'
import { VISIBLE_SLOTS } from './scroll-state.js'
import { resolveThemeTokens, type ThemeTokens } from './theme.js'
import type { WristAnchorPose } from './wrist-anchor.js'

/** Read-only output consumed by Renderer Integrations. */
export type PresentationModel = Readonly<{
  visible: boolean
  targetable: boolean
  opacity: number
  revealPhase: RevealPhase
  anchorPose: WristAnchorPose | null
  revision: number
  items: readonly PresentationItem[]
  scrollOffset: number
  totalRows: number
  visibleSlots: number
  scrollBarrierActive: boolean
  /** Fully resolved visual tokens; never changes Menu Definition semantics. */
  theme: ThemeTokens
}>

type CreatePresentationModelInput = Readonly<{
  snapshot: HostSnapshot
  visible: boolean
  targetable: boolean
  opacity: number
  revealPhase: RevealPhase
  anchorPose: WristAnchorPose | null
  revision: number
  interactionFor: (itemId: string) => MenuInteraction
  scrollOffset: number
  visibleSlots: number
  scrollBarrierActive: boolean
}>

export function countMenuRows(
  menuDefinition: readonly MenuDefinitionEntry[],
): number {
  return menuDefinition.reduce(
    (count, entry) =>
      count +
      (entry.type === 'choice-group' ? entry.options.length + 1 : 1),
    0,
  )
}

export function createPresentationModel(
  input: CreatePresentationModelInput,
): PresentationModel {
  return Object.freeze({
    visible: input.visible,
    targetable: input.targetable,
    opacity: input.opacity,
    revealPhase: input.revealPhase,
    anchorPose: input.anchorPose,
    revision: input.revision,
    items: createPresentationItems(
      input.snapshot.menuDefinition,
      input.interactionFor,
    ),
    scrollOffset: input.scrollOffset,
    totalRows: countMenuRows(input.snapshot.menuDefinition),
    visibleSlots: input.visibleSlots,
    scrollBarrierActive: input.scrollBarrierActive,
    theme: resolveThemeTokens(input.snapshot.theme),
  })
}

export function createInitialPresentationModel(
  snapshot: HostSnapshot,
  revision: number,
): PresentationModel {
  return createPresentationModel({
    snapshot,
    visible: false,
    targetable: false,
    opacity: 0,
    revealPhase: 'hidden',
    anchorPose: null,
    revision,
    interactionFor: () => 'idle',
    scrollOffset: 0,
    visibleSlots: VISIBLE_SLOTS,
    scrollBarrierActive: false,
  })
}
