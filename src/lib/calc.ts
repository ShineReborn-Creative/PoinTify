/**
 * Kalkulator kecil buat command palette. Parser sendiri (bukan eval), cuma
 * angka dan + - * / ^ % ( ). Balikin null kalau bukan hitungan.
 */
export function calc(input: string): number | null {
  let s = input.trim().replace(/\s+/g, "").replace(/[x×]/gi, "*").replace(/[÷:]/g, "/").replace(/=$/, "");
  if (!s || !/^[\d.,+\-*/^%()]+$/.test(s)) return null;
  // Harus ada operasinya, angka doang bukan hitungan.
  if (!/[+\-*/^%]/.test(s.replace(/^-/, ""))) return null;
  // "1,5" (koma desimal) vs "1,000.5" (koma ribuan).
  s = s.includes(".") ? s.replace(/,/g, "") : s.replace(/,/g, ".");

  let i = 0;
  const peek = () => s[i];
  const eat = (c: string) => (s[i] === c ? (i++, true) : false);

  function num(): number {
    const start = i;
    while (i < s.length && /[\d.]/.test(s[i])) i++;
    if (start === i) throw new Error("angka");
    const v = Number(s.slice(start, i));
    if (!Number.isFinite(v)) throw new Error("angka");
    return v;
  }
  function atom(): number {
    if (eat("-")) return -atom();
    if (eat("+")) return atom();
    let v: number;
    if (eat("(")) {
      v = expr();
      if (!eat(")")) throw new Error("kurung");
    } else v = num();
    // Persen di belakang angka: 15% = 0.15
    while (eat("%")) v /= 100;
    return v;
  }
  function power(): number {
    const base = atom();
    return eat("^") ? Math.pow(base, power()) : base;
  }
  function term(): number {
    let v = power();
    for (;;) {
      if (eat("*")) v *= power();
      else if (eat("/")) v /= power();
      else return v;
    }
  }
  /** "+ 5%" kayak kalkulator biasa: nambah 5% dari angka sebelumnya. */
  function percentOf(): number | null {
    const m = s.slice(i).match(/^(\d+(?:\.\d+)?)%(?=$|[+\-)])/);
    if (!m) return null;
    i += m[0].length;
    return Number(m[1]) / 100;
  }
  function expr(): number {
    let v = term();
    for (;;) {
      if (eat("+")) {
        const p = percentOf();
        v = p === null ? v + term() : v * (1 + p);
      } else if (eat("-")) {
        const p = percentOf();
        v = p === null ? v - term() : v * (1 - p);
      } else return v;
    }
  }
  try {
    const v = expr();
    if (i !== s.length || peek() !== undefined || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}
