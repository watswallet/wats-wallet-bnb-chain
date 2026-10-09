import { describe, it, expect } from 'vitest'
import {
  isAtsFeeInsufficient, isNativeAmountInsufficient, pickFeeBranch,
  requiredAtsAmount, isDelegatedTo, pickAtsFee, needsBudgetTopUp,
  pickBootstrapFee, atsFeeRefundable,
} from './atsFee'

const DELEGATE = '0x0A1543500137b0656527EDF143D7903E9078dC26'
const ATS = '0xAAA0000000000000000000000000000000000000'
const USDC = '0xBBB0000000000000000000000000000000000000'

describe('isDelegatedTo', () => {
  it('kod TAM olarak 0xef0100 || delegate ise true', () => {
    expect(isDelegatedTo('0xef0100' + DELEGATE.slice(2), DELEGATE)).toBe(true)
  })
  it('buyuk/kucuk harf duyarsiz', () => {
    expect(isDelegatedTo(('0xEF0100' + DELEGATE.slice(2)).toUpperCase(), DELEGATE)).toBe(true)
  })
  it('BASKA bir delegeye isaret ediyorsa false', () => {
    const other = '0x' + '9'.repeat(40)
    expect(isDelegatedTo('0xef0100' + other.slice(2), DELEGATE)).toBe(false)
  })
  it('delege edilmemis hesap (0x) false', () => {
    expect(isDelegatedTo('0x', DELEGATE)).toBe(false)
  })
  it('kod veya delege yoksa false', () => {
    expect(isDelegatedTo(null, DELEGATE)).toBe(false)
    expect(isDelegatedTo('0xef0100' + DELEGATE.slice(2), '')).toBe(false)
  })
  it('dogru baytlarin ardinda ekstra bayt varsa false', () => {
    // 0xef0100 || delegate'in tam olarak eslestigini onemli kilar
    // prefix-matching tarafindan atlanirdigi uzun bayidir
    expect(isDelegatedTo('0xef0100' + DELEGATE.slice(2) + 'FF', DELEGATE)).toBe(false)
  })
})

describe('isAtsFeeInsufficient', () => {
  it('bakiye toplami karsiliyorsa yeterli', () => {
    expect(isAtsFeeInsufficient({ atsBalance: 2, transferFee: 1.25, bootstrapFee: 0.6 })).toBe(false)
  })
  it('bootstrap ucreti bakiyeyi asiyorsa yetersiz', () => {
    expect(isAtsFeeInsufficient({ atsBalance: 1.5, transferFee: 1.25, bootstrapFee: 0.6 })).toBe(true)
  })
  it('ucret bilinmiyorsa BLOKLA', () => {
    expect(isAtsFeeInsufficient({ atsBalance: 999, transferFee: null })).toBe(true)
  })
})

describe('requiredAtsAmount', () => {
  it('bootstrap yoksa yalnizca transfer ucreti', () => {
    expect(requiredAtsAmount({ transferFee: 1.25 })).toBe(1.25)
  })
  it('bootstrap varsa iki ucret toplanir', () => {
    expect(requiredAtsAmount({ transferFee: 1.25, bootstrapFee: 0.6 })).toBeCloseTo(1.85)
  })
  it('ATS gonderiliyorsa tutar da eklenir', () => {
    expect(requiredAtsAmount({
      transferFee: 1.25, bootstrapFee: 0.6, atsAddress: ATS, sentAssetAddress: ATS, sendAmount: '10',
    })).toBeCloseTo(11.85)
  })
  it('baska token gonderiliyorsa tutar eklenmez', () => {
    expect(requiredAtsAmount({
      transferFee: 1.25, atsAddress: ATS, sentAssetAddress: '0xBBB', sendAmount: '10',
    })).toBe(1.25)
  })
  it('transfer ucreti bilinmiyorsa null', () => {
    expect(requiredAtsAmount({ transferFee: null, bootstrapFee: 0.6 })).toBe(null)
  })
})

describe('isNativeAmountInsufficient', () => {
  it('ERC-20 gonderiminde native gerekmez (gas ATS ile odenir)', () => {
    expect(isNativeAmountInsufficient({ nativeBalance: 0, isNativeSend: false, sendAmount: '1' })).toBe(false)
  })
  it('native gonderiminde yalnizca TUTAR aranir, gas aranmaz', () => {
    expect(isNativeAmountInsufficient({ nativeBalance: 1, isNativeSend: true, sendAmount: '1' })).toBe(false)
    expect(isNativeAmountInsufficient({ nativeBalance: 0.9, isNativeSend: true, sendAmount: '1' })).toBe(true)
  })
})

