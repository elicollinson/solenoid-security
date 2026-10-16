/** Bytes as a caller supplies them. A string is base64, or a `data:<mime>;base64,` URL. */
export type BinaryData = Uint8Array | string;
/** Normalized bytes handed to a provider or an extractor. */
export interface BinaryContent {
    /** Lowercase, without parameters: `image/png`, `application/pdf`. */
    mimeType: string;
    bytes: Uint8Array;
    /** Standard base64 of `bytes`, no line breaks. */
    base64: string;
    filename?: string;
}
/** `image/png; charset=x` -> `image/png`. */
export declare function normalizeMimeType(value: unknown, what: string): string;
/** The `charset` parameter of a MIME type, if any. */
export declare function charsetOf(value: string | undefined): string | undefined;
/**
 * Turns `data` into bytes and a MIME type. A `data:` URL supplies its own type,
 * which must agree with `mimeType` when both are given. Throws a TypeError for a
 * remote URL, malformed base64, a non-base64 data URL, or no bytes at all.
 */
export declare function readBinary(data: unknown, mimeType: unknown, what: string): {
    bytes: Uint8Array;
    mimeType: string;
};
export declare function toBase64(bytes: Uint8Array): string;
export declare function dataUrl(content: Pick<BinaryContent, "mimeType" | "base64">): string;
/** The image type the leading bytes identify, or undefined for an unrecognized signature. */
export declare function sniffImageType(bytes: Uint8Array): string | undefined;
