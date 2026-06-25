/** Generate a readable, reasonably strong credential an operator can hand to a user. Uses the Web
 * Crypto API; avoids ambiguous characters (0/O, 1/l/I). */
export function randomSecret(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('') + '!9';
}
