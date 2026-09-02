// Swap/bridge komisyonunun SAF karar katmani — belge "Swap ve Bridge Komisyonu".
// Burada ag yok, imza yok: yalnizca "hangi bolgedeyiz", "ne kadar komisyon", "hata gelince ne
// yapilir" ve "ATS satan swap'a ne kadar girebilir" sorulari. Bu dort soru yanlis cevaplanirsa
// bedeli zincirde odenir (AA33'te yanan gaz, cift odeme, sebepsiz gorunen hata).
import { describe, it, expect } from 'vitest'
import {
  resolveCommissionRegion, readCommission, resolveLockedCommission, commissionErrorDecision,
  parseExpectedCommission, maxAtsSellAmount, routeRequiresNative,
  COMMISSION_ERROR_CODES,
} from './atsCommission'
import * as commissionModule from './atsCommission'
// Tohum saf bir karardir ama callData'yi kuran dosyanin yaninda durur (orayi ilgilendirir).
import { commissionSeedFor, commissionPlanFor } from './atsPaymaster'

describe('resolveCommissionRegion', () => {
  // §02: karar /paymaster/status'un `collection` alanindan okunur, chainId kuralindan DEGIL.
  it('collection alanini kullanir — chainId ile CELISSE bile', () => {
    expect(resolveCommissionRegion({ collection: 'src' }, 56)).toBe('src')
    expect(resolveCommissionRegion({ collection: 'local' }, 137)).toBe('local')
  })

  // Alan yoksa (eski sunucu) ozelligi kapatmak yerine bugunku davranisa dusuyoruz:
  // isCrosschainCollection ile BIREBIR ayni sonuc.
  it('collection yoksa zincir kuralina duser (56 -> local, digerleri -> src)', () => {
    expect(resolveCommissionRegion({}, 56)).toBe('local')
    expect(resolveCommissionRegion({}, 137)).toBe('src')
    expect(resolveCommissionRegion(null, 56)).toBe('local')
    expect(resolveCommissionRegion(undefined, 1)).toBe('src')
  })

  it('taninmayan collection degeri zincir kuralina duser', () => {
    expect(resolveCommissionRegion({ collection: 'hub' }, 56)).toBe('local')
    expect(resolveCommissionRegion({ collection: 'hub' }, 8453)).toBe('src')
  })
})

describe('readCommission', () => {
  it('commissionAts ve commissionTreasury okunur', () => {
    const r = readCommission({ budget: { commissionAts: '1500', commissionTreasury: '0xabc' } })
    expect(r.amount).toBe(1500n)
    expect(r.treasury).toBe('0xabc')
  })

  // Backend su an kapali: commissionAts "0", commissionTreasury alani HIC yok.
  it('kapaliyken 0 ve treasury undefined — hata DEGIL', () => {
    const r = readCommission({ budget: { commissionAts: '0' } })
    expect(r.amount).toBe(0n)
    expect(r.treasury).toBeUndefined()
  })

  it('alan hic yoksa 0', () => {
    expect(readCommission({ budget: {} }).amount).toBe(0n)
    expect(readCommission({}).amount).toBe(0n)
    expect(readCommission(null).amount).toBe(0n)
  })

  // Cozulemeyen bir tutarla batch kurmak /sponsor'da commission-missing'e cikar; sebebi
  // GORUNUR olsun diye burada, imzadan once duruyoruz.
  it('cozulemeyen commissionAts FIRLATIR', () => {
    expect(() => readCommission({ budget: { commissionAts: 'abc' } })).toThrow(/commissionAts/)
  })

  it('negatif commissionAts FIRLATIR', () => {
    expect(() => readCommission({ budget: { commissionAts: '-5' } })).toThrow()
  })
})

