// blocker/code -> UI karari. Saf ve tam kapsamli: bilinmeyen bir kod sessizce "her sey yolunda"
// olarak yorumlanmamali, ve DONGU kurallari (asagida) burada kilitlenmeli.
import { describe, it, expect } from 'vitest'
import { resolveAtsBlocker } from './atsBlocker'

describe('operator kaynakli engeller', () => {
  it('paymaster-paused -> baska ag oner', () => {
    expect(resolveAtsBlocker('paymaster-paused'))
      .toEqual({ severity: 'operator', action: 'suggest-other-chain', i18nKey: 'send.confirmTransaction.atsChainPaused' })
  })
  it('remote-not-ready -> baska ag oner', () => {
    expect(resolveAtsBlocker('remote-not-ready').action).toBe('suggest-other-chain')
  })
  it('rate-stale -> biraz sonra tekrar dene', () => {
    expect(resolveAtsBlocker('rate-stale')).toEqual({
      severity: 'operator', action: 'retry-later', i18nKey: 'send.confirmTransaction.atsRateStale',
    })
  })
})

describe('kullanici eylemleri', () => {
  it('src-balance-missing ve balance-missing -> ATS satin al', () => {
    expect(resolveAtsBlocker('src-balance-missing').action).toBe('buy-ats')
    expect(resolveAtsBlocker('balance-missing').action).toBe('buy-ats')
  })
  it('src-allowance-missing -> onboarding', () => {
    expect(resolveAtsBlocker('src-allowance-missing')).toEqual({
      severity: 'user', action: 'run-onboarding', i18nKey: 'send.confirmTransaction.atsOnboardingNeeded',
    })
  })
  // 2026-08-20 KARAR: kullanici native'ini KOPRULEYEBILIR; yalnizca GAZI ATS ile odemek
  // zorunda. `msg.value` kendi bakiyesinden cikar, paymaster ona dokunmaz. Onceki
  // "value > 0 ise rotayi ele" kurali fazla genisti ve native varsayilani ekrana gelince
  // Polygon'da her kopru acilisini bloklamisti. Geriye tek gercek kosul kaldi: bakiye.
  it('insufficient-native-for-value -> KULLANICI eylemi (miktari azalt)', () => {
    const d = resolveAtsBlocker('insufficient-native-for-value')
    expect(d.severity).toBe('user')
    expect(d.action).toBe('reduce-amount')
    expect(d.i18nKey).toBe('send.confirmTransaction.atsNativeValueTitle')
    expect(d.i18nDescKey).toBe('send.confirmTransaction.atsNativeValueDesc')
    expect(d.i18nKey).not.toBe('send.confirmTransaction.atsTemporary')
  })

  // Deger cozulemiyorsa 0 VARSAYILMAZ (op zincirde olurdu); taze bir teklif farkli bir
  // rota getirebilecegi icin gecici sayilir.
  it('route-value-unreadable -> gecici, tekrar dene', () => {
    const d = resolveAtsBlocker('route-value-unreadable')
    expect(d.severity).toBe('transient')
    expect(d.i18nKey).toBe('send.confirmTransaction.atsRouteUnreadable')
  })

  // Artik URETILMEYEN kod: bilinmeyen koluna dusmeli, tabloda YER TUTMAMALI.
  it('route-requires-native ARTIK bir engel degil', () => {
    expect(resolveAtsBlocker('route-requires-native').i18nKey)
      .toBe('send.confirmTransaction.atsTemporary')
  })

  it('src-allowance-low -> butce tazeleme (yine onboarding kosucusu)', () => {
    expect(resolveAtsBlocker('src-allowance-low')).toEqual({
      severity: 'user', action: 'run-onboarding', i18nKey: 'send.confirmTransaction.atsBudgetLow',
    })
  })
})

describe('foreign-delegation', () => {
  it('kimsenin cozemeyecegi engel; authorization gondermek COZMEZ', () => {
    expect(resolveAtsBlocker('foreign-delegation')).toEqual({
      severity: 'blocked', action: 'explain-foreign', i18nKey: 'send.confirmTransaction.atsForeignDelegation',
    })
  })
})

describe('ic kodlar — kullaniciya gosterilmez', () => {
  const map = {
    'quote-lock-required': 'retry-with-lock',
    'postop-gas-required': 'rebuild-gas',
    'settlement-mismatch': 'rebuild-identical',
    'settlement-unpaid': 'fresh-quote',
  }
  for (const [code, action] of Object.entries(map)) {
    it(`${code} -> ${action}`, () => {
      expect(resolveAtsBlocker(code)).toMatchObject({ severity: 'internal', action })
    })
  }
})

describe('kodsuz yanitlar', () => {
  it('kodsuz 400 gecici sayilir ve durum tazelenir', () => {
    expect(resolveAtsBlocker(undefined, { httpStatus: 400 }))
      .toEqual({ severity: 'transient', action: 'refresh-status', i18nKey: 'send.confirmTransaction.atsTemporary' })
  })
  it('500 gecici ama tazeleme onermez (backend bilerek detay vermez)', () => {
    expect(resolveAtsBlocker(undefined, { httpStatus: 500 }))
      .toEqual({ severity: 'transient', action: 'retry-later', i18nKey: 'send.confirmTransaction.atsServerError' })
  })
  it('bilinmeyen kod sessizce yutulmaz — gecici olarak siniflanir', () => {
    expect(resolveAtsBlocker('bir-gun-eklenecek-kod').severity).toBe('transient')
  })
  it('kod da durum da yoksa null (engel yok)', () => {
    expect(resolveAtsBlocker(undefined)).toBe(null)
    expect(resolveAtsBlocker(null)).toBe(null)
  })
})

describe('dongu korumasi', () => {
  it('remote-not-ready ve src-allowance-low ASLA refresh-status onermez', () => {
    // /status taban ucretle (minChargeAts) sorar; bu iki durumda yine ready:true der.
    // Tazelemeyi onermek kullaniciyi sonsuz "tekrar dene" dongusune sokar.
    expect(resolveAtsBlocker('remote-not-ready').action).not.toBe('refresh-status')
    expect(resolveAtsBlocker('src-allowance-low').action).not.toBe('refresh-status')
  })
})

// GERCEK VAKA (2026-08-10): /status `ready:true` + `nextSteps:[]` dondu, `runAtsOnboarding`
// calistiracak adim bulamadi. Bu kod o cikmaz sokagi kullaniciya GORUNUR kilar.
describe('onboarding-steps-missing', () => {
  it('operator seviyesinde, kendi aciklama metnini tasir', () => {
    const d = resolveAtsBlocker('onboarding-steps-missing')
    expect(d.severity).toBe('operator')       // kullanicinin yapabilecegi bir sey yok
    expect(d.action).toBe('retry-later')      // sunucu duzelince tazeleme yeter
    expect(d.i18nDescKey).toBeTruthy()        // kart yalnizca basliktan ibaret kalmasin
  })

  it('bilinmeyen-kod yoluna DUSMEZ (o yol severity transient verirdi)', () => {
    expect(resolveAtsBlocker('onboarding-steps-missing').severity)
      .not.toBe(resolveAtsBlocker('boyle-bir-kod-yok').severity)
  })
})
