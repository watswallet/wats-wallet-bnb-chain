import { describe, it, expect } from 'vitest'
import {
  isAtsFeeInsufficient, isNativeAmountInsufficient, pickFeeBranch,
  requiredAtsAmount, isDelegatedTo, pickAtsFee, needsBudgetTopUp,
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
  it('dapp islemi her zaman dapp kolu (ATS zinciri olsa bile)', () => {
    expect(pickFeeBranch({ fromDapp: true, atsEnabled: true })).toBe('dapp')
  })
  it('kullanici transferi + ATS zinciri -> ats', () => {
    expect(pickFeeBranch({ fromDapp: false, atsEnabled: true })).toBe('ats')
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
