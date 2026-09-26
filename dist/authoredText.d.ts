/**
 * Short strings are refused. A generic sentence registered as authored would
 * silently blank itself out of every external document that happened to contain
 * it, and the shorter it is the more documents that is. Forty characters is not
 * a proof of anything; it is enough to keep a stock phrase out.
 */
export declare const MIN_AUTHORED_LENGTH = 40;
export interface AuthoredEntry {
    /** Where it came from, for the trace: "tool:recommendations_list". */
    label: string;
    text: string;
}
export declare class AuthoredTextRegistry {
    /** Keyed by text so the same string registered twice is one entry. */
    private readonly entries;
    /** Longest first: a briefing must be removed before the tool descriptions
     *  inside it, or their removal would leave the briefing unmatchable. */
    private ordered;
    /**
     * Declare that this repository wrote `text`.
     *
     * Read the rule at the top of this file first. Returns whether it was new, so
     * a caller can register in a loop without counting.
     */
    register(label: string, text: string): boolean;
    /**
     * Register `text` if it is long enough to be worth removing, and say nothing
     * if it is not.
     *
     * For the framework's own bulk registration — every tool description, every
     * briefing — where a description too short to redact is not a mistake anyone
     * needs told about. Use `register` where you meant a specific string and want
     * to hear that it did not take.
     */
    offer(label: string, text: string): boolean;
    /**
     * `text` with every registered span removed.
     *
     * Exact substring matching, deliberately: a fuzzy match is a way for somebody
     * to get their own text treated as ours by writing something near enough to a
     * string of ours. The cost is that a model paraphrasing its instructions is
     * not redacted — it is only screened, which is what should happen to text
     * nobody can prove we wrote.
     */
    redact(text: string): string;
    /** Whether anything survives redaction. Whitespace is not something to screen. */
    hasUnauthored(text: string): boolean;
    get size(): number;
    list(): AuthoredEntry[];
    /** For tests. The process-wide registry is otherwise append-only by design. */
    clear(): void;
}
/**
 * The process-wide registry.
 *
 * Process-wide rather than per-Agent because the things that register are
 * process-wide: a tool defined at module load does not know which agents will
 * hold it. Nothing here is secret and nothing is per-user — it is a list of
 * strings already compiled into the binary — so there is nothing for one agent
 * to learn from another's entries.
 */
export declare const authoredText: AuthoredTextRegistry;