describe('pickFeeBranch', () => {
  // 2026-09-13 KURAL DEGISIKLIGI. Eski iddia "dapp islemi her zaman dapp kolu"ydu
  // ve KODU anlatiyordu, KURALI degil: sonucu, BNB'si olmayan bir kullanicinin
  // ayni zincirde Gonder ekranindan ATS ile gonderebilip dapp'in istedigi islemi
  // HIC yapamamasiydi. Ucretin kaynagi artik AKISA degil ZINCIRE bagli.
  it('ATS zinciri -> ats, istek dapp\'ten gelse bile', () => {
    expect(pickFeeBranch({ fromDapp: true, atsEnabled: true })).toBe('ats')
  })
  it('kullanici transferi + ATS zinciri -> ats', () => {
    expect(pickFeeBranch({ fromDapp: false, atsEnabled: true })).toBe('ats')
  })
  it('dapp islemi + ATS disi zincir -> dapp (Pimlico secici)', () => {
    expect(pickFeeBranch({ fromDapp: true, atsEnabled: false })).toBe('dapp')
  })
  it('kullanici transferi + ATS disi zincir -> native (Pimlico secici YOK)', () => {
    expect(pickFeeBranch({ fromDapp: false, atsEnabled: false })).toBe('native')
  })
  it('argumansiz cagri native', () => {
    expect(pickFeeBranch()).toBe('native')
  })
})

const Q = {
  atsFee: '1000000000000000000',
  atsFeeCrosschain: '2463054187192118156',
}

describe('pickAtsFee', () => {
  it('capraz-zincir tahsilatta atsFeeCrosschain (iade YOK, kaynak-zincir payini icerir)', () => {
    expect(pickAtsFee(Q, true)).toBe(Q.atsFeeCrosschain)
  })
  it('ayni-zincir tahsilatta (BSC) atsFee', () => {
    expect(pickAtsFee(Q, false)).toBe(Q.atsFee)
  })
  it('bilinmiyorsa PAHALI tarafi secer (eksik gostermektense fazla goster)', () => {
    expect(pickAtsFee(Q, undefined)).toBe(Q.atsFeeCrosschain)
  })
  it('crosschain alani hic yoksa atsFee ye duser', () => {
    expect(pickAtsFee({ atsFee: '5' }, true)).toBe('5')
  })

  // GERCEK VAKA (2026-08-10, chainId 1). Backend /status'ta mode:"bootstrap" dedi ama
  // /quote notunda "ATS kaynak zincirde (BSC) ise atsFeeCrosschain gecerlidir" yaziyordu
  // ve /sponsor op'u src-allowance-missing ile reddetti. Yani `mode` HEDEF zincirdeki
  // sponsorluk seklidir, tahsilatin yerini SOYLEMEZ. Eski kod mode='bootstrap' gorup
  // atsFee'yi seciyordu -> ekranda 163.64 ATS, backend'in tahsil edecegi 164.35 ATS.
  it("mode 'bootstrap' olsa bile capraz-zincirse crosschain ucreti gecerlidir", () => {
    const live = { atsFee: '163638968763371831789', atsFeeCrosschain: '164352133789758937704' }
    expect(pickAtsFee(live, true)).toBe(live.atsFeeCrosschain)
  })
})

describe('needsBudgetTopUp', () => {
  it('ucret izinden buyukse true (sponsor un reddetmesini bekleme)', () => {
    expect(needsBudgetTopUp({ feeRaw: '100', srcAllowance: '99' })).toBe(true)
  })
  it('esit ya da kucukse false', () => {
    expect(needsBudgetTopUp({ feeRaw: '100', srcAllowance: '100' })).toBe(false)
    expect(needsBudgetTopUp({ feeRaw: '10', srcAllowance: '100' })).toBe(false)
  })
  it('izin bilinmiyorsa false (yanlis alarm verme)', () => {
    expect(needsBudgetTopUp({ feeRaw: '100', srcAllowance: undefined })).toBe(false)
  })
})

