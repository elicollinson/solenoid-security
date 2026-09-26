/** What a caller who says nothing gets. The safe one, deliberately. */
export const DEFAULT_ORIGIN = "external";
export const ORIGIN_ACTION = {
    operator: "observe",
    agent: "observe",
    external: "abort",
};
export function actionFor(origin) {
    return ORIGIN_ACTION[origin ?? DEFAULT_ORIGIN];
}
