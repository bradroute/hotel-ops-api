// src/config/dids.js
export const OUR_DIDS = new Set([
  '+16515717007', // Crosby SMS DID
  // add others as you onboard
]);
export const isOurDid = (n) => !!n && OUR_DIDS.has(String(n));
export const e164 = (n) => (n ? String(n).replace(/[^\d+]/g, '') : n);
