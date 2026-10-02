import {
  draggable,
  dropTargetForElements,
  monitorForElements,
  type ElementEventBasePayload,
} from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter";
import { cn } from "cn";
import { GripVerticalIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  canReceiveChild,
  getNodeProperty,
  nodeById,
  type DocumentModel,
  type EditorNode,
} from "@/editor/document-model";

/**
 * Drag and drop over the editor's tree: the handle you pick up with, the zone
 * each node is a target for, and the indicator that says where the node lands.
 *
 * The mechanism is `@atlaskit/pragmatic-drag-and-drop`, and it is worth saying
 * exactly what that bought and what it did not.
 *
 * **Bought: the drag is not a set of hand-written HTML5 handlers.** The library
 * owns hit-testing, the drag preview, the drop-target ledger, and the ordering
 * of nested targets (it reports them innermost-first, which is the "nearest
 * zone answers" rule this file used to implement by stopping propagation). Its
 * core is framework-free, so nothing about React 19's event system is involved.
 *
 * **Not bought: keyboard dragging.** Its element adapter is native HTML5 drag
 * end to end — the installed `@atlaskit/pragmatic-drag-and-drop@4.0.0` has no
 * key handling anywhere in `dist`, and there is no separate keyboard package.
 * The lift, the aim and the drop from the keyboard are therefore implemented
 * here, on the handle, and they reuse the *same* addressing functions the
 * pointer uses, so a keyboard drag and a mouse drag address the document
 * identically and the model rules over both. That is the whole point of the
 * exercise: a keyboard user tabs to a node's grip, presses <kbd>Enter</kbd> to
 * lift it, presses <kbd>↓</kbd>/<kbd>↑</kbd> to walk the indicator up and down
 * the tree (each step announced in a live region), presses <kbd>Enter</kbd> to
 * drop and <kbd>Escape</kbd> to put it back.
 *
 * **This file still decides no legality.** That is the property worth stating
 * twice, because it is the one a drag layer is normally tempted to break. A
 * drop handler that checked "is this container allowed to hold a repeater?"
 * would be a second rule book beside the model's, and the two would disagree
 * the first time the model's rules changed. So every drop here is *attempted*:
 * the arithmetic below addresses a position, and the model is asked whether that
 * position is legal. A refusal comes back through the route's own refusal path
 * with the model's message, which is also how a refused drag is surfaced: the
 * tree is untouched, because nothing was written before the model answered.
 * Note what that means for the library: no `canDrop`, no `canDrag`, no
 * "allowed" set. `getData` reports *which node* a zone is — identity, nothing
 * more — and every node is a target, leaves included, so that a leaf refuses
 * visibly instead of being silently skipped.
 *
 * **The one question this file does ask is asked of the model.** Aiming is not
 * attempting: {@link dropTargetForPointer} and {@link dropTargetsFor} ask
 * `canReceiveChild` — for the node under the pointer, and for each ancestor the
 * pointer's position climbs through — and use the answer. That is *asking*, not
 * knowing: the rules stay in `document-model`, the answers are the same ones
 * `addField` and `moveNode` act on, and this file holds no list of what may go
 * where, never compares types, and cannot tell a repeater from a group. What it
 * must not do is re-derive the answer from `children.length` or from what a
 * container is, which is why the answer is imported rather than computed.
 *
 * **The climb is not a legality check either.** It resolves *aiming*: start at
 * the node the pointer is over, and while the model says that node cannot take
 * what is being carried, move up one node, until a node that can. The drop then
 * lands immediately below the deepest node that could not, inside the container
 * that can — never above the pointer, and never at a position the model would
 * refuse. Every edge band keeps its sibling position, and every remaining
 * refusal — a climb that runs out of ancestors, a container into its own
 * subtree — is attempted and announced by the model in its own words.
 *
 * What this file does own is *addressing*: which list, and which index in it.
 * Those are not rules, they are coordinates, and the model measures the same
 * coordinate in its own terms.
 */

/** Where inside a node's box the pointer is. One of three bands. */
export type DropSide = "before" | "inside" | "after";

/**
 * A position in the document, addressed but not yet approved.
 *
 * `parentId` is the list the node would go into and `index` its place in it.
 * Both are measured on a list that does **not** contain the node being moved,
 * because the model removes a node before it inserts it and counts the index in
 * what is left. Counting against the visible list instead is the difference
 * between "move down one" and "move down two", so the exclusion is done here,
 * once, and never in a call site.
 */
export interface EditorDropTarget {
  /** The node whose box the pointer is in. Used to draw the indicator. */
  readonly nodeId: string;
  readonly side: DropSide;
  /** `null` is the form's own field list. */
  readonly parentId: string | null;
  readonly index: number;
}