describe('commissionErrorDecision', () => {
  // §07: dordu de yalniz /sponsor'dan doner ve HICBIRINDE tahsilat yapilmamistir.
  it('dort kodun tamami taninir ve hicbirinde odeme yapilmamistir', () => {
    for (const code of COMMISSION_ERROR_CODES) {
      const d = commissionErrorDecision({ code })
      expect(d).toBeTruthy()
      expect(d.charged).toBe(false)
    }
  })

  it('commission-quote-required -> /quote callData ILE yeniden', () => {
    expect(commissionErrorDecision({ code: 'commission-quote-required' }).action).toBe('quote-with-calldata')
  })

  it('commission-lock-missing -> /quote callData ILE yeniden', () => {
    expect(commissionErrorDecision({ code: 'commission-lock-missing' }).action).toBe('quote-with-calldata')
  })

  it('commission-calldata-mismatch -> quoteId yenilenir', () => {
    expect(commissionErrorDecision({ code: 'commission-calldata-mismatch' }).action).toBe('quote-with-calldata')
  })

  // Tek fark bu: mesaj beklenen tutari tasidigi icin IKINCI bir /quote turu GEREKMEZ.
  it('commission-missing -> batch yeniden kurulur, ikinci /quote GEREKMEZ', () => {
    const d = commissionErrorDecision({ code: 'commission-missing' })
    expect(d.action).toBe('rebuild-batch')
    expect(d.needsRequote).toBe(false)
  })

  it('ilk uc kod HER ZINCIRDE dogar (spoke dahil), commission-missing yalniz BSC de', () => {
    expect(commissionErrorDecision({ code: 'commission-quote-required' }).localOnly).toBe(false)
    expect(commissionErrorDecision({ code: 'commission-missing' }).localOnly).toBe(true)
  })

  it('komisyonla ilgisiz kod null doner — cagiran kendi hata yoluna gitsin', () => {
    expect(commissionErrorDecision({ code: 'src-allowance-missing' })).toBeNull()
    expect(commissionErrorDecision({})).toBeNull()
    expect(commissionErrorDecision(null)).toBeNull()
  })
})

describe('parseExpectedCommission', () => {
  // §04/§07: mesaj beklenen tutari tasir. Bicimi belgede TANIMLI DEGIL, bu yuzden once
  // yapisal alanlara bakilir; cozulemezse null doner ve cagiran taze /quote turuna duser
  // (fazladan bir gidis-gelis, ama yanlis tutarla batch kurmaktan iyidir).
  it('yapisal alan varsa onu kullanir', () => {
    expect(parseExpectedCommission({ expectedCommissionAts: '4200' })).toBe(4200n)
    expect(parseExpectedCommission({ expected: '77' })).toBe(77n)
  })

  it('Turkce mesajdan beklenen tutari cikarir', () => {
    expect(parseExpectedCommission({ message: 'komisyon eksik: beklenen 12345678901234567890, bulunan 0' }))
      .toBe(12345678901234567890n)
  })

  it('Ingilizce mesajdan beklenen tutari cikarir', () => {
    expect(parseExpectedCommission({ message: 'commission missing: expected 999, found 0' })).toBe(999n)
  })

  it('cozulemezse null — sessizce 0 ya da tahmin UYDURMAZ', () => {
    expect(parseExpectedCommission({ message: 'commission missing' })).toBeNull()
    expect(parseExpectedCommission({})).toBeNull()
    expect(parseExpectedCommission(null)).toBeNull()
  })

  it('beklenen 0 ise null degil 0n doner (komisyon kapanmis olabilir)', () => {
    expect(parseExpectedCommission({ expectedCommissionAts: '0' })).toBe(0n)
  })
})

