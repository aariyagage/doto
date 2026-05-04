import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// HTTP header values must be pure ASCII per the ByteString spec that
// Node's `fetch` enforces (matches RFC 7230 visible-ASCII range
// 0x20-0x7E). UTF-8 characters -- em dashes, smart quotes, anything
// non-ASCII -- silently break Node fetch with cryptic ByteString errors.
//
// Established the hard way in commit 5f1e481 (Reddit User-Agent fix),
// memorized in feedback_http_headers_ascii.md. Any new code that sets
// response headers should validate through this helper, especially when
// the value comes from user content or LLM output.
//
// Returns the value if valid; throws otherwise so the caller can decide
// whether to fall back to a sanitized version or surface as a 5xx.
export function assertAsciiHeader(value: string, fieldName: string): string {
    // 0x20 (space) through 0x7E (tilde) are the printable ASCII range.
    // Tab (0x09) is technically allowed in headers but rare; reject for
    // simplicity. Newlines (0x0A, 0x0D) would be header-injection vectors;
    // reject hard.
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code > 0x7E) {
            throw new Error(
                `Header "${fieldName}" contains non-ASCII byte ${code.toString(16).padStart(4, '0')} at position ${i}: ${JSON.stringify(value)}`,
            );
        }
    }
    return value;
}

// Soft variant — sanitizes instead of throwing. Replaces non-ASCII bytes
// with '?'. Use for error messages or trace IDs we'd rather see truncated
// than have the whole response 5xx.
export function toAsciiHeader(value: string): string {
    let out = '';
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        out += code >= 0x20 && code <= 0x7E ? value[i] : '?';
    }
    return out;
}
