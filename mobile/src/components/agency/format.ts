// Money and date formatting shared by the agency practitioner dashboard.
export const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const moneyShort = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);

// "2026-10-06" -> "Oct 6", without timezone drift (date-only strings parse as UTC)
export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export const monthLabel = (month: string, style: "long" | "short" = "long") => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", style === "long" ? { month: "long", year: "numeric" } : { month: "long" });
};

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