/**
 * The drag the route is holding.
 *
 * The node being carried and the position under the pointer — or, for a keyboard
 * drag, the position the arrow keys have walked to. `target` is `null` until
 * something is aimed at: a drag that has been picked up but not aimed yet has a
 * source and no destination, and showing a position for it would be a promise
 * the document has not made.
 */
export interface EditorDrag {
  readonly nodeId: string;
  readonly target: EditorDropTarget | null;
}

/** A node's box, as far as the arithmetic below is concerned. */
interface Box {
  readonly top: number;
  readonly height: number;
}

/** How much of a node's box at each end is a "before" / "after" band. */
const EDGE_BAND_MAX = 12;
const EDGE_BAND_FRACTION = 0.25;

/**
 * Which band of a node's box the pointer is in, measured alone.
 *
 * The top and bottom quarter (capped at a few pixels, so a short row still has
 * an inside) address a place among the siblings; the middle addresses the node
 * itself, as a container to go into. This is the arithmetic on its own, with no
 * document and no rules: what the middle *means* is settled further down, by
 * {@link climbTargetFor} asking the model, and the two are kept apart so that
 * the bands of a box are a property of a box.
 */
export function dropSideFor(box: Box, clientY: number): DropSide {
  const band = Math.min(EDGE_BAND_MAX, box.height * EDGE_BAND_FRACTION);
  if (band <= 0) {
    return "inside";
  }
  if (clientY < box.top + band) {
    return "before";
  }
  if (clientY > box.top + box.height - band) {
    return "after";
  }
  return "inside";
}

/** A list without the node being moved, which is what an index is measured on. */
function withoutNode(
  list: readonly EditorNode[],
  draggingId: string | null,
): readonly EditorNode[] {
  if (draggingId === null) {
    return list;
  }
  return list.filter((node) => {
    return node.id !== draggingId;
  });
}

/**
 * Address a position for a drop on `node`'s box.
 *
 * Pure over the model, and it never asks the model what it thinks: the one
 * question it answers is "where, in which list", and the answer is the same
 * rule in every band — the number of the siblings that stand before `node`,
 * counted with the dragged node left out. `before` is that count, `after` is
 * one more, and `inside` is the size of what the container already holds, also
 * without the dragged node.
 *
 * The exclusion is what makes the address mean what the author sees. The model
 * removes a node before it inserts it, so the position between `node` and its
 * predecessor is the count of the siblings that are still there once the
 * carried node is out of the way — and because the count is of *preceding*
 * siblings, aiming at the carried node's own row needs no special case at all.
 * "Before itself" is the slot it already occupies; "after itself" is one slot
 * further, which is exactly the move the down button makes.
 *
 * The address is then held to the size of that same filtered list, because the
 * model measures its index in what is left and the end of a list of `n - 1` is
 * `n - 1`, not `n`. Without this, "just below the last sibling" would be spelled
 * as an index one past the end and answered with `ILLEGAL_INDEX` — the editor
 * refusing a position that is not only legal but the one the node already
 * holds. Clamping an address to the list it is an address in is not a rule
 * about what may be moved where; it is spelling the end of a list.
 */
export function dropTargetFor(
  model: DocumentModel,
  node: EditorNode,
  side: DropSide,
  draggingId: string | null,
): EditorDropTarget {
  if (side === "inside") {
    return {
      nodeId: node.id,
      side,
      parentId: node.id,
      index: withoutNode(node.children, draggingId).length,
    };
  }
  const parent = node.parent;
  const siblings = parent === null ? model.root : parent.children;
  const at = siblings.indexOf(node);
  const held = withoutNode(siblings, draggingId);
  const preceding = withoutNode(at < 0 ? siblings : siblings.slice(0, at), draggingId);
  const wanted = side === "before" ? preceding.length : preceding.length + 1;
  return {
    nodeId: node.id,
    side,
    parentId: parent === null ? null : parent.id,
    index: Math.min(wanted, held.length),
  };
}

/**
 * The position a drop on the middle band of `node`'s box resolves to, by asking
 * the model at every step.
 *
 * The pointer is over a node; the model says whether that node can take what is
 * being carried. If it can, the answer is the append `inside` has always
 * addressed. If it cannot, the position climbs: up to the parent, and to *its*
 * parent, until it reaches a node the model will accept — and the drop lands
 * immediately **below** the deepest node on the way up that could not receive,
 * inside the container that can.
 *
 * Three things follow from that shape, and none of them is a rule this file
 * holds. A leaf's middle band resolves to a sibling insertion under the leaf's
 * own parent, because the leaf's parent is a container that takes a leaf — the
 * most common case, and the one the old sibling fallback already got right. A
 * container over a node that may not hold one resolves *downward into whatever
 * encloses it* rather than stopping at the node under the pointer. And nothing
 * is ever placed above the pointer: the climb only ever ends below it.
 *
 * A climb that reaches the top without finding a node that can receive has
 * nothing to aim at — the root list takes anything, so this is the case where
 * the pair is illegal whatever the list — and it returns `null` for the caller
 * to handle by attempting the position the pointer was actually over. That
 * attempt is refused by the model, in the model's words, and a drop the model
 * refuses is never a silent one.
 */
