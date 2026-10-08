export function seededRandom(seed) {
    let state = seed >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}
export function validateTechnique(technique) {
    if (technique.kind === "random_word_chunks") {
        if (!Number.isInteger(technique.minWords) || !Number.isInteger(technique.maxWords) || technique.minWords < 1 || technique.maxWords < technique.minWords)
            throw new Error("Invalid chunk bounds");
        if (technique.seed !== undefined && !Number.isInteger(technique.seed))
            throw new Error("Non-integer segmentation seed");
    }
    else if (technique.kind === "sliding_word_window" || technique.kind === "sliding_word_window_preserve_v1") {
        if (!Number.isInteger(technique.windowWords) || !Number.isInteger(technique.strideWords) || technique.windowWords < 1 || technique.strideWords < 1 || technique.strideWords > technique.windowWords)
            throw new Error("Invalid sliding window: strideWords must be from 1 to windowWords");
    }
    else if (technique.kind !== "full_text" && technique.kind !== "decoded_preview_v1") {
        throw new Error(`Unknown screening technique: ${technique.kind}`);
    }
}
export function validateAggregator(aggregator) {
    if (aggregator === "any" || aggregator === "all" || typeof aggregator === "function")
        return;
    if (aggregator?.kind !== "score" || !["max", "mean", "min"].includes(aggregator.reduce) || ![undefined, ">", ">="].includes(aggregator.comparator) ||
        typeof aggregator.threshold !== "number" || aggregator.threshold < 0 || aggregator.threshold > 1) {
        throw new Error("Invalid screening aggregator");
    }
}
/** Splits text into the segments a technique screens. Whitespace-only text has none. */
export function segmentText(text, technique) {
    validateTechnique(technique);
    if (!text.trim())
        return [];
    if (technique.kind === "full_text")
        return [{ index: 0, text }];
    if (technique.kind === "decoded_preview_v1")
        return [{ index: 0, text: decodedPreviewV1(text) }];
    if (technique.kind === "sliding_word_window_preserve_v1") {
        const words = [...text.matchAll(/\S+/gu)];
        const output = [];
        for (let start = 0; start < words.length; start += technique.strideWords) {
            const end = Math.min(start + technique.windowWords, words.length);
            // Whitespace belongs to the following word; retain trailing whitespace at EOF.
            // This makes a whole-source window byte-identical to full_text, and contiguous
            // nonoverlapping windows concatenate back to the exact original source.
            const from = start === 0 ? 0 : words[start - 1].index + words[start - 1][0].length;
            const to = end === words.length ? text.length : words[end - 1].index + words[end - 1][0].length;
            output.push({ index: output.length, text: text.slice(from, to), startWord: start, endWord: end });
        }
        return output;
    }
    const words = text.trim().split(/\s+/).filter(Boolean);
    const random = technique.kind === "random_word_chunks"
        ? technique.seed === undefined ? Math.random : seededRandom(technique.seed)
        : undefined;
    const output = [];
    let start = 0;
    while (start < words.length) {
        const remaining = words.length - start;
        const length = technique.kind === "random_word_chunks"
            ? (() => { const upper = Math.min(technique.maxWords, remaining); const lower = Math.min(technique.minWords, remaining); return lower >= upper ? lower : lower + Math.floor(random() * (upper - lower + 1)); })()
            : Math.min(remaining, technique.windowWords);
        const end = start + length;
        output.push({ index: output.length, text: words.slice(start, end).join(" "), startWord: start, endWord: end });
        start = technique.kind === "random_word_chunks" ? end : start + technique.strideWords;
    }
    return output;
}
/** Cheap local preprocessing, not an execution engine. No recursive decoding.
 * Keep original evidence. Unicode NFKC/removal of invisible format characters,
 * strict UTF-8 Base64 blocks, and escaped Unicode/percent text receive previews.
 * At most8 unique views,8k characters each,32k characters total are appended.
 */
export function decodedPreviewV1(text) {
    const views = [];
    let total = 0;
    const add = (value) => {
        if (value === text || !value.trim() || views.includes(value) || views.length >= 8 || total >= 32768)
            return;
        const bounded = value.slice(0, Math.min(8192, 32768 - total));
        views.push(bounded);
        total += bounded.length;
    };
    add(text.normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, ""));
    if (/\\u[0-9a-fA-F]{4}/u.test(text))
        add(text.replace(/\\u([0-9a-fA-F]{4})/gu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))));
    if (/%[0-9a-fA-F]{2}/u.test(text)) {
        try {
            add(decodeURIComponent(text));
        }
        catch { /* Invalid encodings retain original. */ }
    }
    for (const match of text.matchAll(/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/=])/gu)) {
        const token = match[0];
        if (token.length > 16384 || token.length % 4 !== 0)
            continue;
        try {
            const bytes = Buffer.from(token, "base64");
            if (bytes.toString("base64") !== token)
                continue;
            const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(decoded))
                continue;
            if (decoded.trim().split(/\s+/u).length >= 3)
                add(decoded);
        }
        catch { /* Binary data is not a text preview. */ }
    }
    return views.length ? text + "\n\n[Decoded text previews]\n" + views.map((view, i) => `[View ${i + 1}]\n${view}`).join("\n") : text;
}
/** Applies an aggregator, returning the case flag and the score that summarizes it. */
export function aggregate(results, aggregator) {
    const scores = results.map(({ assessment }) => assessment.score);
    const max = Math.max(0, ...scores);
    if (aggregator === "any")
        return { flagged: results.some(({ assessment }) => assessment.flagged), score: max };
    if (aggregator === "all")
        return { flagged: results.length > 0 && results.every(({ assessment }) => assessment.flagged), score: max };
    if (typeof aggregator === "function")
        return { flagged: aggregator(results) === true, score: max };
    if (scores.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error("Score aggregation requires provider scores from 0 to 1");
    }
    const score = aggregator.reduce === "max" ? max
        : aggregator.reduce === "min" ? Math.min(...scores)
            : scores.reduce((sum, value) => sum + value, 0) / scores.length;
    return { flagged: aggregator.comparator === ">=" ? score >= aggregator.threshold : score > aggregator.threshold, score };
}
