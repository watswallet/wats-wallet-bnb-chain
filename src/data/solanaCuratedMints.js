// Istemci tarafi kurasyonlu SPL mint tablosu.
//
// Onay ekraninda (SolanaSignTx) bir mint'in etiketi YALNIZ bu tablodan gelir.
// Jupiter / `/solana/tokens` kaynakli ucuncu taraf sembolu ekrana SIZMAZ:
// kimse "USDC" adli sahte bir mint ile kullaniciya gercek USDC gibi gorunemez.
//
// Degerler `server/data/splTokens.js` icinden KOPYALANDI (mint, sembol,
// decimals; uydurma yok). Esitlik solanaCuratedMints.test.js ile okuma
// testiyle kilitlidir: sunucu listesi degisirse bu test kirilir.
//
// Anahtar `toLowerCase` EDILMEZ: Solana adresi base58'dir ve harf kutusu
// duyarlidir; kucuk harfe cevirmek baska bir adrese denk gelir.
//
// DONDURULMUS (final SU-4): tablo ve her kayit Object.freeze'dir. Bu tablo onay ekrani
// etiketinin TEK kaynagi; disari acik ve donduruksuz olsaydi calisma zamaninda
// "USDC" gibi bir etiketi baska bir mint'e baglamak mumkun olurdu.
const TABLO = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', decimals: 6 },
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: { symbol: 'JTO', decimals: 9 },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', decimals: 6 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', decimals: 5 },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: 'PYTH', decimals: 6 },
}
for (const kayit of Object.values(TABLO)) Object.freeze(kayit)
export const SOLANA_CURATED_MINTS = Object.freeze(TABLO)

// Kurasyonlu mint ise { symbol, decimals }, degilse null. Yalniz kendi
// anahtarlara bakar (constructor / __proto__ gibi prototip adlari null doner)
// ve her cagrida yeni nesne dondurur (cagiran tabloyu degistiremez).
export function curatedMintInfo(mint) {
  if (typeof mint !== 'string') return null
  if (!Object.prototype.hasOwnProperty.call(SOLANA_CURATED_MINTS, mint)) return null
  const { symbol, decimals } = SOLANA_CURATED_MINTS[mint]
  return { symbol, decimals }
}
