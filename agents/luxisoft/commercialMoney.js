const cop = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// El catálogo y su caché conservan centavos. La IA solo ve pesos/dólares ya
// convertidos y su representación: nunca debe hacer esta aritmética.
export function normalizeCatalogMoneyForAgent(value) {
  if (Array.isArray(value)) return value.map(normalizeCatalogMoneyForAgent);
  if (!value || typeof value !== "object") return value;
  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.endsWith("MicroUsd") && Number.isSafeInteger(entry)) {
      const amount = entry / 1_000_000;
      normalized[key.replace(/MicroUsd$/, "Usd")] = {amount, currency:"USD", display:"US$" + usd.format(amount)};
      continue;
    }
    if (key.endsWith("Cents")) {
      if (typeof entry !== "number" || !Number.isSafeInteger(entry)) continue;
      const currency = /UsdCents$/i.test(key) ? "USD" :
        /CopCents$/i.test(key) || key === "monthlyEquivCents" ? "COP" : null;
      if (!currency) continue;
      const name = key === "monthlyEquivCents" ? "monthlyEquivCop" : key.slice(0, -5);
      const amount = entry / 100;
      normalized[name] = {
        amount,
        currency,
        display: currency === "COP" ? `$${cop.format(amount)} COP` : `US$${usd.format(amount)}`
      };
      if (key === "includedCopCents") normalized.includedAiTokens = {
        amount: entry / 10,
        unit: "Tokens LuxiSoft",
        display: `${cop.format(entry / 10)} Tokens`
      };
      continue;
    }
    normalized[key] = normalizeCatalogMoneyForAgent(entry);
  }
  return normalized;
}

