import { encode, PaymentOptions, CurrencyCode } from 'bysquare/pay'

// Reťazec pre QR kód PAY by square (slovenský štandard, čítajú ho bankové appky)
export function payBySquare(opts: { iban: string; beneficiary: string; amountCents: number; variableSymbol: string; note: string }) {
  return encode({
    payments: [
      {
        type: PaymentOptions.PaymentOrder,
        amount: opts.amountCents / 100,
        currencyCode: CurrencyCode.EUR,
        variableSymbol: opts.variableSymbol,
        paymentNote: opts.note.slice(0, 140),
        bankAccounts: [{ iban: opts.iban.replace(/\s+/g, '') }],
        beneficiary: { name: opts.beneficiary.slice(0, 70) },
      },
    ],
  })
}
