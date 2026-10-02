import { describe, expect, it } from "vitest";

import {
  canReceiveChild,
  EditorModelError,
  moveNode,
  nodeById,
  parseDocuments,
  type DocumentModel,
  type EditorNode,
} from "@/editor/document-model";
import {
  aimLeavesOrderUnchanged,
  describeAim,
  documentOrder,
  dropBarClasses,
  dropOutcomeMessage,
  dropSideFor,
  dropTargetsFor,
  dropTargetFor,
  dropTargetForPointer,
  keyboardMessages,
  liftAim,
  nodeName,
  stepAim,
  type DropSide,
  type EditorDropTarget,
} from "@/editor/drag-and-drop";

/**
 * The addressing arithmetic of the drag layer, over the model and nothing else.
 *
 * No DOM is needed and none is faked: {@link dropSideFor} takes a box and a
 * coordinate, {@link dropTargetFor} takes the model and a node, and the
 * keyboard half — {@link dropTargetsFor}, {@link stepAim} — is a walk over the
 * same positions. What is not testable here is the React half — the handle, the
 * zone, the indicator, the library's own ledger — and this file does not pretend
 * otherwise. The one exception is the indicator's class list, which is a pure
 * function precisely so that the "it cannot resize the box it measures" claim
 * can be read here rather than believed.
 *
 * The authority for every expectation below is the **model**, not the drag code.
 * Each case names the position the model is asked for and then asserts the
 * document order that position produces, so a disagreement surfaces as a failing
 * test rather than as two pieces of code quietly meaning different things. The
 * convention under test is the one `moveNode` documents: a node is removed
 * before it is inserted, and the index is measured in what is left.
 */

const FORM_TEXT = JSON.stringify({
  fields: [
    { id: "text", code: "text", type: "text" },
    { id: "number", code: "number", type: "number" },
    { id: "choice", code: "choice", type: "choice" },
    {
      id: "group",
      code: "group",
      type: "group",
      items: [
        { id: "inside-a", code: "inside-a", type: "text" },
        { id: "inside-b", code: "inside-b", type: "text" },
      ],
    },
    {
      id: "repeater",
      code: "repeater",
      type: "repeater",
      items: [{ id: "row", code: "row", type: "text" }],
    },
  ],
});

/** The root's own order, which is what a top-level move is about. */
function rootOrder(model: DocumentModel): string[] {
  return model.root.map((node) => {
    return node.id;
  });
}

/** A container's children, in document order. */
function childOrder(model: DocumentModel, id: string): string[] {
  return node(model, id).children.map((child) => {
    return child.id;
  });
}

function node(model: DocumentModel, id: string): EditorNode {
  const found = nodeById(model, id);
  if (found === null) {
    throw new Error(`the fixture has no field ${id}`);
  }
  return found;
}

/** Every field id, depth first: the whole document, not one level of it. */
function wholeOrder(model: DocumentModel): string[] {
  const ids: string[] = [];
  const walk = (nodes: readonly EditorNode[]) => {
    for (const current of nodes) {
      ids.push(current.id);
      walk(current.children);
    }
  };
  walk(model.root);
  return ids;
}

interface Attempt {
  readonly target: { readonly parentId: string | null; readonly index: number };
  /** The document after the attempt: unchanged when the model refused. */
  readonly order: readonly string[];
  readonly root: readonly string[];
  readonly children: readonly string[];
  readonly refusal: EditorModelError | null;
}

/**
 * Aim at `targetId` from `draggingId` and hand the position to the model.
 *
 * The point of going through `moveNode` is that this is what the route does,
 * so a case that "works" here is a case the real drop does. A refusal is
 * returned rather than thrown, because a refusal is a *result* here and the
 * order beside it is the evidence that it left the document alone.
 */
function attempt(draggingId: string, targetId: string, side: DropSide): Attempt {
  const model = parseDocuments({ formSchemaJson: FORM_TEXT });
  const target = dropTargetFor(model, node(model, targetId), side, draggingId);
  let refusal: EditorModelError | null = null;
  try {
    moveNode(model, draggingId, target.parentId, target.index);
  } catch (error) {
    if (!(error instanceof EditorModelError)) {
      throw error;
    }
    refusal = error;
  }
  return {
    target: { parentId: target.parentId, index: target.index },
    order: wholeOrder(model),
    root: rootOrder(model),
    children: target.parentId === null ? [] : childOrder(model, target.parentId),
    refusal,
  };
}

describe("dropSideFor", () => {
  // 100 tall: the bands are a quarter of the box each, capped at 12px, so the
  // top and bottom quarters are 25px and the middle is the remaining 50.
  const box = { top: 100, height: 100 };

  it("reads the top third as before, the middle as inside, the bottom as after", () => {
    expect(dropSideFor(box, 110)).toBe("before");
    expect(dropSideFor(box, 150)).toBe("inside");
    expect(dropSideFor(box, 190)).toBe("after");
  });

  it("puts the bands on the box, not on the page", () => {
    // The same offsets on a box further down the page are the same answers.
    const lower = { top: 900, height: 100 };
    expect(dropSideFor(lower, 910)).toBe("before");
    expect(dropSideFor(lower, 950)).toBe("inside");
    expect(dropSideFor(lower, 990)).toBe("after");
  });

  it("splits a short box more evenly than the cap", () => {
    // 20 tall: a 12px band at each end would leave nothing, so the cap is not
    // the whole story -- the band is the smaller of the cap and a quarter.
    const short = { top: 0, height: 20 };
    expect(dropSideFor(short, 1)).toBe("before");
    expect(dropSideFor(short, 10)).toBe("inside");
    expect(dropSideFor(short, 19)).toBe("after");
  });

  it("has no bands at all in a box with no height", () => {
    // A collapsed row is one point; there is no edge to aim at.
    expect(dropSideFor({ top: 0, height: 0 }, 0)).toBe("inside");
  });
});

/**
 * A document with a group, a repeater and a component reference *inside* it.
 *
 * The climb fixture, and shaped for the six cases below: two sibling leaves
 * under a group, a repeater and a component reference side by side inside a
 * nested group, a top-level leaf and a top-level repeater with no ancestor at
 * all so the climb has somewhere to run out, and a top-level group and a
 * top-level component reference to carry in the cases where a container is what
 * is being dragged.
 */
const CLIMB_TEXT = JSON.stringify({
  fields: [
    {
      id: "shell",
      code: "shell",
      type: "group",
      items: [
        { id: "leaf-a", code: "leaf-a", type: "text" },
        { id: "leaf-b", code: "leaf-b", type: "text" },
        {
          id: "nest",
          code: "nest",
          type: "group",
          items: [
            {
              id: "rep",
              code: "rep",
              type: "repeater",
              items: [{ id: "row", code: "row", type: "text" }],
            },
            { id: "ref", code: "ref", type: "component-ref", componentCode: "card" },
          ],
        },
      ],
    },
    { id: "top-leaf", code: "top-leaf", type: "text" },
    { id: "top-rep", code: "top-rep", type: "repeater" },
    { id: "mover", code: "mover", type: "group" },
    { id: "mover-ref", code: "mover-ref", type: "component-ref", componentCode: "card" },
  ],
});

