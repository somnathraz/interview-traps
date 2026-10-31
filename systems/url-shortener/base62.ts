const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 125 → "21", 999 → "g7". Unique id in, unique short code out. */
export function toBase62(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`toBase62: bad id ${n}`);
  let out = "";
  do {
    out = ALPHABET[n % 62] + out;
    n = Math.floor(n / 62);
  } while (n > 0);
  return out;
}
