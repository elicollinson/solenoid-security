export type TextOrigin = 
/**
 * The person operating this assistant, typing to it. Not "the first message"
 * — actually them.
 *
 * They are the principal: they can already ask for anything the agent can do,
 * so there is no privilege here for an injection to escalate to. A flag on
 * their text means "this person may have pasted something", which is worth
 * recording and is not worth refusing to work over.
 */
"operator"
/**
 * This system's own model, quoted back to itself.
 *
 * A chat replays its transcript on every turn, so the assistant's prose from
 * turn three is an input on turn four. That text was already screened when it
 * was produced — at the `model_output` boundary, where a flag ABORTS — so
 * screening it again to the same standard is double jeopardy with a cost: the
 * screen concatenates everything of one origin before it looks, and a long
 * enough conversation of individually-clean turns can cross the threshold on
 * the join alone. A chat that becomes unusable at turn twenty is the failure
 * that produces.
 *
 * The narrow claim being made, and the only one: text that came out of a
 * model in THIS process, on a previous turn of THIS conversation. Never a
 * model's output relayed from anywhere else — that is somebody else's text
 * arriving over a wire, which is `external`.
 */
 | "agent"
/**
 * Read from the world: messages, screenshots, pages, email, a database row
 * holding text somebody else wrote. The default, and the reason the screen
 * exists.
 */
 | "external";
/** What a caller who says nothing gets. The safe one, deliberately. */
export declare const DEFAULT_ORIGIN: TextOrigin;
/**
 * "abort" — stop the run. "observe" — record it on the span, log it, continue.
 */
export type ScreenAction = "abort" | "observe";
export declare const ORIGIN_ACTION: Record<TextOrigin, ScreenAction>;
export declare function actionFor(origin: TextOrigin | undefined): ScreenAction;
