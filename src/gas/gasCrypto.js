const bytesToHex = bytes =>
    Array.from(bytes, byte => (byte & 0xff).toString(16).padStart(2, '0')).join('');

export const getSignature = (queryString, API_SECRET) => {
    const signatureBytes = Utilities.computeHmacSha256Signature(queryString, API_SECRET);

    const signatureHex = signatureBytes
        .map(byte => (byte & 0xff).toString(16).padStart(2, '0'))
        .join('');

    return signatureHex;
}