export function climbTargetFor(
  model: DocumentModel,
  node: EditorNode,
  draggingId: string | null,
): EditorDropTarget | null {
  const dragged = draggingId === null ? null : nodeById(model, draggingId);
  if (dragged === null) {
    return null;
  }
  // The one question, asked of the model at each step of the climb. The type
  // of the carried node is the model's to name and the model's to judge; this
  // file only passes it along.
  let deepest = node;
  let below: EditorNode | null = null;
  while (!canReceiveChild(model, deepest.id, dragged.type)) {
    below = deepest;
    if (deepest.parent === null) {
      return null;
    }
    deepest = deepest.parent;
  }
  if (below === null) {
    return dropTargetFor(model, deepest, "inside", draggingId);
  }
  // "Below the node the climb came from" is the address that node's own `after`
  // band has always produced, so the arithmetic is the one function's and the
  // climb adds a node, not an index.
  return dropTargetFor(model, below, "after", draggingId);
}

/**
 * The position a pointer drop over `node`'s box addresses.
 *
 * A box and a coordinate in, an addressed position out: the bands of the box
 * first, and for the middle band the climb, because the middle band of a leaf
 * is the *dominant* position over a field and aiming "inside" there is a
 * position the model refuses every time. The edge bands are unchanged — a
 * pointer just above a row means just above that row, whatever the row is — and
 * a climb with nowhere to go falls back to the position the pointer was over,
 * so the model gets to refuse it in its own words instead of the drop
 * disappearing.
 */
export function dropTargetForPointer(
  model: DocumentModel,
  node: EditorNode,
  box: Box,
  clientY: number,
  draggingId: string | null,
): EditorDropTarget {
  const side = dropSideFor(box, clientY);
  if (side !== "inside") {
    return dropTargetFor(model, node, side, draggingId);
  }
  return climbTargetFor(model, node, draggingId) ?? dropTargetFor(model, node, side, draggingId);
}

/** Every node in a list and its descendants, depth first: the drawing order. */
function walkNodes(
  nodes: readonly EditorNode[],
  skipId: string | null,
  visit: (node: EditorNode) => void,
): void {
  for (const node of nodes) {
    if (node.id !== skipId) {
      visit(node);
    }
    // The carried node's own bands go, its *descendants'* bands stay: a
    // position inside the carried node's subtree is a real position the model
    // refuses with a sentence, and a keyboard that could not reach it would be
    // an editor with fewer positions in it than the pointer has.
    walkNodes(node.children, skipId, visit);
  }
}

/**
 * A node's display text: its title, or its code, or its id.
 *
 * The same rule the tree draws headers with, in one place, because a name said
 * two ways in two files is a name a screen reader reads two ways.
 */
export function nodeName(node: EditorNode): string {
  const title = getNodeProperty(node, "title");
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  return node.code.length > 0 ? node.code : node.id;
}

/**
 * Every position the arrow keys can walk to, in the order they walk them.
 *
 * The keyboard's substitute for a pointer: instead of "which band of which box
 * is the pointer in", it is "the next band of the next node". Every node but
 * the carried one offers all three of its bands, and the bands are grouped:
 * **the `before` bands in document order, then every `inside` band, then the
 * `after` bands.**
 *
 * **The carried node is not in this list, and that is the one thing filtered
 * out of it.** Aiming at your own row is a *legitimate* pointer aim — the
 * `before` of it is the slot it already holds and the `after` of it is the move
 * the down button makes — so the pointer keeps those. But a keyboard has no
 * pointer to sit on a row with: the arrow keys walk a list, and a list whose
 * last entry is the carried node's own "after" band means the first press after
 * a lift lands on the position the node is already in. That is a silent no-op as
 * the very first interaction, so the carried node contributes no bands at all
 * and the walk starts and ends on a *different* node.
 *
 * **The one other thing left out is an `inside` band the model would always
 * refuse**, and it is left out because the model was asked: a band on a node
 * that cannot receive the carried type is not in this list, in either
 * direction, and `canReceiveChild` is where that answer comes from. It is the
 * same question {@link climbTargetFor} asks while it climbs, so the keyboard
 * and the pointer agree about which nodes can hold what; the difference between
 * them is only that the pointer has a box to climb *from*. An aim the model
 * refuses for a reason *this file could have known in advance* — the two types
 * cannot go together — is a dead end that is better not offered than walked
 * onto. A refusal about a node's *position* rather than the pair of types (a
 * container into its own subtree) is a different thing: only a document can
 * answer that, so those aims stay in the list and are refused out loud, which
 * is the property {@link dropOutcomeMessage} and the route's refusal path are
 * for.
 *
 * **What the grouping buys, precisely.** A lift opens on one of the two *ends*
 * of this list ({@link liftAim}), and in a per-node walk the head of the list
 * was a `before` band but the tail was an `inside` band — so pressing the up
 * arrow after lifting a leaf opened on "will go inside Number", a refusal, as
 * the first thing the keyboard did. Grouping puts a sibling band at both ends,
 * so the first press in either direction lands on a reorder, which is what
 * somebody who has just picked a node up nearly always wants.
 *
 * It is worth being exact about what that is. **This is an ordering, not a
 * legality check, and the difference is the whole point.** The ordering adds no
 * aim and removes no aim, and inspects none: the same bands of the same nodes,
 * walked in a different sequence. Choosing a starting cursor is a decision about
 * the cursor. What the list *filters* is a separate matter, and it filters only
 * by asking the model -- see above. It also means the ordering cannot promise a
 * *move*: a sibling band at the head of the list can be the slot the node
 * already holds — the first field of a flat form, whose "above the second
 * field" is where it is — and a document with nothing but the carried node has
 * no aims at all. Both degrade, because {@link liftAim} falls back to the
 * nearest aim that does something and, in an empty document, to `null` and the
 * handle's own "nothing aimed" announcement.
 */