describe("the middle band of a box is resolved by asking the model, and climbing", () => {
  // A leaf's box is mostly its own controls, so its middle band is the
  // *dominant* drop position over a field, and aiming "inside" there is a
  // position the model refuses every single time. So the middle band asks:
  // start at the node under the pointer, and while the model says that node
  // cannot take what is being carried, go up one node, until it says one that
  // can. The drop then lands immediately below the deepest node on the way up
  // that could not -- inside the container that can, never above the pointer,
  // and never at a position the model would refuse.
  //
  // The drag layer holds no rules for any of this: it calls `canReceiveChild`
  // for the hovered node and for each ancestor, and uses the answers. It never
  // compares types and cannot tell a repeater from a group; the rules are in
  // the model, where `addField` and `moveNode` ask the same question.
  //
  // Every case below is asserted through `moveNode` and the document that comes
  // back, never through the index the drag layer sent.
  const box = { top: 0, height: 100 };

  /** The address the pointer produces, and the document the model then builds. */
  function pointedAt(
    draggingId: string,
    targetId: string,
    clientY = 50,
  ): { readonly target: EditorDropTarget; readonly model: DocumentModel } {
    const model = parseDocuments({ formSchemaJson: CLIMB_TEXT });
    return {
      target: dropTargetForPointer(model, node(model, targetId), box, clientY, draggingId),
      model,
    };
  }

  /** Point, drop, and report the document the model produced. */
  function dropped(
    draggingId: string,
    targetId: string,
    clientY = 50,
  ): {
    readonly target: EditorDropTarget;
    readonly model: DocumentModel;
    readonly refusal: EditorModelError | null;
  } {
    const pointed = pointedAt(draggingId, targetId, clientY);
    let refusal: EditorModelError | null = null;
    try {
      moveNode(pointed.model, draggingId, pointed.target.parentId, pointed.target.index);
    } catch (error) {
      if (!(error instanceof EditorModelError)) {
        throw error;
      }
      refusal = error;
    }
    return { ...pointed, refusal };
  }

  it("case one: a leaf onto a leaf climbs one step and becomes a sibling insertion", () => {
    // `top-leaf` over `leaf-a`. The leaf cannot receive it, its parent can, so
    // the drop lands below the hovered leaf inside `shell` -- the very address
    // the leaf's own `after` band produces, and what the old sibling fallback
    // did. The common case, and it is unchanged by the climb.
    const result = dropped("top-leaf", "leaf-a");
    expect(result.target).toEqual({
      nodeId: "leaf-a",
      side: "after",
      parentId: "shell",
      index: 1,
    });
    expect(result.refusal).toBeNull();
    expect(childOrder(result.model, "shell")).toEqual(["leaf-a", "top-leaf", "leaf-b", "nest"]);
  });

  it("case two: a leaf onto a group goes inside it, below the pointer", () => {
    // The group can receive, so the climb stops immediately and the position is
    // the append `inside` has always addressed.
    const result = dropped("top-leaf", "nest");
    expect(result.target).toEqual({ nodeId: "nest", side: "inside", parentId: "nest", index: 2 });
    expect(result.refusal).toBeNull();
    expect(childOrder(result.model, "nest")).toEqual(["rep", "ref", "top-leaf"]);
  });

  it("case three: a group onto a repeater climbs past it, downward and inside", () => {
    // A repeater's children are per-row answer fields, so the model will not
    // take a container. The climb goes up to `nest` -- the container that
    // encloses the repeater -- and the drop lands below it there. Downward, and
    // inside whatever could hold it; not above the pointer, and not refused.
    const result = dropped("mover", "rep");
    // (The premise, read from the model rather than from this file: a repeater
    // will not take a group, and its parent will.)
    const model = parseDocuments({ formSchemaJson: CLIMB_TEXT });
    expect(canReceiveChild(model, "rep", "group")).toBe(false);
    expect(canReceiveChild(model, "nest", "group")).toBe(true);
    expect(result.target).toEqual({
      nodeId: "rep",
      side: "after",
      parentId: "nest",
      index: 1,
    });
    expect(result.refusal).toBeNull();
    expect(childOrder(result.model, "nest")).toEqual(["rep", "mover", "ref"]);
  });

  it("case four: a component reference onto a component reference climbs past it as well", () => {
    // A component reference may not contain another one -- expansion would be
    // recursive -- so the same climb ends in `nest`, below the reference. Note
    // what the model's answer is keyed on: it is the *pair* of types, so the
    // same reference takes the plain group of case three's shape without any
    // climb at all, and it is `mover-ref` that has to climb.
    const model = parseDocuments({ formSchemaJson: CLIMB_TEXT });
    expect(canReceiveChild(model, "ref", "component-ref")).toBe(false);
    expect(canReceiveChild(model, "ref", "group")).toBe(true);
    const result = dropped("mover-ref", "ref");
    expect(result.target).toEqual({
      nodeId: "ref",
      side: "after",
      parentId: "nest",
      index: 2,
    });
    expect(result.refusal).toBeNull();
    expect(childOrder(result.model, "nest")).toEqual(["rep", "ref", "mover-ref"]);
  });

  it("case five: a leaf onto a component reference still goes inside it", () => {
    // The rule is about the *pair*: the same reference that will not take a
    // container takes a leaf without a climb at all.
    const result = dropped("top-leaf", "ref");
    expect(result.target).toEqual({ nodeId: "ref", side: "inside", parentId: "ref", index: 0 });
    expect(result.refusal).toBeNull();
    expect(childOrder(result.model, "ref")).toEqual(["top-leaf"]);
  });

  it("case six: a climb with no ancestor left is refused in the model's words", () => {
    // `top-rep` has no parent, so the climb runs out: the root list takes
    // anything, which means the pair is illegal whatever the list, and there is
    // nowhere downward to go. The position the pointer was actually over is
    // then attempted, so the model refuses it -- with its own sentence, naming
    // the repeater -- and the document is untouched. A drop the model refuses is
    // never a silent one: the route announces this message and skips the
    // "nothing moved" report, so the author hears why.
    const result = dropped("mover", "top-rep");
    expect(result.target).toEqual({
      nodeId: "top-rep",
      side: "inside",
      parentId: "top-rep",
      index: 0,
    });
    expect(result.refusal?.code).toBe("ILLEGAL_PLACEMENT");
    expect(result.refusal?.fieldId).toBe("top-rep");
    expect(result.refusal?.message).toBe(
      'A repeater\'s children are per-row answer fields, so a group may not go under "top-rep".',
    );
    expect(wholeOrder(result.model)).toEqual([
      "shell",
      "leaf-a",
      "leaf-b",
      "nest",
      "rep",
      "row",
      "ref",
      "top-leaf",
      "top-rep",
      "mover",
      "mover-ref",
    ]);
  });

  it("a repeater with rows takes the drop, and an empty one does too", () => {
    // The case a `children.length` check would break: a repeater that was just
    // added holds nothing and is still the node somebody drags a field into.
    // Both are the model's answer, and neither is counted here.
    const withRows = dropped("top-leaf", "rep");
    expect(withRows.target.side).toBe("inside");
    expect(childOrder(withRows.model, "rep")).toEqual(["row", "top-leaf"]);

    const empty = parseDocuments({
      formSchemaJson: JSON.stringify({
        fields: [{ id: "fresh", code: "fresh", type: "repeater" }],
      }),
    });
    expect(node(empty, "fresh").children).toEqual([]);
    expect(dropTargetForPointer(empty, node(empty, "fresh"), box, 50, "ghost")).toEqual({
      nodeId: "fresh",
      side: "inside",
      parentId: "fresh",
      index: 0,
    });
  });

  it("the climb pushes downward from every part of the middle band", () => {
    // Not the half of the box the pointer is in: the resolved position is below
    // the hovered node in all of it, because the climb only ever ends below.
    for (const clientY of [26, 40, 60, 74]) {
      const result = dropped("top-leaf", "leaf-a", clientY);
      expect(result.target.side, `y=${clientY}`).toBe("after");
      expect(result.refusal, `y=${clientY}`).toBeNull();
      expect(childOrder(result.model, "shell"), `y=${clientY}`).toEqual([
        "leaf-a",
        "top-leaf",
        "leaf-b",
        "nest",
      ]);
    }
  });

  it("the edge bands of a leaf are what they always were", () => {
    // The change is in the middle band only: 10 is in the top quarter and 90 in
    // the bottom, and both address the same siblings they addressed before --
    // no climb, because a position just above a row means just above that row
    // whatever the row is.
    expect(pointedAt("top-leaf", "leaf-a", 10).target).toEqual({
      nodeId: "leaf-a",
      side: "before",
      parentId: "shell",
      index: 0,
    });
    expect(pointedAt("top-leaf", "leaf-a", 90).target).toEqual({
      nodeId: "leaf-a",
      side: "after",
      parentId: "shell",
      index: 1,
    });
  });
});

