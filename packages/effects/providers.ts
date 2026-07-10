export type AccountingProvider = "quickbooks" | "xero" | "contaazul" | "contabilium";

export type ProviderCapabilities = {
  provider: AccountingProvider;
  nativeIdempotency: boolean;
  lookupByReference: boolean;
  searchWindowDays: number;
  voidOrUpdate: boolean;
  attachmentSupport: boolean;
};

const aliases: Readonly<Record<string, AccountingProvider>> = {
  quickbooks: "quickbooks",
  qbo: "quickbooks",
  xero: "xero",
  "conta-azul": "contaazul",
  contaazul: "contaazul",
  contabilium: "contabilium",
};

const capabilities: Readonly<Record<AccountingProvider, ProviderCapabilities>> = {
  quickbooks: { provider: "quickbooks", nativeIdempotency: true, lookupByReference: true, searchWindowDays: 30, voidOrUpdate: true, attachmentSupport: true },
  xero: { provider: "xero", nativeIdempotency: true, lookupByReference: true, searchWindowDays: 30, voidOrUpdate: true, attachmentSupport: true },
  contaazul: { provider: "contaazul", nativeIdempotency: false, lookupByReference: true, searchWindowDays: 30, voidOrUpdate: false, attachmentSupport: false },
  contabilium: { provider: "contabilium", nativeIdempotency: false, lookupByReference: true, searchWindowDays: 30, voidOrUpdate: false, attachmentSupport: true },
};

export function normalizeAccountingProvider(input: string): AccountingProvider {
  const provider = aliases[input.trim().toLowerCase()];
  if (!provider) throw new Error(`unsupported accounting provider: ${input}`);
  return provider;
}

export function providerCapabilities(input: string): ProviderCapabilities {
  return capabilities[normalizeAccountingProvider(input)];
}
