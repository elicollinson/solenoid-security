// Documents become text, and text goes through the measured pipeline.
//
// A document input is screened by extracting its text and screening that text
// exactly as a `{ type: "text" }` input would be: the same content-type
// recommendation, preprocessing, technique, authored-text redaction and
// decision rules. The extractor is the only new step, and the result records it.
//
// The built-in extractors cover text-like formats and need no dependencies:
// plain text, Markdown, HTML, JSON and CSV. PDF, DOCX and every other binary
// format need a caller-provided `DocumentExtractor` (a PDF library you already
// trust, a document service), unless a configured provider screens that format
// natively (Model Armor, see ./modelArmor.ts). With neither, the screen fails
// closed with `ScreeningError` code `"unsupported_input"`.
//
// Images embedded in a document are out of scope: an extractor returns text,
// and the library does not look for or screen images inside documents. Screen
// them separately as `{ type: "image" }` inputs if your extractor surfaces them.
/** Decodes a text document strictly: invalid bytes fail extraction rather than turning into replacement characters. */
export function documentText(document) {
    if (typeof document.text === "string")
        return document.text.replace(/^﻿/, "");
    let decoder;
    try {
        decoder = new TextDecoder(document.charset ?? "utf-8", { fatal: true });
    }
    catch {
        throw new Error(`Unsupported charset ${document.charset}`);
    }
    return decoder.decode(document.bytes);
}
// --- plain text and Markdown -------------------------------------------------
const plainText = {
    id: "builtin:text",
    mimeTypes: ["text/plain"],
    extract: (document) => ({ text: documentText(document) }),
};
/**
 * Markdown is screened as written, not rendered. That keeps what a renderer
 * would hide, such as HTML comments and link titles, in front of the screen.
 */
const markdown = {
    id: "builtin:markdown",
    mimeTypes: ["text/markdown", "text/x-markdown"],
    extract: (document) => ({ text: documentText(document) }),
};
// --- HTML ----------------------------------------------------------------------
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BLOCK = new Set([
    "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer", "form", "h1", "h2",
    "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "td", "th", "title", "tr", "ul",
]);
/** Attributes whose text a reader or a model may see but the page body does not show. */
const TEXT_ATTRIBUTES = ["alt", "title", "aria-label", "placeholder"];
/**
 * Inline styles that hide text from a human reader. A heuristic, not a CSS
 * engine: text hidden by a stylesheet class is reported as visible, which still
 * screens it. Nothing but markup and script/style bodies is ever dropped.
 */
