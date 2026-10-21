import { encode, PaymentOptions, CurrencyCode } from 'bysquare/pay'
import { Version } from 'bysquare'

// Reťazec pre QR kód PAY by square (slovenský štandard, čítajú ho bankové appky).
// Verzia 1.1.0: s novšou 1.2.0 (od 4/2025, predvolená v knižnici) QR fungoval iba v Tatra banke, iné appky hlásili chybu (10/2026).
const ascii = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '').trim()

export function payBySquare(opts: { iban: string; beneficiary: string; amountCents: number; variableSymbol: string; note: string }) {
  return encode({
    payments: [
      {
        type: PaymentOptions.PaymentOrder,
        amount: opts.amountCents / 100,
        currencyCode: CurrencyCode.EUR,
        variableSymbol: opts.variableSymbol,
        // bez diakritiky a špeciálnych znakov (pomlčky, úvodzovky) – niektoré bankové appky na ne hlásia chybu
        paymentNote: ascii(opts.note).slice(0, 140),
        bankAccounts: [{ iban: opts.iban.replace(/\s+/g, '') }],
        beneficiary: { name: ascii(opts.beneficiary).slice(0, 70) },
      },
    ],
  }, { version: Version['1.1.0'], deburr: true })
}
