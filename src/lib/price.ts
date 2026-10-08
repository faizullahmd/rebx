/**
 * Utility for parsing and formatting property prices, with full support for
 * Indian numbering system (Crores, Lakhs), ranges (e.g., "10.58 Cr - 11.96 Cr"),
 * and rupee (₹) currency formatting.
 */

export function parsePriceInput(raw: string | number | undefined | null): {
  numericPrice: number;
  priceDisplay: string | null;
} {
  if (raw === undefined || raw === null) {
    return { numericPrice: 0, priceDisplay: null };
  }

  const str = String(raw).trim();
  if (!str) {
    return { numericPrice: 0, priceDisplay: null };
  }

  // Strip currency prefixes for cleaner matching
  const cleaned = str
    .replace(/^[₹RsINR$\s]+/i, "")
    .trim();

  // Check if this looks like a custom price string (contains Cr, L, Lakh, Crore, or a range "-")
  const isCustomFormat = /[a-zA-Z\-]/.test(cleaned);

  // Helper to parse a single token like "10.58 Cr", "85 L", "1.5 Crore", "5000000"
  function parseSingleToken(token: string): number {
    const t = token.trim().toLowerCase();
    const numMatch = t.match(/([\d,]+(?:\.\d+)?)/);
    if (!numMatch) return 0;

    const num = parseFloat(numMatch[1].replace(/,/g, ""));
    if (isNaN(num)) return 0;

    if (t.includes("cr") || t.includes("crore")) {
      return Math.round(num * 10000000);
    }
    if (t.includes("lakh") || t.includes("lac") || /\bl\b/.test(t) || t.endsWith("l")) {
      return Math.round(num * 100000);
    }
    if (t.includes("k") || t.includes("thousand")) {
      return Math.round(num * 1000);
    }

    return num;
  }

  if (cleaned.includes("-")) {
    const parts = cleaned.split("-").map((p) => p.trim());
    const firstPart = parts[0];
    const secondPart = parts[1] || "";

    // If second part specifies unit (e.g., "10.58 - 11.96 Cr"), inherit to first part if first part lacks unit
    let token1 = firstPart;
    if (
      !/[a-zA-Z]/.test(token1) &&
      (secondPart.toLowerCase().includes("cr") || secondPart.toLowerCase().includes("crore"))
    ) {
      token1 = `${token1} Cr`;
    } else if (
      !/[a-zA-Z]/.test(token1) &&
      (secondPart.toLowerCase().includes("l") || secondPart.toLowerCase().includes("lakh"))
    ) {
      token1 = `${token1} L`;
    }

    const num1 = parseSingleToken(token1);
    const num2 = parseSingleToken(secondPart);
    const numeric = num1 > 0 ? num1 : num2;

    return {
      numericPrice: numeric,
      priceDisplay: cleaned,
    };
  }

  // Single token with letters (e.g. "10.58 Cr", "85 L")
  if (isCustomFormat) {
    const numeric = parseSingleToken(cleaned);
    return {
      numericPrice: numeric,
      priceDisplay: cleaned,
    };
  }

  // Plain number (e.g., "4500000", "4,500,000")
  const numeric = parseFloat(cleaned.replace(/,/g, ""));
  return {
    numericPrice: isNaN(numeric) ? 0 : numeric,
    priceDisplay: null,
  };
}

/**
 * Formats a listing's price with support for priceDisplay, rupees (₹), and compact formats.
 */
export function formatListingPrice(
  price: number | string | { toString(): string } | null | undefined,
  currency = "INR",
  priceDisplay?: string | null
): string {
  const symbol =
    currency === "INR" || currency === "₹" || currency === "Rs" || !currency
      ? "₹"
      : currency === "USD" || currency === "$"
        ? "$"
        : currency === "EUR" || currency === "€"
          ? "€"
          : currency === "GBP" || currency === "£"
            ? "£"
            : `${currency} `;

  // If priceDisplay is explicitly provided (e.g., "10.58 Cr - 11.96 Cr")
  if (priceDisplay && priceDisplay.trim()) {
    const trimmed = priceDisplay.trim();
    if (trimmed.startsWith("₹") || trimmed.startsWith("$") || trimmed.startsWith("€") || trimmed.startsWith("£")) {
      return trimmed;
    }
    return `${symbol} ${trimmed}`;
  }

  const num = typeof price === "number" ? price : parseFloat(String(price || 0));
  if (isNaN(num) || num <= 0) {
    return "Price on Request";
  }

  // Indian format for INR / ₹
  if (symbol === "₹") {
    if (num >= 10000000) {
      const cr = (num / 10000000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
      return `₹ ${cr} Cr`;
    }
    if (num >= 100000) {
      const l = (num / 100000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
      return `₹ ${l} Lakh`;
    }
    return `₹ ${Math.round(num).toLocaleString("en-IN")}`;
  }

  // International format
  return `${symbol}${Math.round(num).toLocaleString("en-US")}`;
}