export function dropTargetsFor(
  model: DocumentModel,
  draggingId: string | null,
): readonly EditorDropTarget[] {
  const nodes: EditorNode[] = [];
  walkNodes(model.root, draggingId, (node) => {
    nodes.push(node);
  });
  // What is being carried, and therefore the one question each node is asked
  // below. A drag whose carried node is not in the document has no type to ask
  // about, and then nothing is filtered: there is no answer to apply.
  const dragged = draggingId === null ? null : nodeById(model, draggingId);
  const aims: EditorDropTarget[] = [];
  // Three passes over the same nodes in the same document order, so the list is
  // the same list of aims with a different sequence. The bands are emitted in
  // the order the walk reads them: `before`, `inside`, `after`.
  for (const side of ["before", "inside", "after"] as const) {
    for (const node of nodes) {
      if (side === "inside" && dragged !== null && !canReceiveChild(model, node.id, dragged.type)) {
        continue;
      }
      aims.push(dropTargetFor(model, node, side, draggingId));
    }
  }
  return aims;
}

/** Which way the arrow keys walk the aims. */
export type AimStep = "forward" | "backward";

/** The list a target's `index` is measured in: the node's own list, less itself. */
function listFor(model: DocumentModel, parentId: string | null): readonly EditorNode[] {
  if (parentId === null) {
    return model.root;
  }
  const parent = nodeById(model, parentId);
  return parent === null ? model.root : parent.children;
}

/** Whether two id lists are the same list, in the same order. */
function ordersMatch(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, at) => {
      return id === right[at];
    })
  );
}

/**
 * What the aim would make of the list, if the model allowed it.
 *
 * Pure, and it moves nothing: the carried node is taken out of the list, the
 * aim's index is clamped into what is left — the same clamping
 * {@link dropTargetFor} already did — and the node is put back at that index.
 * The result is the order the model would build *if it agreed*, which is enough
 * to answer "would this aim move the node at all?" without asking the model and
 * without deciding whether the aim is legal.
 *
 * It is deliberately not a legality check. An aim into a leaf, or a container
 * into its own subtree, produces a list here that means nothing — and it comes
 * out as a *change*, so a refusal is never mistaken for a no-op and filtered
 * out of a keyboard walk. That distinction is the whole reason this is a
 * function and not an `if` in the walk.
 */
function orderAfterAim(
  model: DocumentModel,
  draggingId: string,
  target: EditorDropTarget,
): readonly string[] {
  const node = nodeById(model, draggingId);
  if (node === null) {
    return [];
  }
  const held = withoutNode(listFor(model, target.parentId), draggingId);
  const at = Math.min(Math.max(target.index, 0), held.length);
  const next = [...held];
  next.splice(at, 0, node);
  return next.map((entry) => {
    return entry.id;
  });
}

/** The ids of the whole document, depth first: a fingerprint of its order. */
export function documentOrder(model: DocumentModel): readonly string[] {
  const ids: string[] = [];
  walkNodes(model.root, null, (node) => {
    ids.push(node.id);
  });
  return ids;
}

/**
 * Whether an aim would leave the document exactly as it is.
 *
 * Compared as the *resulting* order rather than as the index, because an aim
 * and a position are not the same thing: appending a node to the list it is
 * already the last of is a different index and the same document. "It did not
 * move" has to mean the document is untouched, not that the cursor changed
 * places.
 */