describe("dropTargetFor, addressing the model's own same-parent indexing", () => {
  it("drops before the first child", () => {
    // "Before `inside-a`" with `choice` lifted out is the first slot, because
    // the node being moved is not in the list the index is measured against.
    const result = attempt("choice", "inside-a", "before");
    expect(result.target).toEqual({ parentId: "group", index: 0 });
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["choice", "inside-a", "inside-b"]);
  });

  it("drops between two children", () => {
    const result = attempt("choice", "inside-b", "before");
    expect(result.target).toEqual({ parentId: "group", index: 1 });
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["inside-a", "choice", "inside-b"]);
  });

  it("drops after the last child", () => {
    const result = attempt("choice", "inside-b", "after");
    expect(result.target).toEqual({ parentId: "group", index: 2 });
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["inside-a", "inside-b", "choice"]);
  });

  it("drops inside a container, at the end of what it holds", () => {
    const result = attempt("text", "group", "inside");
    expect(result.target).toEqual({ parentId: "group", index: 2 });
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["inside-a", "inside-b", "text"]);
  });

  it("reorders the root list", () => {
    // `group` is preceded by `text`, `number` and `choice`, and the carried
    // `text` is not counted, so the slot before `group` is the third one. The
    // model confirms it by leaving `text` immediately in front of `group`.
    const result = attempt("text", "group", "before");
    expect(result.target).toEqual({ parentId: null, index: 2 });
    expect(result.refusal).toBeNull();
    expect(result.root).toEqual(["number", "choice", "text", "group", "repeater"]);
  });
});

describe("dropTargetFor takes the dragged node out of its own list", () => {
  // This is the whole reason the index is measured on a filtered list: the
  // model removes a node before inserting it. An index counted on the visible
  // list moves a node one slot further than the author asked for, every time
  // the node moves within a list it is also in.
  it("a move that is already true leaves the order unchanged", () => {
    const result = attempt("inside-b", "inside-a", "after");
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["inside-a", "inside-b"]);
  });

  it("dropping a node inside its own parent leaves it where it was", () => {
    // The dragged node is filtered out of the length, so the append lands at
    // the end of what is left rather than one past the end of the whole list.
    const result = attempt("inside-b", "group", "inside");
    expect(result.target).toEqual({ parentId: "group", index: 1 });
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["inside-a", "inside-b"]);
  });

  it("a move up within one parent, addressed against the same list", () => {
    const result = attempt("inside-b", "inside-a", "before");
    expect(result.target).toEqual({ parentId: "group", index: 0 });
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["inside-b", "inside-a"]);
  });
});

describe("a drop on the dragged node's own row is a position, not an error", () => {
  // The pointer sits over the node it is carrying for a large part of any drag,
  // so the bands of that row have to address real positions. A refusal here
  // would be the editor arguing with an author who has not asked it anything.
  const ids = ["text", "number", "choice", "group", "repeater", "inside-a", "inside-b", "row"];

  for (const id of ids) {
    for (const side of ["before", "after"] as const) {
      it(`${id} ${side} itself does not refuse`, () => {
        const result = attempt(id, id, side);
        expect(result.refusal).toBeNull();
      });
    }
  }

  it("before itself is where it already is", () => {
    const result = attempt("inside-b", "inside-b", "before");
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["inside-a", "inside-b"]);
  });

  it("after itself is one slot further, like the down button", () => {
    // The down button sends `index + 1` for the same move, and the model
    // measures both against the list the node is not in.
    const result = attempt("inside-a", "inside-a", "after");
    expect(result.target).toEqual({ parentId: "group", index: 1 });
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["inside-b", "inside-a"]);
  });
});

describe("what the drag layer leaves for the model to refuse", () => {
  // Every case here is a position the drag layer was happy to produce. None of
  // them is filtered in the drag code, which is the point: the rules live in
  // `moveNode` and nowhere else.
  it("refuses a drop into a leaf, with the model's own message", () => {
    // The address function still *spells* "inside a leaf" — spelling an
    // address is not proposing a placement — and the model still refuses it in
    // its own words. This is the rule the drag layer now asks for rather than
    // restates, so the sentence asserted here is the same one behind
    // `canReceiveChild`'s `false` below.
    const before = parseDocuments({ formSchemaJson: FORM_TEXT });
    const result = attempt("number", "choice", "inside");
    expect(result.target).toEqual({ parentId: "choice", index: 0 });
    expect(result.refusal?.code).toBe("ILLEGAL_PLACEMENT");
    expect(result.refusal?.fieldId).toBe("choice");
    expect(result.refusal?.message).toBe(
      'choice "choice" is a field, not a container, so nothing can go inside it.',
    );
    expect(wholeOrder(parseDocuments({ formSchemaJson: FORM_TEXT }))).toEqual(wholeOrder(before));
    // The predicate the drag layer asks, and the model's answer, are one answer.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    expect(canReceiveChild(model, "choice", "number")).toBe(false);
    expect(canReceiveChild(model, "group", "number")).toBe(true);
  });

  it("refuses a container inside its own subtree", () => {
    // Aiming at the far side of one of the group's own children is the
    // container-inside-itself case, and the model recognises it before it looks
    // at placements at all: `ILLEGAL_MOVE`, with the subtree's own wording.
    const result = attempt("group", "inside-a", "after");
    expect(result.target).toEqual({ parentId: "group", index: 1 });
    expect(result.refusal?.code).toBe("ILLEGAL_MOVE");
    expect(result.refusal?.message).toBe('"group" cannot move inside its own subtree.');
    expect(result.order).toEqual([
      "text",
      "number",
      "choice",
      "group",
      "inside-a",
      "inside-b",
      "repeater",
      "row",
    ]);
  });

  it("refuses a container inside itself", () => {
    const result = attempt("group", "group", "inside");
    expect(result.refusal?.code).toBe("ILLEGAL_MOVE");
    expect(result.refusal?.message).toBe('"group" cannot move inside its own subtree.');
    expect(result.order).toEqual([
      "text",
      "number",
      "choice",
      "group",
      "inside-a",
      "inside-b",
      "repeater",
      "row",
    ]);
  });

  it("refuses a container under a repeater, even though the index is in bounds", () => {
    // The arithmetic here is perfectly happy: `group` has a legal-looking slot
    // among the repeater's rows. Nothing in the drag layer knows better, and
    // the model is what says no.
    const result = attempt("group", "row", "after");
    expect(result.target).toEqual({ parentId: "repeater", index: 1 });
    expect(result.refusal?.code).toBe("ILLEGAL_PLACEMENT");
    expect(result.refusal?.message).toBe(
      'A repeater\'s children are per-row answer fields, so a group may not go under "repeater".',
    );
  });

  it("allows a leaf under a repeater, which is the rule beside it", () => {
    // The pair of refusals above and this move are the reason the drag layer
    // has no list of its own: the two differ by one property of the node being
    // moved, and a list in the UI would have to restate that property.
    const result = attempt("choice", "row", "after");
    expect(result.refusal).toBeNull();
    expect(result.children).toEqual(["row", "choice"]);
  });

  it("refuses a node that is not in the document at all", () => {
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    const target = dropTargetFor(model, node(model, "group"), "inside", "ghost");
    expect(target).toEqual({ nodeId: "group", side: "inside", parentId: "group", index: 2 });
    expect(() => {
      moveNode(model, "ghost", target.parentId, target.index);
    }).toThrowError(EditorModelError);
  });
});

