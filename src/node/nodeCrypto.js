const encoder = new TextEncoder();

const HMAC_SHA256 = {
    name: 'HMAC',
    hash: 'SHA-256',
};

const bytesToHex = bytes =>
    Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/**
 * Generates an HMAC-SHA256 signature for a query string.
 *
 * Compatible with Node.js, Cloudflare Workers and Deno Deploy.
 *
 * @param {string} queryString
 * @param {string} API_SECRET
 * @returns {Promise<string>} Lowercase hexadecimal HMAC signature.
 */
export const getSignature = async (queryString, API_SECRET) => {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(API_SECRET),
        HMAC_SHA256,
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(queryString)
    );

    return bytesToHex(new Uint8Array(signature));
};