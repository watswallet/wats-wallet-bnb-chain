// KOPRU: ATS BAKIYESI BU OP'UN UCRETINE YETMIYORSA GONDERIM KAPALI -- kaynak kilidi.
//
// 2026-09-25 incelemesi: Kopru'nun ATS kolu yalniz `!atsLoading && atsReady` soruyordu.
// /status'un ready:true'su bu op'un odenebilir oldugunu SOYLEMEZ (komisyon, taban ustu
// ucret, bootstrap op1 hesaba girmez); kullanici basiyor, /sponsor 'balance-missing' ile
// reddediyor ve ekran genel bir "gonderilemedi" kartiyla kaliyordu. Send ekrani ayni
// durumu gondermeden ONCE kilitliyor.
//
// Davranis BridgeAtsInsufficient.ssr.test.js'te gercek render ile olculuyor; burasi
// render'in goremedigi halkalari kilitler: `bridge()`in kendi kapisi (buton devre disi
// olsa da fonksiyon baska yoldan cagrilabilir) ve etiketlerin SIRASI.
//
// Iddialar yorumsuz kaynak uzerinde kosar: bir aciklama satiri iddiayi tek basina yesil
// tutamasin.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz, blokGovdesi, cagriGovdesi } from '../test-utils/kaynakTarama.js'

const here = dirname(fileURLToPath(import.meta.url))
const BRIDGE_HAM = readFileSync(join(here, '..', 'components/Bridge.vue'), 'utf8')
const BRIDGE = yorumsuz(BRIDGE_HAM)

describe('Kopru: ATS bakiyesi ucrete yetmiyorsa gonderim KAPALI', () => {
    it('isValid in ATS kolu atsInsufficient i sorar', () => {
        const govde = blokGovdesi(BRIDGE_HAM, 'const isValid = () =>')
        expect(govde, 'isValid bulunamadi').not.toBeNull()
        const atsSatiri = govde.split('\n').find((l) => l.includes('if (payWithAts.value)'))
        expect(atsSatiri, 'isValid in ATS kolu bulunamadi').toBeTruthy()
        expect(atsSatiri).toMatch(/!atsInsufficient\.value/)
        // Eski iki kosul DURUR: bakiye kapisi onlarin YERINE degil, YANINA geldi.
        expect(atsSatiri).toMatch(/!atsLoading\.value/)
        expect(atsSatiri).toMatch(/atsReady\.value/)
    })

    it('bridge() kendi kapisinda da atsInsufficient i sorar', () => {
        const govde = blokGovdesi(BRIDGE_HAM, 'const bridge = async() =>')
        expect(govde, 'bridge() bulunamadi').not.toBeNull()
        const atsDali = blokGovdesi(govde, 'if (payWithAts.value)')
        expect(atsDali, 'bridge() in ATS kolu bulunamadi').not.toBeNull()
        expect(atsDali).toMatch(/atsInsufficient\.value[^\n]*\)\s*return/)
    })

    // Send ile ayni kural (confirmLabel): bakiye sebebi "henuz gonderilemiyor"dan ONCE.
    // Ters sirada kullanici "Can't Send Yet" gorur ve eksik olanin ATS oldugunu anlamaz.
    it('buton metni: bakiye sebebi atsCannotSend den ONCE', () => {
        const etiket = 'v-else-if="payWithAts && atsInsufficient"'
        const i = BRIDGE.indexOf(etiket)
        const j = BRIDGE.indexOf("$t('send.confirmTransaction.atsCannotSend')")
        expect(i, 'ATS bakiye etiketi yok').toBeGreaterThan(-1)
        expect(j).toBeGreaterThan(i)
        expect(BRIDGE.slice(i, i + 120)).toContain("$t('bridge.insufficientBalance')")
    })

    it('atsInsufficient ucret + gonderilen ATS ile hesaplanir', () => {
        const govde = cagriGovdesi(BRIDGE_HAM, 'const atsInsufficient = computed(')
        expect(govde, 'atsInsufficient computed i yok').not.toBeNull()
        expect(govde).toMatch(/payWithAts\.value/)
        expect(govde).toMatch(/insufficientFor\(\s*atsBridgedAmount\.value\s*\)/)
    })

    // Kullanicinin gercek ATS'si yalniz BSC'de. Spoke zincirlerdeki ATSOFT ucret
    // bakiyesinden DUSMEZ; orada gonderilen miktari eklemek calisan bir kopruyu kilitlerdi.
    it('gonderilen ATS yalniz BSC de sayilir', () => {
        const govde = cagriGovdesi(BRIDGE_HAM, 'const bridgingAts = computed(')
        expect(govde, 'bridgingAts computed i yok').not.toBeNull()
        expect(govde).toMatch(/!isCrosschainCollection\(/)
        expect(govde).toMatch(/getAtsConfig\(/)
    })
})