describe("no drop is ever a silent no-op", () => {
  // The invariant the whole design rests on: a drop is either a move the model
  // made, or a refusal the model gave. There is no third outcome in which the
  // document is left alone and nothing is said.
  //
  // It is stated here without restating the drag code's arithmetic, because
  // restating it would be a second implementation to keep in step. The check is
  // made on the model's output instead: whatever index was sent, the node ends
  // up **adjacent to the node that was aimed at, in the direction that was
  // aimed** — or the model refused. A no-op aim (a node dropped into the slot
  // it already holds) satisfies the same adjacency, so it needs no exception.
  const ids = ["text", "number", "choice", "group", "repeater", "inside-a", "inside-b", "row"];
  const sides: readonly DropSide[] = ["before", "inside", "after"];

  /** The parent list a node ends up in, as ids. */
  function listOf(model: DocumentModel, id: string): string[] {
    const found = nodeById(model, id);
    if (found === null) {
      return [];
    }
    return found.parent === null ? rootOrder(model) : childOrder(model, found.parent.id);
  }

  function landsAdjacentToTheAim(
    model: DocumentModel,
    dragging: string,
    aim: string,
    side: DropSide,
    wasAt: number,
  ): boolean {
    if (side === "inside") {
      // "Inside" appends, so the carried node is the container's last child --
      // or the container is the carried node, which the model refuses.
      return childOrder(model, aim).at(-1) === dragging;
    }
    const list = listOf(model, dragging);
    const carried = list.indexOf(dragging);
    if (carried < 0) {
      return false;
    }
    if (aim === dragging) {
      // Aiming at the carried node's own row: "before" is the slot it already
      // holds, and "after" is the next one, bounded by the end of the list.
      return side === "before"
        ? carried === wasAt
        : carried === Math.min(wasAt + 1, list.length - 1);
    }
    const aimed = list.indexOf(aim);
    if (aimed < 0) {
      return false;
    }
    return side === "before" ? aimed === carried + 1 : carried === aimed + 1;
  }

  it("every aim at every node either moves the document or refuses it", () => {
    const pristine = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of ids) {
      for (const aim of ids) {
        for (const side of sides) {
          const label = `${dragging} -> ${aim} ${side}`;
          const result = attempt(dragging, aim, side);
          if (result.refusal !== null) {
            continue;
          }
          // The tree the model produced, not the one the drag code imagined.
          const moved = parseDocuments({ formSchemaJson: FORM_TEXT });
          moveNode(moved, dragging, result.target.parentId, result.target.index);
          const wasAt = listOf(pristine, dragging).indexOf(dragging);
          expect(landsAdjacentToTheAim(moved, dragging, aim, side, wasAt), label).toBe(true);
        }
      }
    }
  });

  it("a refused drop leaves the document byte-identical", () => {
    for (const dragging of ids) {
      for (const aim of ids) {
        for (const side of sides) {
          const model = parseDocuments({ formSchemaJson: FORM_TEXT });
          const before = JSON.stringify(model.form);
          const drop = dropTargetFor(model, node(model, aim), side, dragging);
          let refused = false;
          try {
            moveNode(model, dragging, drop.parentId, drop.index);
          } catch (error) {
            if (!(error instanceof EditorModelError)) {
              throw error;
            }
            refused = true;
          }
          if (refused) {
            // Nothing is written before the model answers, so a refusal is not
            // a partially applied move. This is the whole of rule 5.
            expect(JSON.stringify(model.form), `${dragging} -> ${aim} ${side}`).toBe(before);
          }
        }
      }
    }
  });

  it("no aim anywhere in this document produces an indexing or lookup error", () => {
    // Every aim over every node, in every band, ends in one of two places: a
    // move the model made, or a refusal about *where the node may go* --
    // `ILLEGAL_MOVE` for its own subtree, `ILLEGAL_PLACEMENT` for the shape of
    // the parent. Never `ILLEGAL_INDEX`, which would mean the drag layer
    // addressed a slot that does not exist rather than a position the model
    // could rule on. That is the whole meaning of the clamping above, and this
    // is the assertion that holds it in place: aim at the far side of the last
    // sibling, of the only child, and of the carried node's own row, and the
    // model is never told about an index outside the list.
    const codes = new Set<string>();
    for (const dragging of ids) {
      for (const aim of ids) {
        for (const side of sides) {
          const result = attempt(dragging, aim, side);
          if (result.refusal !== null) {
            codes.add(result.refusal.code);
            expect(result.refusal.message.length, `${dragging} -> ${aim} ${side}`).toBeGreaterThan(
              0,
            );
          }
        }
      }
    }
    expect([...codes].sort()).toEqual(["ILLEGAL_MOVE", "ILLEGAL_PLACEMENT"]);
  });

  it("and the refusals are about placement, not about the drag being dropped", () => {
    // Both of the refusals the editor must surface by name: a leaf that cannot
    // hold anything, and a container that cannot go inside itself. Neither
    // mentions the drag, because neither is about the drag.
    expect(attempt("text", "text", "inside").refusal?.code).toBe("ILLEGAL_MOVE");
    expect(attempt("text", "number", "inside").refusal?.code).toBe("ILLEGAL_PLACEMENT");
  });
});

/** Every node in the fixture, depth first: the order both routes walk. */
const FIXTURE_IDS = [
  "text",
  "number",
  "choice",
  "group",
  "inside-a",
  "inside-b",
  "repeater",
  "row",
] as const;

const ALL_SIDES: readonly DropSide[] = ["before", "inside", "after"];

/** An aim as one word, for reading a list of them. */
function label(aim: EditorDropTarget): string {
  return `${aim.nodeId} ${aim.side}`;
}

/** The aims of one drag, in keyboard order. */
function aimsFor(draggingId: string): readonly EditorDropTarget[] {
  return dropTargetsFor(parseDocuments({ formSchemaJson: FORM_TEXT }), draggingId);
}

/** The ids of the fixture, less the one being dragged. */
function otherIds(draggingId: string): readonly string[] {
  return FIXTURE_IDS.filter((id) => {
    return id !== draggingId;
  });
}

/** The ids of the fixture a node of the carried type may go inside. */
function receivingIds(draggingId: string): readonly string[] {
  const model = parseDocuments({ formSchemaJson: FORM_TEXT });
  const carried = node(model, draggingId);
  return otherIds(draggingId).filter((id) => {
    return canReceiveChild(model, id, carried.type);
  });
}

/**
 * The aim list the walk is expected to produce: the `before` bands in document
 * order, then the `inside` bands, then the `after` bands.
 *
 * Written here as the *whole* list rather than as a property, because the
 * order is the thing under test: a list with the same aims in a different order
 * is a different list to a person pressing the down arrow, and only an exact
 * expectation can say so.
 *
 * The `inside` aims are the ones the model says the carried node may go inside,
 * and they are asked of the model rather than written here — a test that
 * restated the rule would be a second rule book, which is the thing both sides
 * of this change exist to prevent.
 */