export function aimLeavesOrderUnchanged(
  model: DocumentModel,
  draggingId: string,
  target: EditorDropTarget,
): boolean {
  const before = listFor(model, target.parentId).map((node) => {
    return node.id;
  });
  return ordersMatch(before, orderAfterAim(model, draggingId, target));
}

/**
 * The aim a lift should open on, in the direction the first key press went.
 *
 * The one aim that is chosen for the author rather than offered to them: the
 * first aim in that direction that *moves* the node. Without it, lifting a node
 * and pressing an arrow can land on a position the node is already in — the
 * list's last entry is a slot nobody needs to be taken to — and the first thing
 * the feature does after a lift is nothing.
 *
 * The aim it picks is the one at the head of the list in that direction, because
 * {@link dropTargetsFor} groups the bands so that both ends of the list are
 * sibling bands: a lift opens on a reorder wherever a reorder moves the node,
 * which is the thing a person lifting a node almost always wants, and not on
 * the first refusal in the document.
 *
 * Only no-ops are skipped. An aim the model would refuse is *not* skipped: it
 * is a position, it is reachable, and the refusal it earns is the editor
 * talking. Choosing a starting cursor is a decision about the cursor.
 */
export function liftAim(
  model: DocumentModel,
  draggingId: string,
  step: AimStep,
): EditorDropTarget | null {
  const aims = dropTargetsFor(model, draggingId);
  if (aims.length === 0) {
    return null;
  }
  const from = step === "forward" ? aims : [...aims].reverse();
  const moving = from.find((aim) => {
    return !aimLeavesOrderUnchanged(model, draggingId, aim);
  });
  // Nothing in this direction moves the node — a document with one field in it,
  // or a node at the end of the only list. The nearest aim is then the honest
  // answer, and the release says that nothing moved rather than saying nothing.
  return moving ?? from[0] ?? null;
}

/** Two aims are the same place when they are the same band of the same node. */
function isSameAim(left: EditorDropTarget, right: EditorDropTarget): boolean {
  return left.nodeId === right.nodeId && left.side === right.side;
}

/**
 * The aim one arrow key press away, or the aim you were already on at an end.
 *
 * `current` is `null` while nothing is aimed at yet, which is the state
 * between lifting a node and pressing the first arrow: pressing down takes the
 * first aim in the document and pressing up takes the last. The ends clamp
 * rather than wrap, because a list that wrapped would make <kbd>↑</kbd> from
 * the top of the form a move nobody asked for.
 */
export function stepAim(
  aims: readonly EditorDropTarget[],
  current: EditorDropTarget | null,
  step: AimStep,
): EditorDropTarget | null {
  if (aims.length === 0) {
    return null;
  }
  if (current === null) {
    return step === "forward" ? (aims[0] ?? null) : (aims[aims.length - 1] ?? null);
  }
  const at = aims.findIndex((aim) => {
    return isSameAim(aim, current);
  });
  if (at < 0) {
    // An aim the list does not have — a node that has since been removed, or a
    // document the keyboard has not walked yet. Start at the near end rather
    // than refusing: there is no legality question in this branch, only a
    // cursor that has to be somewhere.
    return step === "forward" ? (aims[0] ?? null) : (aims[aims.length - 1] ?? null);
  }
  const next = step === "forward" ? at + 1 : at - 1;
  return aims[Math.min(Math.max(next, 0), aims.length - 1)] ?? null;
}

/**
 * An aim in words, for the live region a keyboard drag announces itself in.
 *
 * The model's own vocabulary — the same three words the indicator draws — so
 * what is heard and what is seen are the same sentence in two channels.
 */
export function describeAim(model: DocumentModel, target: EditorDropTarget): string {
  const node = nodeById(model, target.nodeId);
  const name = node === null ? "the form" : nodeName(node);
  if (target.side === "before") {
    return `above ${name}`;
  }
  if (target.side === "after") {
    return `below ${name}`;
  }
  return `inside ${name}`;
}

/**
 * What a released drag did, said after the model has answered.
 *
 * The route owns this one, not the handle, and that ordering is the fix for a
 * defect this file shipped first: a handle that announced the release before
 * asking the model could only either guess (and be wrong about a no-op) or
 * hedge ("Dropping X…", which says nothing). Here the model has already run, so
 * the sentence is a report and not a promise.
 *
 * `before` is {@link documentOrder} taken before the move. Three outcomes, and
 * all three say something a person can act on:
 *
 * - the order changed → what moved, and where it went;
 * - the order did not change and the aim named a different node → it was
 *   already there, which is the answer to "why did nothing happen";
 * - the order did not change and the aim named the node itself (a pointer aim
 *   at the carried row) → it did not move, and the aim is not described in
 *   words that would read as a position the node cannot be in.
 *
 * A refused move never reaches this function: the route's refusal path
 * announces the model's own sentence instead, so a refusal is never overwritten
 * by a report that the document did not change.
 */
