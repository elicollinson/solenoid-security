// Bytes in, bytes checked: the shared handling for image and document inputs.
//
// The library never fetches anything on a caller's behalf. An input carries its
// own bytes, as a Uint8Array, a base64 string or a `data:` URL; an `http(s)` URL
// is refused with a TypeError rather than fetched. Fetching would make the
// screen an SSRF primitive (an injected instruction that names an internal URL
// gets the screen to request it), would screen whatever the server returns at
// that moment rather than what the agent later reads, and would hide a network
// call inside what callers treat as a local check. Download it yourself, with
// your own allowlist and size cap, then pass the bytes.

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
export function normalizeMimeType(value: unknown, what: string): string {
  if (typeof value !== "string" || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value.split(";")[0]!.trim().toLowerCase())) {
    throw new TypeError(`${what} needs a mimeType such as image/png`);
  }
  const type = value.split(";")[0]!.trim().toLowerCase();
  return type === "image/jpg" ? "image/jpeg" : type;
}

/** The `charset` parameter of a MIME type, if any. */
export function charsetOf(value: string | undefined): string | undefined {
  return value?.match(/;\s*charset\s*=\s*"?([^";\s]+)"?/i)?.[1];
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64(value: string, what: string): Uint8Array {
  const compact = value.replace(/\s+/g, "");
  if (compact.length % 4 !== 0 || !BASE64.test(compact)) throw new TypeError(`${what} data is not valid base64`);
  return new Uint8Array(Buffer.from(compact, "base64"));
}

/**
 * Turns `data` into bytes and a MIME type. A `data:` URL supplies its own type,
 * which must agree with `mimeType` when both are given. Throws a TypeError for a
 * remote URL, malformed base64, a non-base64 data URL, or no bytes at all.
 */
export function readBinary(data: unknown, mimeType: unknown, what: string): { bytes: Uint8Array; mimeType: string } {
  let bytes: Uint8Array;
  let declared = mimeType;
  if (data instanceof Uint8Array) {
    bytes = data;
  } else if (typeof data === "string") {
    if (/^\s*(https?|ftp|file):/i.test(data)) {
      throw new TypeError(`${what}: remote URLs are not fetched by the library; download the bytes yourself and pass them as data`);
    }
    const url = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(data.trim());
    if (url) {
      if (!/;base64$/i.test(url[2]!)) throw new TypeError(`${what}: only base64 data URLs are accepted`);
      const urlType = normalizeMimeType(url[1], what);
      if (mimeType !== undefined && normalizeMimeType(mimeType, what) !== urlType) {
        throw new TypeError(`${what}: mimeType ${String(mimeType)} disagrees with the data URL's ${urlType}`);
      }
      declared = urlType;
      bytes = decodeBase64(url[3]!, what);
    } else {
      bytes = decodeBase64(data, what);
    }
  } else {
    throw new TypeError(`${what} data must be a Uint8Array, a base64 string or a data: URL`);
  }
  if (bytes.byteLength === 0) throw new TypeError(`${what} data is empty`);
  return { bytes, mimeType: normalizeMimeType(declared, what) };
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export function dataUrl(content: Pick<BinaryContent, "mimeType" | "base64">): string {
  return `data:${content.mimeType};base64,${content.base64}`;
}

/** The image type the leading bytes identify, or undefined for an unrecognized signature. */
export function sniffImageType(bytes: Uint8Array): string | undefined {
  const at = (offset: number, ...values: number[]) => values.every((value, i) => bytes[offset + i] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x42, 0x4d)) return "image/bmp";
  return undefined;
}