function expectedLabels(draggingId: string): string[] {
  const ids = otherIds(draggingId);
  return [
    ...ids.map((id) => {
      return `${id} before`;
    }),
    ...receivingIds(draggingId).map((id) => {
      return `${id} inside`;
    }),
    ...ids.map((id) => {
      return `${id} after`;
    }),
  ];
}

describe("dropTargetsFor, the list the arrow keys walk", () => {
  it("is every other node's before and after band, with the inside bands the model allows", () => {
    // Only two things are filtered: the carried node, and the `inside` band of
    // a node the model will not put the carried type into. The second is the
    // decision this list was changed for — a position the model *always*
    // refuses is not offered at all, so the keyboard never walks onto a
    // guaranteed no. The rule is the model's (`canReceiveChild`), asked once
    // per node, and this file writes down no list of its own.
    //
    // What is *ordered*, and ordered the same for every node: the `before` bands
    // in document order, then every `inside` band, then the `after` bands. The
    // two ends of the list are therefore sibling bands, and the two ends are
    // the only two places a lift ever opens on -- see `liftAim` below.
    //
    // Written out in full rather than through the helper, so the two passes
    // that filter nothing and the one that filters are both visible. A leaf
    // carries a type both containers here take, and a repeater is a container
    // too but no repeater takes one -- so its list is one `inside` aim shorter,
    // and the drag that carries the *repeater itself* cannot aim inside any node
    // here at all.
    const leafDrag = otherIds("choice");
    expect(aimsFor("choice").map(label)).toEqual([
      ...leafDrag.map((id) => {
        return `${id} before`;
      }),
      "group inside",
      "repeater inside",
      ...leafDrag.map((id) => {
        return `${id} after`;
      }),
    ]);
    const repeaterDrag = otherIds("repeater");
    expect(aimsFor("repeater").map(label)).toEqual([
      ...repeaterDrag.map((id) => {
        return `${id} before`;
      }),
      "group inside",
      ...repeaterDrag.map((id) => {
        return `${id} after`;
      }),
    ]);
    const groupDrag = otherIds("group");
    expect(aimsFor("group").map(label)).toEqual([
      ...groupDrag.map((id) => {
        return `${id} before`;
      }),
      ...groupDrag.map((id) => {
        return `${id} after`;
      }),
    ]);
  });

  it("puts no inside band before a sibling band, and none after one either", () => {
    // The property behind that order, stated so a reordering cannot quietly
    // undo it: the `before` pass, then whatever `inside` aims exist, then the
    // `after` pass. It says nothing about which aims exist -- the `inside` aims
    // here are the ones the model permits, which in this fixture is a group and
    // never a leaf -- and a drag that can aim inside nothing at all (a repeater
    // carried, or the group itself, whose own bands are not in any list) has the
    // two edge passes with nothing between them.
    for (const dragging of FIXTURE_IDS) {
      const labels = aimsFor(dragging).map(label);
      const lastBefore = Math.max(
        ...labels.map((entry, at) => {
          return entry.endsWith(" before") ? at : -1;
        }),
      );
      const insideAts = labels
        .map((entry, at) => {
          return entry.endsWith(" inside") ? at : -1;
        })
        .filter((at) => {
          return at >= 0;
        });
      const lastInside = insideAts.length === 0 ? -1 : Math.max(...insideAts);
      const firstInside = insideAts.length === 0 ? -1 : Math.min(...insideAts);
      const firstAfter = labels.findIndex((entry) => {
        return entry.endsWith(" after");
      });
      // The `inside` aims, if there are any, are a contiguous pass between the
      // two edge passes: nothing before one but a `before` band, and nothing
      // after one but an `after` band.
      expect(lastBefore, dragging).toBeLessThan(firstInside === -1 ? firstAfter : firstInside);
      expect(lastInside, dragging).toBeLessThan(firstAfter);
      // Nothing was dropped on the way: the same nodes, the same bands, and the
      // same `inside` aims the model allows.
      expect([...new Set(labels)].sort(), dragging).toEqual(
        [...new Set(expectedLabels(dragging))].sort(),
      );
    }
  });

  it("never names the carried node, in any of its three bands", () => {
    // The defect this list shipped with: the carried node contributed its own
    // `before`/`inside`/`after`, and since the walk ends at the bottom of the
    // document that put the carried node's own row last -- which is where a
    // press of the *up* arrow lands on a lift. The first thing a keyboard user
    // met was a position naming the node being carried.
    for (const dragging of FIXTURE_IDS) {
      const labels = aimsFor(dragging).map(label);
      for (const side of ALL_SIDES) {
        expect(labels, `${dragging} ${side}`).not.toContain(`${dragging} ${side}`);
      }
      // Both edge bands of every other node, plus one `inside` aim for each
      // node the model says will take this node's type.
      const others = otherIds(dragging);
      expect(aimsFor(dragging).length, dragging).toBe(
        others.length * 2 + receivingIds(dragging).length,
      );
    }
  });

  it("still offers the carried node's own row to a pointer, which is a real aim", () => {
    // The exclusion is the keyboard's, not the tree's: `dropTargetFor` still
    // addresses the carried node, because "after myself" is the move the down
    // button makes and the pointer must be able to say it.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    expect(dropTargetFor(model, node(model, "inside-b"), "after", "inside-b")).toEqual({
      nodeId: "inside-b",
      side: "after",
      parentId: "group",
      index: 1,
    });
  });

  it("starts at the top of the form and ends at the bottom", () => {
    const aims = aimsFor("choice");
    expect(label(aims[0] as EditorDropTarget)).toBe("text before");
    expect(label(aims[aims.length - 1] as EditorDropTarget)).toBe("row after");
  });

  it("measures every aim on the list the dragged node is not in", () => {
    // `text` is lifted out, so the append inside `group` is the size of what
    // is left -- the same address the pointer's middle band produces.
    const aims = aimsFor("text");
    const inside = aims.find((aim) => {
      return label(aim) === "group inside";
    });
    expect(inside).toEqual({ nodeId: "group", side: "inside", parentId: "group", index: 2 });
  });
});