export function dropOutcomeMessage(
  model: DocumentModel,
  draggingId: string,
  target: EditorDropTarget,
  before: readonly string[],
): string {
  const node = nodeById(model, draggingId);
  const label = node === null ? "The node" : nodeName(node);
  if (!ordersMatch(before, documentOrder(model))) {
    return `Moved ${label.toLowerCase()} ${describeAim(model, target)}.`;
  }
  if (target.nodeId === draggingId) {
    return `${label} did not move.`;
  }
  return `${label} did not move: it is already ${describeAim(model, target)}.`;
}

/**
 * The payload key both halves of the library agree on.
 *
 * A drag's data and a drop target's data are the same `Record`, and the only
 * thing in it is *which node* a thing is. Deliberately so: a key that said
 * "allowed" or "side" would be this file deciding legality inside a data
 * payload, where nothing would notice.
 */
const NODE_ID = "colander:editor-node-id";

/** The node id in a payload, or `null` if the payload is not one of ours. */
function payloadNodeId(data: Record<string, unknown>): string | null {
  const id = data[NODE_ID];
  return typeof id === "string" ? id : null;
}

/**
 * Where a pointer drag is pointing, as a position.
 *
 * The innermost drop target the library reports is the one the pointer is
 * aiming at: pragmatic walks the DOM upward from the element under the pointer
 * and returns the chain innermost-first, which is the proximity rule this file
 * used to state as "the innermost zone stops the event". The band then comes
 * from that same element's own box, so the arithmetic is over the box the
 * pointer is in and not over an ancestor's.
 *
 * A `null` here is not a refusal: it means the pointer is not over a node at
 * all, and a drag with no position is a drag with no indicator.
 */
function aimAtPointer(
  location: ElementEventBasePayload["location"]["current"],
  model: DocumentModel,
  draggingId: string | null,
): EditorDropTarget | null {
  const record = location.dropTargets[0];
  if (record === undefined) {
    return null;
  }
  const nodeId = payloadNodeId(record.data);
  const node = nodeId === null ? null : nodeById(model, nodeId);
  if (nodeId === null || node === null || !(record.element instanceof HTMLElement)) {
    return null;
  }
  const box = record.element.getBoundingClientRect();
  return dropTargetForPointer(model, node, box, location.input.clientY, draggingId);
}

/** What the route hands the monitor, and what it gets back. */
export interface DragMonitorArgs {
  readonly model: DocumentModel;
  /** A drag began: the node is in the air, with no position yet. */
  readonly onStart: (nodeId: string) => void;
  /** The drag points at a position, or at nothing. */
  readonly onAim: (target: EditorDropTarget | null) => void;
  /** The drag ended with the pointer released, with no position under it. */
  readonly onCancel: () => void;
  /** The drag ended on a position. Whether the model agrees is not asked here. */
  readonly onDrop: (target: EditorDropTarget) => void;
}

/**
 * One monitor for the whole editor.
 *
 * The library's model is a ledger, and a ledger is registered once: a second
 * `monitorForElements` would double every event, and one per node would be
 * twenty-four. So the tree registers *targets* and this registers the one
 * monitor that reads them, and the route — which already holds the drag — calls
 * the hook.
 *
 * Every drop is attempted and every release ends the drag, including a release
 * over nothing: the latter is the route's `onCancel`, which closes the drag
 * exactly as a drop closes it, because leaving a drag "in the air" after the
 * pointer is gone would leave an indicator drawn over a node that did not
 * move.
 */
export function useDragMonitor({ model, onStart, onAim, onCancel, onDrop }: DragMonitorArgs): void {
  // The callbacks and the model change on every render; the registration must
  // not, or every render would tear the ledger down and put it back together.
  const latest = useRef({ model, onStart, onAim, onCancel, onDrop });
  latest.current = { model, onStart, onAim, onCancel, onDrop };

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    return monitorForElements({
      canMonitor: ({ source }) => {
        return payloadNodeId(source.data) !== null;
      },
      onDragStart: ({ source }) => {
        const id = payloadNodeId(source.data);
        if (id !== null) {
          latest.current.onStart(id);
        }
      },
      onDrag: ({ location, source }) => {
        const id = payloadNodeId(source.data);
        if (id === null) {
          return;
        }
        latest.current.onAim(aimAtPointer(location.current, latest.current.model, id));
      },
      onDrop: ({ location, source }) => {
        const id = payloadNodeId(source.data);
        const target =
          id === null ? null : aimAtPointer(location.current, latest.current.model, id);
        if (target === null) {
          latest.current.onCancel();
          return;
        }
        latest.current.onDrop(target);
      },
    });
  }, []);
}