// Bootstrap'ta op1 (approve + 7702) backend'in PATH 2'sinden gecer: taban YOK, markup YOK,
// fiyati /quote'un `atsFeeBootstrap` alanidir (paymaster sponsor.ts:677). Onu normal op'un
// $1 tabanli `atsFee`'siyle fiyatlamak ekranda ucreti IKIYE KATLIYORDU (canli, BSC: 41.74
// ATS gosterildi, gercek ust sinir ~21.76).
describe('pickBootstrapFee', () => {
  const Q = { atsFee: '20870000000000000000', atsFeeBootstrap: '890000000000000000' }

  it('ayni zincir bootstrap: op1 ucreti atsFeeBootstrap tir', () => {
    expect(pickBootstrapFee(Q, { mode: 'bootstrap', crosschain: false, feeRaw: Q.atsFee }))
      .toBe('890000000000000000')
  })

  it('bootstrap degilse op1 yoktur: 0', () => {
    expect(pickBootstrapFee(Q, { mode: 'normal', crosschain: false, feeRaw: Q.atsFee })).toBe('0')
    expect(pickBootstrapFee(Q, { mode: undefined, crosschain: false, feeRaw: Q.atsFee })).toBe('0')
  })

  // Eski backend alani dondurmezse op1'i 0 saymak gerekeni EKSIK gosterir ve op1 odendikten
  // sonra op2'nin bakiyeden dusmesine yol acar. Muhafazakar taraf: normal op fiyati.
  it('alan yoksa ya da gecersizse normal op fiyatina duser', () => {
    for (const atsFeeBootstrap of [undefined, null, '', 'abc', '0', '-5']) {
      expect(pickBootstrapFee({ atsFee: Q.atsFee, atsFeeBootstrap }, { mode: 'bootstrap', crosschain: false, feeRaw: Q.atsFee }), String(atsFeeBootstrap))
        .toBe(Q.atsFee)
    }
  })

  // Capraz-zincirde op1 backend'de 'crosschain' siniflanir ve TAM capraz-zincir ucreti kesilir
  // (sponsor.ts:1045-1087); atsFeeBootstrap orada gecerli DEGIL — /quote yine de dondurur.
  it('capraz-zincirde atsFeeBootstrap KULLANILMAZ', () => {
    expect(pickBootstrapFee(Q, { mode: 'bootstrap', crosschain: true, feeRaw: '30000000000000000000' }))
      .toBe('30000000000000000000')
    expect(pickBootstrapFee(Q, { mode: 'bootstrap', crosschain: undefined, feeRaw: Q.atsFee }))
      .toBe(Q.atsFee)
  })
})

// "en fazla" niteleyicisi YALNIZ iade GERCEKTEN mumkunse dogrudur. Normal yolda kontrat hem
// on odemeyi hem postOp'taki borcu minChargeAts tabaninda keser (ATSPaymaster.sol _atsFor):
// ucret tabandaysa iade SIFIRDIR. Capraz-zincirde postOp hic yoktur.
describe('atsFeeRefundable', () => {
  it('ayni zincir, ucret tabanin USTUNDE: iade mumkun', () => {
    expect(atsFeeRefundable({ crosschain: false, feeRaw: '21000000000000000001', minChargeAts: '21000000000000000000' })).toBe(true)
  })

  it('ucret tam tabanda: iade YOK', () => {
    expect(atsFeeRefundable({ crosschain: false, feeRaw: '20870291140561411267', minChargeAts: '20870291140561411267' })).toBe(false)
  })

  it('capraz-zincir: iade YOK (ucret tabani assa bile)', () => {
    expect(atsFeeRefundable({ crosschain: true, feeRaw: '99000000000000000000', minChargeAts: '1' })).toBe(false)
    expect(atsFeeRefundable({ crosschain: undefined, feeRaw: '99000000000000000000', minChargeAts: '1' })).toBe(false)
  })

  // Emin olunamayan her durumda niteleyici DUSER: fazladan bir "en fazla" var olmayan bir iadeyi
  // vaat eder, eksik olan yalnizca temkinlidir (AtsFeeCard.vue).
  it('taban ya da ucret bilinmiyorsa false', () => {
    expect(atsFeeRefundable({ crosschain: false, feeRaw: '5', minChargeAts: undefined })).toBe(false)
    expect(atsFeeRefundable({ crosschain: false, feeRaw: null, minChargeAts: '1' })).toBe(false)
    expect(atsFeeRefundable({ crosschain: false, feeRaw: 'x', minChargeAts: '1' })).toBe(false)
  })

  // ~2e19 wei'de Number son basamaklari kaybeder; tabandaki ucret ESIT cikmali.
  it('BigInt ile karsilastirir (Number hassasiyet kaybi yok)', () => {
    expect(atsFeeRefundable({ crosschain: false, feeRaw: '20870291140561411268', minChargeAts: '20870291140561411267' })).toBe(true)
  })
})