describe('maxAtsSellAmount', () => {
  // §06.1: 100 ATS, gaz 2, komisyon 1 -> swap'a EN FAZLA 97 girer.
  // Backend BUNU DENETLEMEZ; ihlal edilirse op zincirde AA33 ile duser ve gaz yanar.
  it('bakiye - ucret - komisyon', () => {
    expect(maxAtsSellAmount({ balanceRaw: 100n, feeRaw: 2n, commissionRaw: 1n })).toBe(97n)
  })

  it('bootstrap modunda ucret op sayisi kadar dusulur', () => {
    expect(maxAtsSellAmount({ balanceRaw: 100n, feeRaw: 2n, commissionRaw: 1n, opCount: 2 })).toBe(95n)
  })

  it('yetmiyorsa 0 doner, negatife DUSMEZ', () => {
    expect(maxAtsSellAmount({ balanceRaw: 2n, feeRaw: 2n, commissionRaw: 1n })).toBe(0n)
  })

  it('string girdileri kabul eder', () => {
    expect(maxAtsSellAmount({ balanceRaw: '100', feeRaw: '2', commissionRaw: '1' })).toBe(97n)
  })

  it('komisyon kapaliyken yalniz ucret dusulur', () => {
    expect(maxAtsSellAmount({ balanceRaw: 100n, feeRaw: 2n, commissionRaw: 0n })).toBe(98n)
  })
})

describe('routeRequiresNative', () => {
  // §06.3: paymaster gazi oder, msg.value'yu ODEMEZ. value > 0 olan rota bu yolla calismaz.
  it('value > 0 olan rota elenir', () => {
    expect(routeRequiresNative({ value: '1' })).toBe(true)
    expect(routeRequiresNative({ value: 1n })).toBe(true)
    expect(routeRequiresNative({ value: '0x1' })).toBe(true)
  })

  it('value 0 / yok olan ERC20 rotasi kapsam icindedir', () => {
    expect(routeRequiresNative({ value: '0' })).toBe(false)
    expect(routeRequiresNative({ value: '0x0' })).toBe(false)
    expect(routeRequiresNative({})).toBe(false)
    expect(routeRequiresNative(null)).toBe(false)
  })

  // Cozulemeyen bir value'yu "native gerekmiyor" saymak, kullanicinin native bakiyesi
  // olmadan gonderilen ve zincirde dusen bir op demektir. Fail-closed.
  it('cozulemeyen value native GEREKIYOR sayilir (fail-closed)', () => {
    expect(routeRequiresNative({ value: 'abc' })).toBe(true)
  })
})

// Bir op'un GERCEK komisyonu. /status'un budget.commissionAts'i bir ON TAHMINDIR: uc bir op'a
// bakmaz, callData almaz ve canli olcumde (2026-08-19) on zincirin hepsinde ayni degeri doner.
// Otorite, O op'un callData'si ile yapilan /quote'un `commissionAts` alaninin VARLIGIDIR.
describe('resolveLockedCommission', () => {
  it('alan varsa otorite odur', () => {
    expect(resolveLockedCommission({ quoteCommissionAts: '6881838827334664106', callDataSent: true }))
      .toEqual({ amount: 6881838827334664106n, authoritative: true })
  })

  // Soru SORULDU ve cevap "komisyon yok": fallback verilse bile 0. Aksi halde backend'in
  // istemedigi bir komisyon ekranda gosterilir ve zincirde hazineye odenir.
  it('callData GONDERILDI ve alan yoksa 0 — fallback verilse BILE', () => {
    expect(resolveLockedCommission({ callDataSent: true, fallback: 4200n }))
      .toEqual({ amount: 0n, authoritative: true })
  })

  // Soru HIC sorulmadi: yoklugu "komisyonsuz" saymak tavani sahte olarak yukseltir ve op
  // zincirde AA33 ile duser. Muhafazakar tarafta kal.
  it('callData GONDERILMEDIYSE fallback (muhafazakar taraf) kullanilir', () => {
    expect(resolveLockedCommission({ callDataSent: false, fallback: 4200n }))
      .toEqual({ amount: 4200n, authoritative: false })
  })

  it('negatif ve cozulemez alan FIRLATIR (readCommission ile ayni davranis)', () => {
    expect(() => resolveLockedCommission({ quoteCommissionAts: '-1', callDataSent: true })).toThrow()
    expect(() => resolveLockedCommission({ quoteCommissionAts: 'abc', callDataSent: true })).toThrow()
  })

  it('bos dizge YOKLUK gibi davranir', () => {
    expect(resolveLockedCommission({ quoteCommissionAts: '', callDataSent: true }).amount).toBe(0n)
  })
})