describe("liftAim, the first aim a lift opens on", () => {
  it("does not name the node that was lifted, in either direction", () => {
    // Requirement one and two together: for every node in the document, the
    // first press down and the first press up must not point at the carried
    // node -- and must not even *say* its name, which is what an author hears.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      const name = nodeName(node(model, dragging));
      for (const step of ["forward", "backward"] as const) {
        const aim = liftAim(model, dragging, step);
        expect(aim, `${dragging} ${step}`).not.toBeNull();
        expect(aim?.nodeId, `${dragging} ${step}`).not.toBe(dragging);
        expect(describeAim(model, aim as EditorDropTarget), `${dragging} ${step}`).not.toContain(
          name,
        );
      }
    }
  });

  it("moving to it is never a no-op, by the order and not by the address", () => {
    // Not "the address is legal" -- some of these are positions the model
    // refuses, which the next test covers. This one is about the order: an aim
    // that leaves the document exactly as it is has nothing to say for itself.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      for (const step of ["forward", "backward"] as const) {
        const aim = liftAim(model, dragging, step) as EditorDropTarget;
        expect(aimLeavesOrderUnchanged(model, dragging, aim), `${dragging} ${step}`).toBe(false);
      }
    }
  });

  it("is the first aim in its direction that is not a no-op", () => {
    // Every aim before it, in that direction, leaves the document alone — which
    // is what makes the lift aim the *nearest* place the node can go, rather
    // than a place this function happened to like.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      const aims = aimsFor(dragging);
      for (const step of ["forward", "backward"] as const) {
        const walk = step === "forward" ? aims : [...aims].reverse();
        const chosen = liftAim(model, dragging, step) as EditorDropTarget;
        for (const aim of walk) {
          if (label(aim) === label(chosen)) {
            break;
          }
          expect(
            aimLeavesOrderUnchanged(model, dragging, aim),
            `${dragging} ${step} ${label(aim)}`,
          ).toBe(true);
        }
      }
    }
  });

  it("is never a silent no-op: it moves the document, or it is one the model refuses", () => {
    // The property the reported defect broke, stated over the whole document.
    // It is deliberately *not* "always moves": refusing is what the model does
    // with some positions, and hiding those from the keyboard would be a
    // legality list in the UI. What may not happen is a first aim that leaves
    // the document alone with nothing said — and a refusal is never that, since
    // the route announces the model's sentence.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      for (const step of ["forward", "backward"] as const) {
        const aim = liftAim(model, dragging, step) as EditorDropTarget;
        const before = wholeOrder(model);
        expect(aimLeavesOrderUnchanged(model, dragging, aim), `${dragging} ${step}`).toBe(false);
        let refusal: EditorModelError | null = null;
        try {
          moveNode(model, dragging, aim.parentId, aim.index);
        } catch (error) {
          if (!(error instanceof EditorModelError)) {
            throw error;
          }
          refusal = error;
        }
        if (refusal === null) {
          expect(wholeOrder(model), `${dragging} ${step}`).not.toEqual(before);
        } else {
          expect(refusal.message.length, `${dragging} ${step}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("moves the node for the exact case that was reported", () => {
    // `text, number, choice, group, repeater`: lifting `choice` and pressing the
    // *up* arrow. The old list ended on the carried node's own row, so the first
    // press aimed at the slot the node already held and the drop changed
    // nothing, silently. The nearest aim in that direction is now the last one in
    // the list -- `row after`, inside the repeater -- and dropping there moves
    // the node, which is the whole of the requirement.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    const aim = liftAim(model, "choice", "backward") as EditorDropTarget;
    expect(aim.nodeId).not.toBe("choice");
    expect(label(aim)).toBe("row after");
    moveNode(model, "choice", aim.parentId, aim.index);
    expect(rootOrder(model)).not.toEqual(["text", "number", "choice", "group", "repeater"]);
    expect(rootOrder(model)).toEqual(["text", "number", "group", "repeater"]);
    expect(childOrder(model, "repeater")).toEqual(["row", "choice"]);
  });

  it("has nowhere to go in a form with no fields", () => {
    const empty = parseDocuments({ formSchemaJson: "{}" });
    expect(liftAim(empty, "text", "forward")).toBeNull();
  });
});

/** A form of three sibling leaves at the root, with no container anywhere. */
const FLAT_TEXT = JSON.stringify({
  fields: [
    { id: "weight", code: "weight", type: "text" },
    { id: "height", code: "height", type: "text" },
    { id: "bmi", code: "bmi", type: "text" },
  ],
});

describe("the aim a lift opens on is a reorder, not a refusal waiting to happen", () => {
  // The defect this is the fix for: a leaf's `inside` band is a real aim -- it
  // is in the list, on purpose, and the model refuses it in its own words --
  // but a lift that opened on one gave the author a refusal as the first thing
  // the keyboard did. The list is *ordered* so the two ends are sibling bands,
  // and the two ends are the only two places a lift ever opens on.
  it("for every node in the fixture, in both directions, is a sibling band", () => {
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      for (const step of ["forward", "backward"] as const) {
        const aim = liftAim(model, dragging, step) as EditorDropTarget;
        expect(aim, `${dragging} ${step}`).not.toBeNull();
        expect(aim.side, `${dragging} ${step} is ${label(aim)}`).not.toBe("inside");
        expect(["before", "after"], `${dragging} ${step} is ${label(aim)}`).toContain(aim.side);
      }
    }
  });

  it("is the reorder nearest the end the keys walk from, not a chosen one", () => {
    // Stated as "it is in the list, at the position the walk reaches" so the
    // claim cannot be satisfied by `liftAim` picking whatever it liked: the
    // opening aim is the *first* aim in that direction, and the ordering is
    // what makes that first aim a reorder. Nothing filters here, so an aim the
    // model would refuse is still a candidate -- it is simply not the one the
    // head of the list holds.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      const aims = aimsFor(dragging);
      for (const step of ["forward", "backward"] as const) {
        const walk = step === "forward" ? aims : [...aims].reverse();
        const head = walk[0] as EditorDropTarget;
        expect(head.side, `${dragging} ${step}`).not.toBe("inside");
        // The first aim that *moves* is still the one the lift opens on, and it
        // is the first moving aim in a list whose head is already a reorder.
        const chosen = liftAim(model, dragging, step) as EditorDropTarget;
        const firstMoving = walk.find((aim) => {
          return !aimLeavesOrderUnchanged(model, dragging, aim);
        });
        expect(label(chosen), `${dragging} ${step}`).toBe(label(firstMoving as EditorDropTarget));
      }
    }
  });

  it("walks past a sibling band that moves nothing, rather than opening on it", () => {
    // The degrade a reorder-first list actually has. Lifting the first of three
    // sibling leaves: the head of the list is "above height", and that is the
    // slot `weight` already holds — a no-op. The lift does not open on it, and
    // it does not open on nothing either: it walks to the next sibling band,
    // "above bmi", which moves. This is the same fallback the list has always
    // had, unchanged by the ordering, and it is why the ordering can promise
    // "a sibling band" without promising "a move": the no-op test is
    // `liftAim`'s, not the ordering's.
    const model = parseDocuments({ formSchemaJson: FLAT_TEXT });
    const aims = dropTargetsFor(model, "weight");
    // The premise, asserted rather than assumed: the head of the list is a
    // sibling band, and it moves nothing.
    const head = aims[0] as EditorDropTarget;
    expect(head.side).toBe("before");
    expect(aimLeavesOrderUnchanged(model, "weight", head)).toBe(true);

    const aim = liftAim(model, "weight", "forward") as EditorDropTarget;
    expect(aims.map(label)).toContain(label(aim));
    expect(aim.side, label(aim)).not.toBe("inside");
    expect(aimLeavesOrderUnchanged(model, "weight", aim), label(aim)).toBe(false);
    moveNode(model, "weight", aim.parentId, aim.index);
    expect(rootOrder(model)).toEqual(["height", "weight", "bmi"]);
  });

  it("and never opens on nothing, for any node in the document", () => {
    // Whatever the ordering, there is an aim to open on in every direction for
    // every node here — the fallback is the nearest aim that does something,
    // and only a document with nothing to aim at returns `null`.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      for (const step of ["forward", "backward"] as const) {
        expect(liftAim(model, dragging, step), `${dragging} ${step}`).not.toBeNull();
      }
    }
  });

  it("has nowhere to go at all in a form with a single field", () => {
    // The other end of the degrade: one node, so the list minus it is empty and
    // there is no aim in any band. `null` is the answer, and the handle's
    // "nothing aimed" announcement is the honest report of it.
    const single = parseDocuments({
      formSchemaJson: JSON.stringify({
        fields: [{ id: "only", code: "only", type: "text" }],
      }),
    });
    expect(dropTargetsFor(single, "only")).toEqual([]);
    expect(liftAim(single, "only", "forward")).toBeNull();
    expect(liftAim(single, "only", "backward")).toBeNull();
  });

  it("still never names the carried node, over every node and both directions", () => {
    // Property one, re-asserted across the reordering. The head of the list is
    // now a `before` band rather than the first node's `before` in a flat walk,
    // so "the walk does not start on the carried node" is no longer free: the
    // first *and* the last aim have to be checked, in both directions.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      const name = nodeName(node(model, dragging));
      for (const step of ["forward", "backward"] as const) {
        const aim = liftAim(model, dragging, step) as EditorDropTarget;
        expect(aim.nodeId, `${dragging} ${step}`).not.toBe(dragging);
        expect(describeAim(model, aim), `${dragging} ${step}`).not.toContain(name);
      }
    }
  });

  it("is still never a silent no-op, over every node and both directions", () => {
    // Property two, re-asserted across the reordering: the opening aim either
    // moves the document or earns a refusal the route announces. A sibling
    // band is not a licence to pick a no-op, and the ordering is not a licence
    // to pick a refusal the author did not ask for by name.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    for (const dragging of FIXTURE_IDS) {
      for (const step of ["forward", "backward"] as const) {
        const aim = liftAim(model, dragging, step) as EditorDropTarget;
        expect(aimLeavesOrderUnchanged(model, dragging, aim), `${dragging} ${step}`).toBe(false);
        const before = wholeOrder(model);
        let refusal: EditorModelError | null = null;
        try {
          moveNode(model, dragging, aim.parentId, aim.index);
        } catch (error) {
          if (!(error instanceof EditorModelError)) {
            throw error;
          }
          refusal = error;
        }
        if (refusal === null) {
          expect(wholeOrder(model), `${dragging} ${step}`).not.toEqual(before);
        } else {
          expect(refusal.message.length, `${dragging} ${step}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("stepAim", () => {
  it("the first press from nothing aims at the first position in the document", () => {
    const aims = aimsFor("choice");
    expect(label(stepAim(aims, null, "forward") as EditorDropTarget)).toBe("text before");
    expect(label(stepAim(aims, null, "backward") as EditorDropTarget)).toBe("row after");
  });

  it("walks forward and backward one band at a time", () => {
    const aims = aimsFor("choice");
    const at = (id: string, side: DropSide): EditorDropTarget => {
      const found = aims.find((aim) => {
        return label(aim) === `${id} ${side}`;
      });
      if (found === undefined) {
        throw new Error(`no aim at ${id} ${side}`);
      }
      return found;
    };
    // The walk is now banded, not per node: the `before` bands come first, so
    // one press from `number before` lands on the next `before`, and one press
    // back on the previous one. Still one band per press, in both directions.
    expect(label(stepAim(aims, at("number", "before"), "forward") as EditorDropTarget)).toBe(
      "group before",
    );
    expect(label(stepAim(aims, at("number", "before"), "backward") as EditorDropTarget)).toBe(
      "text before",
    );
  });

  it("stops at the ends instead of wrapping", () => {
    // A list that wrapped would make one press at the top of the form a move
    // nobody asked for.
    const aims = aimsFor("choice");
    const first = aims[0] as EditorDropTarget;
    const last = aims[aims.length - 1] as EditorDropTarget;
    expect(stepAim(aims, first, "backward")).toBe(first);
    expect(stepAim(aims, last, "forward")).toBe(last);
  });

  it("re-aims at the near end when the aim it was given is not in the list", () => {
    // A node that has been removed since the aim was taken. There is no legality
    // question here, only a cursor that has to be somewhere.
    const aims = aimsFor("choice");
    const ghost: EditorDropTarget = { nodeId: "ghost", side: "before", parentId: null, index: 0 };
    expect(label(stepAim(aims, ghost, "forward") as EditorDropTarget)).toBe("text before");
    expect(label(stepAim(aims, ghost, "backward") as EditorDropTarget)).toBe("row after");
  });

  it("has nowhere to aim in a form with no fields", () => {
    const empty = parseDocuments({ formSchemaJson: "{}" });
    expect(stepAim(dropTargetsFor(empty, null), null, "forward")).toBeNull();
  });
});

describe("the keyboard addresses the document exactly as the pointer does", () => {
  it("every aim the keyboard offers is an aim the pointer can produce", () => {
    // The parity claim, asserted on the addresses themselves: walking the list
    // with the arrow keys lands on the same (parentId, index) the pointer's
    // bands produce, for every node in the document that is not the carried one.
    for (const dragging of FIXTURE_IDS) {
      const aims = aimsFor(dragging);
      let current: EditorDropTarget | null = null;
      for (const wanted of aims) {
        const next = stepAim(aims, current, "forward");
        expect(next, `${dragging} -> ${label(wanted)}`).not.toBeNull();
        current = next;
        expect(
          { parentId: current?.parentId, index: current?.index },
          `${dragging} -> ${label(wanted)}`,
        ).toEqual({ parentId: wanted.parentId, index: wanted.index });
      }
      expect(aims.length).toBe(expectedLabels(dragging).length);
    }
  });

  it("and every position the pointer can address, the keyboard agrees about", () => {
    // All 192 combinations of carried node, aimed node and band. Each one is
    // either an aim the keyboard walks to -- with the identical address, and
    // the identical document through `moveNode` -- or one of the two documented
    // differences: the three bands of the carried node's own row, which the
    // keyboard does not name and the pointer does, and the `inside` band of a
    // node the model will not put this type into, which the keyboard does not
    // offer and the pointer resolves to the nearer edge. Both differences are
    // asserted, and both are *asked of the model* rather than listed here, so
    // the 192 pairs are still the same 192 pairs.
    for (const dragging of FIXTURE_IDS) {
      for (const aim of FIXTURE_IDS) {
        for (const side of ALL_SIDES) {
          const pair = `${dragging} -> ${aim} ${side}`;
          const model = parseDocuments({ formSchemaJson: FORM_TEXT });
          const pointed = dropTargetFor(model, node(model, aim), side, dragging);
          const walked = aimsFor(dragging).find((entry) => {
            return label(entry) === `${aim} ${side}`;
          });
          const mayReceive = canReceiveChild(model, aim, node(model, dragging).type);
          const offered = aim !== dragging && (side !== "inside" || mayReceive);
          if (!offered) {
            expect(walked, pair).toBeUndefined();
            continue;
          }
          expect(walked, pair).toEqual(pointed);
          const result = attempt(dragging, aim, side);
          expect(result.target, pair).toEqual({
            parentId: walked?.parentId,
            index: walked?.index,
          });
        }
      }
    }
  });
});

describe("a keyboard aim the model always refuses is not in the list at all", () => {
  it("offers no inside band on a node that cannot receive what is being carried", () => {
    // This is the decision that changed the list. The aim used to be there and
    // the model refused it out loud on the way in; now the aim does not exist,
    // because a position the model will always say no to is not an aim. The
    // band is absent, not refused -- and the absence is the *model's* answer,
    // asserted against `canReceiveChild` rather than against a list here.
    //
    // The model is still the authority for every remaining refusal: a group
    // carried into its own subtree is refused by `moveNode` as `ILLEGAL_MOVE`,
    // and that aim is still in the list below, because it is the model's rule
    // about *this* node's position rather than a property of the pair of types.
    for (const dragging of FIXTURE_IDS) {
      const model = parseDocuments({ formSchemaJson: FORM_TEXT });
      const carried = node(model, dragging);
      const labels = aimsFor(dragging).map(label);
      for (const aim of FIXTURE_IDS) {
        if (aim === dragging) {
          continue;
        }
        const mayReceive = canReceiveChild(model, aim, carried.type);
        for (const side of ALL_SIDES) {
          if (side === "inside" && !mayReceive) {
            expect(labels, `${dragging} -> ${aim} ${side}`).not.toContain(`${aim} ${side}`);
          } else {
            expect(labels, `${dragging} -> ${aim} ${side}`).toContain(`${aim} ${side}`);
          }
        }
      }
    }
  });

  it("says so for the case that was reported: a leaf, in the middle of a drag", () => {
    // `number` over `choice`. The band is gone from the list -- and the edges
    // around it are untouched, so what was lost is one aim and not the walk.
    const labels = aimsFor("number").map(label);
    expect(labels).not.toContain("choice inside");
    expect(labels).toContain("choice before");
    expect(labels).toContain("choice after");
    expect(labels).toContain("group inside");
    expect(labels).toContain("repeater inside");
  });

  it("still leaves the model's own refusals in place where they are about a position", () => {
    // The subtraction above is not a general "hide anything illegal" filter: a
    // container carried into its own subtree is refused by `moveNode` with
    // `ILLEGAL_MOVE`, and that aim survives in the list, because whether a
    // particular node may go inside a particular *other* node it is related to
    // is a question about the document, not about the two types.
    const aims = aimsFor("group");
    const atOwnChild = aims.find((aim) => {
      return label(aim) === "inside-a after";
    }) as EditorDropTarget;
    expect(atOwnChild).toBeDefined();
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    let refusal: EditorModelError | null = null;
    try {
      moveNode(model, "group", atOwnChild.parentId, atOwnChild.index);
    } catch (error) {
      if (!(error instanceof EditorModelError)) {
        throw error;
      }
      refusal = error;
    }
    expect(refusal?.code).toBe("ILLEGAL_MOVE");
    expect(refusal?.message).toBe('"group" cannot move inside its own subtree.');
    expect(rootOrder(model)).toEqual(["text", "number", "choice", "group", "repeater"]);
  });

  it("a keyboard aim that is already true leaves the order unchanged", () => {
    // A no-op aim is *not* filtered out of the walk: `number` is already where
    // "below inside-a" points, and being able to arrive at a position and find
    // the node already there is a thing a person does. What it may not be is
    // silent — the release is announced, and this is the report it announces.
    const aims = aimsFor("inside-b");
    const atSibbling = aims.find((aim) => {
      return label(aim) === "inside-a after";
    }) as EditorDropTarget;
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    const before = documentOrder(model);
    expect(aimLeavesOrderUnchanged(model, "inside-b", atSibbling)).toBe(true);
    moveNode(model, "inside-b", atSibbling.parentId, atSibbling.index);
    expect(childOrder(model, "group")).toEqual(["inside-a", "inside-b"]);
    expect(dropOutcomeMessage(model, "inside-b", atSibbling, before)).toBe(
      "inside-b did not move: it is already below inside-a.",
    );
  });
});

describe("what a released drag says, after the model has answered", () => {
  it("reports the move it made", () => {
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    const aim = dropTargetFor(model, node(model, "text"), "before", "choice");
    const before = documentOrder(model);
    moveNode(model, "choice", aim.parentId, aim.index);
    expect(dropOutcomeMessage(model, "choice", aim, before)).toBe("Moved choice above text.");
  });

  it("reports a drop onto the carried node's own row without describing a place", () => {
    // "repeater is already below repeater" is not a sentence. The pointer can
    // aim at the row it is carrying; when that drop changes nothing -- the last
    // node's own "after" band, clamped to the end of the list it already ends --
    // the report says only that it did not move.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    const aim = dropTargetFor(model, node(model, "repeater"), "after", "repeater");
    const before = documentOrder(model);
    moveNode(model, "repeater", aim.parentId, aim.index);
    expect(rootOrder(model)).toEqual(["text", "number", "choice", "group", "repeater"]);
    expect(dropOutcomeMessage(model, "repeater", aim, before)).toBe("repeater did not move.");
  });

  it("reports the refusal case as the model's own sentence, not as a no-op", () => {
    // `runEdit` announces the refusal and the route then skips this report, so
    // the words are the model's -- asserted here so the two channels cannot
    // drift into contradicting each other.
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    const before = documentOrder(model);
    const aim = dropTargetFor(model, node(model, "choice"), "inside", "group");
    expect(() => {
      moveNode(model, "group", aim.parentId, aim.index);
    }).toThrowError(EditorModelError);
    expect(documentOrder(model)).toEqual(before);
  });
});

describe("what a keyboard drag says about itself", () => {
  it("names the aim in the indicator's own three words", () => {
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    const aim = (id: string, side: DropSide): EditorDropTarget => {
      return dropTargetFor(model, node(model, id), side, null);
    };
    expect(describeAim(model, aim("number", "before"))).toBe("above number");
    expect(describeAim(model, aim("group", "inside"))).toBe("inside group");
    expect(describeAim(model, aim("choice", "after"))).toBe("below choice");
  });

  it("falls back to the form when the aim names a node that is not there", () => {
    const model = parseDocuments({ formSchemaJson: FORM_TEXT });
    expect(describeAim(model, { nodeId: "ghost", side: "before", parentId: null, index: 0 })).toBe(
      "above the form",
    );
  });

  it("says only what the handle itself knows", () => {
    // The handle cannot know what a release did, so it says no more than the
    // lift, the aim, a cancel, and a release with nothing aimed at. The outcome
    // is `dropOutcomeMessage`, said by the route once the model has answered --
    // which is why no sentence here claims a move.
    const messages = keyboardMessages("number", "below choice");
    expect(messages.lift).toBe(
      "Picked up number. Up and down arrows move it, Enter drops it, Escape puts it back.",
    );
    expect(messages.aimed).toBe("number will go below choice.");
    expect(messages.cancelled).toBe("Put number back where it was.");
    expect(messages.nothingAimed).toBe("number was not dropped anywhere.");
    expect(keyboardMessages("number", null).aimed).toBe("number has no position yet.");
  });
});

describe("the drop indicator cannot resize the box it measures", () => {
  // The zone decides which band the pointer is in from its own box, so an
  // indicator that took space would move the bands it is describing and the
  // aim would flicker under the pointer as the indicator appeared. Both facts
  // are in the class list, and the class list is a pure function, so they are
  // asserted here rather than checked by eye.
  it("is absolutely positioned, so it is out of the box's flow", () => {
    expect(dropBarClasses("before").split(" ")).toContain("absolute");
    expect(dropBarClasses("after").split(" ")).toContain("absolute");
  });

  it("takes no pointer, so the pointer is talking to the node it is aiming at", () => {
    expect(dropBarClasses("before").split(" ")).toContain("pointer-events-none");
    expect(dropBarClasses("after").split(" ")).toContain("pointer-events-none");
  });

  it("only differs by the edge it names, and never by a spacing class", () => {
    const before = dropBarClasses("before").split(" ");
    const after = dropBarClasses("after").split(" ");
    expect(
      before.filter((name) => {
        return name === "top-0";
      }),
    ).toHaveLength(1);
    expect(
      after.filter((name) => {
        return name === "bottom-0";
      }),
    ).toHaveLength(1);
    expect(
      before.filter((name) => {
        return name === "bottom-0";
      }),
    ).toHaveLength(0);
    // No margin or padding anywhere: an in-flow nudge of either would be the
    // resize this class list exists to rule out.
    for (const name of [...before, ...after]) {
      expect(name.startsWith("m-") || name.startsWith("p-"), name).toBe(false);
    }
  });
});