/** The id of the element the live region reads, for `aria-describedby`. */
export const DRAG_INSTRUCTIONS_ID = "editor-drag-instructions";

/**
 * How the drag is reached without a pointer, read out on focus.
 *
 * One static sentence per node handle rather than instructions in every
 * `title`, because a title is not announced on focus and a repeated paragraph
 * per node is a paragraph per node for everyone to arrow past.
 */
export const DRAG_INSTRUCTIONS =
  "Press Enter or Space to pick this node up, then the up and down arrow keys to move it, " +
  "Enter to drop it, and Escape to put it back.";

/**
 * A message for a screen reader about a keyboard drag.
 *
 * The lift, the aim, and the release. The release is phrased in the present
 * tense on purpose: whether the model accepted it is not known here, and the
 * answer arrives as the refusal alert the same way it does for the arrows. A
 * live region that said "moved" and was then contradicted by an alert would be
 * the one place this editor lied.
 */
export function keyboardMessages(
  label: string,
  aim: string | null,
): {
  readonly lift: string;
  readonly aimed: string;
  readonly cancelled: string;
  readonly nothingAimed: string;
} {
  return {
    lift: `Picked up ${label}. Up and down arrows move it, Enter drops it, Escape puts it back.`,
    aimed: aim === null ? `${label} has no position yet.` : `${label} will go ${aim}.`,
    cancelled: `Put ${label} back where it was.`,
    nothingAimed: `${label} was not dropped anywhere.`,
  };
}

/**
 * The handle a node is picked up by — with a pointer or with the keyboard.
 *
 * A ghost button of the same size and variant as the row's other controls, with
 * a grip and the node's name in its label — so it is discoverable by looking
 * (it sits where the other controls are) and reachable by name for a screen
 * reader. It is the **handle** and not the whole node, deliberately: a node's
 * box is full of other controls (its arrows, its remove button, and a leaf's
 * read-only input), and making the whole box the grip would make every one of
 * them a way to start a drag. The handle costs a second target per node and
 * keeps the visual language exactly as it was.
 *
 * The keyboard half is the reason this is a `<button>` and not a `<div
 * draggable>`. A native drag cannot be started from a key, so the keys are
 * handled here: <kbd>Enter</kbd>/<kbd>Space</kbd> lift and drop,
 * <kbd>↓</kbd>/<kbd>↑</kbd> walk the aim — the first press opening on
 * {@link liftAim}, the rest one {@link stepAim} each — and <kbd>Escape</kbd>
 * puts the node back. The default of every one of those keys is suppressed,
 * because Space scrolls a page and the arrows move a caret.
 *
 * The handle says what *it* knows: the lift, the aim, a cancel. It does not
 * say what a release did, because it cannot know — that is the route's sentence
 * to say, after the model has answered, and a handle that announced the drop
 * first had to either guess or hedge. See {@link dropOutcomeMessage}.
 */
