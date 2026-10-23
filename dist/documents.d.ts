/** What an extractor receives. */
export interface DocumentContent {
    /** Lowercase, without parameters. */
    mimeType: string;
    /** The `charset` parameter of the declared MIME type, if any. */
    charset?: string;
    filename?: string;
    /** The raw bytes. For a `text` input, its UTF-8 encoding. */
    bytes: Uint8Array;
    /** Present when the caller passed the document as a string. */
    text?: string;
}
/** What an extractor returns. */
export interface ExtractedDocument {
    /** All the text to screen. */
    text: string;
    /**
     * Optional parts (pages, sections), screened together like a `content` array:
     * when present they are screened instead of `text`, and a full-text screen
     * joins them with a newline.
     */
    segments?: readonly string[];
    /** Recorded on the result, e.g. page counts. Keep it small and free of document text. */
    metadata?: Record<string, unknown>;
}
/**
 * Turns one or more document formats into text. Caller-provided extractors are
 * consulted before the built-ins, in order, so a caller can replace the built-in
 * HTML extractor or add one for PDF. Throwing fails the screen closed with code
 * `"extraction_failed"`.
 */
export interface DocumentExtractor {
    /** Recorded on the result: `"builtin:html"`, `"pdfjs"`. */
    readonly id: string;
    /** Exact, lowercase MIME types this extractor handles. */
    readonly mimeTypes: readonly string[];
    extract(document: DocumentContent): ExtractedDocument | Promise<ExtractedDocument>;
}
/** Decodes a text document strictly: invalid bytes fail extraction rather than turning into replacement characters. */
export declare function documentText(document: DocumentContent): string;
/**
 * Visible text, then hidden text. Script and style bodies are dropped. Text a
 * human reader would not see but a model reading the page source would is
 * surfaced as a second segment: HTML comments, elements hidden with `hidden`,
 * `aria-hidden="true"`, `<template>` or an inline hiding style, hidden form
 * values, `alt`/`title`/`aria-label`/`placeholder` attributes and `<meta>`
 * content. Hidden text is a classic injection carrier, so it is screened rather
 * than discarded the way a renderer would discard it.
 */
export declare function extractHtml(html: string): ExtractedDocument;
/**
 * Every string value, in document order, one per line. Numbers, booleans and
 * structure are dropped. Object keys are kept only when they contain
 * whitespace: an ordinary key (`"id"`) is noise, but a sentence used as a key
 * is text somebody wrote and could carry an instruction.
 */
export declare function extractJson(source: string): ExtractedDocument;
/** RFC 4180 cells, unquoted, one row per line with cells separated by tabs. Empty rows are dropped. */
export declare function extractCsv(source: string): ExtractedDocument;
/** The dependency-free extractors every screen can use, consulted after any the caller supplies. */
export declare const BUILTIN_EXTRACTORS: readonly DocumentExtractor[];