// Tohum OTORITE DEGIL, yalnizca /quote turu tasarrufudur. Yanlis tohumun bedeli en fazla bir
// /quote turudur (bedelsiz), asla yanlis odeme degil — karar /quote'un cevabina gore duzeltilir.
describe('commissionSeedFor (hiz sorusu: bugun dogru tahmin edebiliyor muyuz)', () => {
  it('transfer op una tohum KONMAZ', () => {
    expect(commissionSeedFor('transfer', 'local', 4200n)).toBe(0n)
  })
  it('swap TOHUMLANIR — 37 router in 37 si backend listesinde (olculdu)', () => {
    expect(commissionSeedFor('swap', 'local', 4200n)).toBe(4200n)
  })
  // 2026-08-20 CANLI OLCUM: Li.Fi Diamond'a dokunan batch icin /quote hem BSC'de hem
  // Polygon'da commissionAts DONUYOR — backend kopru hedefini de taniyor. Onceki
  // "manifestoda kopru yok, o halde taninmaz" CIKARIMI yanlisti; tohumu cikarmak BSC'deki
  // her kopruye bosa bir /quote turu maliyeti yukluyordu.
  it('bridge TOHUMLANIR — backend kopru hedefini de taniyor (olculdu)', () => {
    expect(commissionSeedFor('bridge', 'local', 4200n)).toBe(4200n)
  })
  it('spoke bolgede tohum HER ZAMAN 0 (komisyon op a hic girmez)', () => {
    expect(commissionSeedFor('swap', 'src', 4200n)).toBe(0n)
  })
  it('komisyon kapaliyken 0', () => {
    expect(commissionSeedFor('swap', 'local', 0n)).toBe(0n)
  })
})

// Benimseme AYRI bir sorudur: "/quote komisyon isterse sessizce kabul edebilir miyiz".
// Olcut EKRANDIR — komisyonun kullaniciya gosterildigi akislarda mesru, gosterilmedigi
// akislarda (Send) degil. Tohumla ayni kume OLMAK ZORUNDA DEGIL ve bugun degil.
describe('commissionPlanFor (guven sorusu: sessizce benimseyebilir miyiz)', () => {
  it('swap ve bridge benimser (komisyon ekranda gosteriliyor)', () => {
    expect(commissionPlanFor('swap', 'local')).toBe(1)
    expect(commissionPlanFor('bridge', 'local')).toBe(1)
  })
  // ConfirmTransaction.vue komisyonu HIC gostermez ve assertQuoteWithinApproval yalniz gaz
  // ucretini sinirlar: benimseme, tavansiz ve ekranda izsiz bir odeme olurdu.
  it('transfer BENIMSEMEZ — gorunur hata, sessiz odemeden iyidir', () => {
    expect(commissionPlanFor('transfer', 'local')).toBe(0)
  })
  it('spoke bolgede hicbir tur benimsemez (komisyon op a hic girmez)', () => {
    expect(commissionPlanFor('swap', 'src')).toBe(0)
    expect(commissionPlanFor('bridge', 'src')).toBe(0)
  })
})

// `commissionGoesInOp` "komisyon op'a girer mi" diye sorup YALNIZ bolgeye bakiyordu; oysa
// cevap ayrica op'un TURUNE baglidir. Sifir cagrisi vardi ama yanlis zihin modelinin
// belgelenmis hali olarak duruyordu — geri sizmasin.
it('commissionGoesInOp export EDILMEZ', () => {
  expect(commissionModule.commissionGoesInOp).toBeUndefined()
})