export function DragHandle({
  model,
  node,
  label,
  drag,
  onDragStart,
  onAim,
  onDragEnd,
  onDrop,
  onAnnounce,
}: {
  readonly model: DocumentModel;
  readonly node: EditorNode;
  readonly label: string;
  readonly drag: EditorDrag | null;
  readonly onDragStart: (id: string) => void;
  readonly onAim: (target: EditorDropTarget | null) => void;
  readonly onDragEnd: () => void;
  readonly onDrop: (target: EditorDropTarget) => void;
  readonly onAnnounce: (message: string) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const lifted = drag !== null && drag.nodeId === node.id;
  const target = lifted === true && drag !== null ? drag.target : null;

  useEffect(() => {
    const element = button.current;
    if (element === null) {
      return;
    }
    // The data is the node's identity and nothing else. The library reads it
    // back on the far side of the drag to decide which node is in the air.
    return draggable({
      element,
      dragHandle: element,
      getInitialData: () => {
        return { [NODE_ID]: node.id };
      },
    });
  }, [node.id]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const key = event.key;
    if (!lifted) {
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        onDragStart(node.id);
        onAnnounce(keyboardMessages(label, null).lift);
      }
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      onDragEnd();
      onAnnounce(keyboardMessages(label, null).cancelled);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const step = key === "ArrowDown" ? "forward" : "backward";
      // The first press after a lift opens on an aim that moves the node; every
      // press after that is one step, so no aim becomes unreachable — including
      // the ones that do nothing, which the release then says out loud.
      const next =
        target === null
          ? liftAim(model, node.id, step)
          : stepAim(dropTargetsFor(model, node.id), target, step);
      onAim(next);
      onAnnounce(keyboardMessages(label, next === null ? null : describeAim(model, next)).aimed);
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (target === null) {
        // Nothing is aimed at, so there is no move to attempt and nothing to
        // refuse. The drag closes; the document was never touched — and it says
        // so, because a keypress that does nothing must not be silent.
        onDragEnd();
        onAnnounce(keyboardMessages(label, null).nothingAimed);
        return;
      }
      // The drop is handed to the route as a *position*, exactly as a pointer
      // drop is. Whether the model will make the move is not answered here, and
      // the route is what announces what the move did.
      onDrop(target);
    }
  };

  return (
    <Button
      ref={button}
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Move ${label}`}
      aria-describedby={DRAG_INSTRUCTIONS_ID}
      title={`Drag ${label}`}
      className={cn("cursor-grab active:cursor-grabbing", lifted ? "opacity-50" : undefined)}
      onKeyDown={onKeyDown}
    >
      <GripVerticalIcon aria-hidden="true" />
    </Button>
  );
}

/**
 * The line a node will land above or below.
 *
 * Drawn out of flow, and non-interactive, for one reason: the zone measures its
 * own box to decide which band the pointer is in, so an indicator that took
 * space would move the bands it is describing and the drop position would
 * flicker under the pointer as the indicator appeared. A bar that overlays the
 * edge says the same thing and leaves the measurement alone. `pointer-events`
 * is off for the same reason one step earlier: the pointer must be talking to
 * the node it is aiming at, not to the line about it.
 *
 * These classes are returned by a function rather than written at the call
 * site so that the property can be asserted in a test: the indicator cannot
 * resize the box it measures *because* it is absolutely positioned and takes no
 * pointer, and that is a claim about classes, which a node test can read.
 */
export function dropBarClasses(at: "before" | "after"): string {
  return cn(
    "pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary",
    at === "before" ? "top-0" : "bottom-0",
  );
}

/** The bar itself, over the edge it names. */
function DropBar({ at }: { readonly at: "before" | "after" }) {
  return <div aria-hidden="true" className={dropBarClasses(at)} />;
}

/**
 * One node's drop zone: the whole node, and the indicator for aiming at it.
 *
 * The zone covers the node and not just its header, because a leaf's answer
 * control is most of what the pointer is over when the author aims at a leaf —
 * and aiming at a leaf has to reach a real position, so it has to be inside the
 * zone. What it means there is settled by {@link dropTargetForPointer}, from
 * the model's answer rather than from anything this component knows.
 *
 * Nested zones resolve by proximity, and now that is the library's rule rather
 * than this file's: pragmatic reports the chain of drop targets under the
 * pointer innermost-first, and the monitor takes the head of that chain. There
 * is no depth arithmetic here to get wrong, and no zone needs to know whether
 * it has ancestors — it only has to say which node it is.
 *
 * No `canDrop`: a zone accepts everything, because refusing in the drop layer
 * is the one thing this layer must not do. The model refuses, in its own words,
 * where the route draws every other refusal — and the one position the layer
 * will not *aim* at is the one the model says it always refuses, which it asks
 * rather than knows.
 */
export function DropZone({
  node,
  drag,
  children,
}: {
  readonly node: EditorNode;
  readonly drag: EditorDrag | null;
  readonly children: React.ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const dragging = drag !== null && drag.nodeId === node.id;
  // The aim, when it is aimed at *this* node: one optional link, so the drawing
  // below is a straight read of one value.
  const aimed =
    drag !== null && drag.target !== null && drag.target.nodeId === node.id ? drag.target : null;
  const side = aimed === null ? null : aimed.side;

  useEffect(() => {
    const zone = element.current;
    if (zone === null) {
      return;
    }
    return dropTargetForElements({
      element: zone,
      getData: () => {
        return { [NODE_ID]: node.id };
      },
    });
  }, [node.id]);

  return (
    <div
      ref={element}
      className={cn(
        "relative rounded-md",
        dragging ? "opacity-50" : undefined,
        side === "inside" ? "ring-2 ring-ring" : undefined,
      )}
    >
      {side === "before" ? <DropBar at="before" /> : null}
      {children}
      {side === "after" ? <DropBar at="after" /> : null}
    </div>
  );
}

/**
 * The editor's keyboard instructions, and the live region a drag speaks into.
 *
 * Both are visually absent and both are read: the first is what a screen reader
 * says when a handle takes focus, and the second is where a lift, an aim and a
 * release are announced while the focus stays on the handle. `role="status"`
 * with `polite` rather than `alert` on purpose — a drag is a conversation, not
 * an error, and the errors here have their own `role="alert"` and their own
 * wording.
 */
export function DragAnnouncer({ message }: { readonly message: string }) {
  return (
    <>
      <p id={DRAG_INSTRUCTIONS_ID} className="sr-only">
        {DRAG_INSTRUCTIONS}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
    </>
  );
}
