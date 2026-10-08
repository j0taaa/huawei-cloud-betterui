/** Keep decimal API amounts exact until formatting; missing amounts are not zero. */
export function decimalAmount(value: unknown): string | null {
  if (value == null) return null;
  let text = String(value);
  // JSON numbers such as 0.0000001 stringify in exponent notation.
  if (typeof value === "number" && Number.isFinite(value)) {
    const scientific = text.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/);
    if (scientific) {
      const [, sign, whole, fraction = "", exponent] = scientific;
      const digits = whole + fraction;
      const point = whole.length + Number(exponent);
      text =
        sign +
        (point <= 0
          ? `0.${"0".repeat(-point)}${digits}`
          : point >= digits.length
            ? digits.padEnd(point, "0")
            : `${digits.slice(0, point)}.${digits.slice(point)}`);
    }
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(text))
    throw new Error("Invalid monetary amount in the billing response.");
  return text;
}

export function sumAmounts(values: string[]) {
  const scale = Math.max(
    0,
    ...values.map((value) => (value.split(".")[1] ?? "").length),
  );
  const unit = BigInt(10) ** BigInt(scale);
  const sum = values.reduce((total, value) => {
    decimalAmount(value);
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const amount =
      BigInt(whole) * unit + BigInt(fraction.padEnd(scale, "0") || "0");
    return total + (value.startsWith("-") ? -amount : amount);
  }, BigInt(0));
  const absolute = sum < 0 ? -sum : sum;
  const fraction = scale
    ? String(absolute % unit)
        .padStart(scale, "0")
        .replace(/0+$/, "")
    : "";
  return `${sum < 0 ? "-" : ""}${absolute / unit}${fraction ? `.${fraction}` : ""}`;
}

export function formatMoney(value: string | null, currency: string) {
  if (value == null || !currency) return "—";
  // Render a currency code explicitly, so USD is never mistaken for BRL.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value as `${number}`);
}