const HIDING_STYLE = new RegExp([
    String.raw `display\s*:\s*none`,
    String.raw `visibility\s*:\s*(?:hidden|collapse)`,
    String.raw `opacity\s*:\s*0*(?:\.0+)?\s*(?:;|$|!)`,
    String.raw `font-size\s*:\s*0*(?:\.0+)?(?:[a-z%]+)?\s*(?:;|$|!)`,
    String.raw `(?:left|top|text-indent)\s*:\s*-\d{3,}`,
].join("|"), "i");
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
        if (name[0] === "#") {
            const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
        }
        return ENTITIES[name.toLowerCase()] ?? match;
    });
}
function parseAttributes(source) {
    const attributes = new Map();
    for (const [, name, double, single, bare] of source.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        attributes.set(name.toLowerCase(), decodeEntities(double ?? single ?? bare ?? ""));
    }
    return attributes;
}
function hides(tag, attributes) {
    return tag === "template" || attributes.has("hidden") || attributes.get("aria-hidden")?.toLowerCase() === "true" ||
        HIDING_STYLE.test(attributes.get("style") ?? "");
}
function tidy(text) {
    return text.replace(/[ \t\f\r ]+/g, " ").split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
/**
 * Visible text, then hidden text. Script and style bodies are dropped. Text a
 * human reader would not see but a model reading the page source would is
 * surfaced as a second segment: HTML comments, elements hidden with `hidden`,
 * `aria-hidden="true"`, `<template>` or an inline hiding style, hidden form
 * values, `alt`/`title`/`aria-label`/`placeholder` attributes and `<meta>`
 * content. Hidden text is a classic injection carrier, so it is screened rather
 * than discarded the way a renderer would discard it.
 */
export function extractHtml(html) {
    const visible = [];
    const hidden = [];
    const stack = [];
    let comments = 0;
    const inHidden = () => stack.some((entry) => entry.hidden);
    const token = /<!--([\s\S]*?)(?:-->|$)|<(script|style)\b[^>]*>[\s\S]*?(?:<\/\2\s*>|$)|<![^>]*>|<\?[^>]*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>|<\/([a-zA-Z][\w:-]*)\s*>/g;
    let last = 0;
    const text = (raw) => {
        if (!raw)
            return;
        (inHidden() ? hidden : visible).push(decodeEntities(raw));
    };
    for (const match of html.matchAll(token)) {
        text(html.slice(last, match.index));
        last = match.index + match[0].length;
        const [, comment, , open, attributeSource, close] = match;
        if (comment !== undefined) {
            comments += 1;
            if (comment.trim())
                hidden.push(comment);
        }
        else if (open) {
            const tag = open.toLowerCase();
            const attributes = parseAttributes(attributeSource ?? "");
            const isHidden = hides(tag, attributes) || (tag === "input" && attributes.get("type")?.toLowerCase() === "hidden");
            for (const name of TEXT_ATTRIBUTES)
                if (attributes.get(name)?.trim())
                    hidden.push(attributes.get(name));
            if (tag === "meta" && attributes.get("content")?.trim())
                hidden.push(attributes.get("content"));
            if (tag === "input" && isHidden && attributes.get("value")?.trim())
                hidden.push(attributes.get("value"));
            if (BLOCK.has(tag))
                (inHidden() ? hidden : visible).push("\n");
            if (!VOID.has(tag) && !match[0].endsWith("/>"))
                stack.push({ tag, hidden: isHidden });
        }
        else if (close) {
            const tag = close.toLowerCase();
            const at = stack.map((entry) => entry.tag).lastIndexOf(tag);
            if (at >= 0)
                stack.length = at;
            if (BLOCK.has(tag))
                (inHidden() ? hidden : visible).push("\n");
        }
    }
    text(html.slice(last));
    const visibleText = tidy(visible.join(""));
    const hiddenText = hidden.map((piece) => tidy(piece)).filter(Boolean).join("\n");
    const segments = [visibleText, hiddenText].filter(Boolean);
    return {
        text: segments.join("\n"),
        ...(segments.length ? { segments } : {}),
        metadata: { visibleChars: visibleText.length, hiddenChars: hiddenText.length, comments },
    };
}
const html = {
    id: "builtin:html",
    mimeTypes: ["text/html", "application/xhtml+xml"],
    extract: (document) => extractHtml(documentText(document)),
};
// --- JSON ----------------------------------------------------------------------
/**
 * Every string value, in document order, one per line. Numbers, booleans and
 * structure are dropped. Object keys are kept only when they contain
 * whitespace: an ordinary key (`"id"`) is noise, but a sentence used as a key
 * is text somebody wrote and could carry an instruction.
 */
export function extractJson(source) {
    const strings = [];
    const walk = (value) => {
        if (typeof value === "string")
            strings.push(value);
        else if (Array.isArray(value))
            value.forEach(walk);
        else if (value !== null && typeof value === "object") {
            for (const [key, inner] of Object.entries(value)) {
                if (/\s/.test(key))
                    strings.push(key);
                walk(inner);
            }
        }
    };
    walk(JSON.parse(source));
    return { text: strings.join("\n"), metadata: { strings: strings.length } };
}
const json = {
    id: "builtin:json",
    mimeTypes: ["application/json", "application/ld+json", "text/json"],
    extract: (document) => extractJson(documentText(document)),
};
// --- CSV -----------------------------------------------------------------------
/** RFC 4180 cells, unquoted, one row per line with cells separated by tabs. Empty rows are dropped. */
export function extractCsv(source) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        if (quoted) {
            if (char === "\"" && source[i + 1] === "\"") {
                cell += "\"";
                i += 1;
            }
            else if (char === "\"")
                quoted = false;
            else
                cell += char;
        }
        else if (char === "\"" && cell === "")
            quoted = true;
        else if (char === ",") {
            row.push(cell);
            cell = "";
        }
        else if (char === "\n" || char === "\r") {
            if (char === "\r" && source[i + 1] === "\n")
                i += 1;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        }
        else
            cell += char;
    }
    if (quoted)
        throw new Error("Unterminated quoted CSV field");
    if (cell !== "" || row.length) {
        row.push(cell);
        rows.push(row);
    }
    const kept = rows.filter((cells) => cells.some((value) => value.trim()));
    return {
        text: kept.map((cells) => cells.join("\t")).join("\n"),
        metadata: { rows: kept.length, columns: Math.max(0, ...kept.map((cells) => cells.length)) },
    };
}
const csv = {
    id: "builtin:csv",
    mimeTypes: ["text/csv"],
    extract: (document) => extractCsv(documentText(document)),
};
/** The dependency-free extractors every screen can use, consulted after any the caller supplies. */
export const BUILTIN_EXTRACTORS = [plainText, markdown, html, json, csv];
