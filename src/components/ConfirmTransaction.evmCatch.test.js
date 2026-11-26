import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./ConfirmTransaction.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('ConfirmTransaction.vue EVM catch', () => {
    it('catch sendCatchOutcome kullanir, ham mesaj gostermez', () => {
        const i = src.indexOf('console.error("SEND ERROR:"')
        expect(i).toBeGreaterThan(-1)
        const body = src.slice(i, i + 1600)
        expect(body).toMatch(/sendCatchOutcome\(err, broadcastDone, broadcastStarted\)/)
        expect(body).not.toMatch(/err\.message\s*\)?\s*$/m)
    })
    it('belirsiz EVM durumu mevcut amber kartta, kirmizi alanda degil', () => {
        expect(src).toMatch(/v-if="solanaStatusUnknown \|\| evmStatusUnknown"/)
        const i = src.indexOf("outcome.kind === 'unknown'")
        expect(i).toBeGreaterThan(-1)
        const body = src.slice(i, i + 200)
        expect(body).toMatch(/evmStatusUnknown\.value = true/)
        expect(body).not.toMatch(/evmSendError/)
    })
    it('amber kart EVM belirsizliginde send.errors.network metnini gosterir', () => {
        expect(src).toMatch(/evmStatusUnknown \? \$t\('send\.errors\.network'\) : \$t\('send\.errors\.statusUnknown'\)/)
    })
    it('belirsizken Onayla dugmesi kalkar (cift gonderim yok)', () => {
        expect(src).toMatch(/v-if="!solanaStatusUnknown && !evmStatusUnknown"/)
    })
    it('broadcastStarted yalniz SEND_TRANSACTION istegi oncesinde kurulur', () => {
        const a = src.indexOf('broadcastStarted = true')
        expect(a).toBeGreaterThan(-1)
        expect(a).toBeGreaterThan(src.indexOf('provider.estimateGas(tx)'))
        expect(a).toBeLessThan(src.indexOf('type: "SEND_TRANSACTION"'))
    })
    it('broadcastDone yalniz arka plan basari yanitindan sonra kurulur', () => {
        expect(src).toMatch(/let broadcastDone = false/)
        expect(src.match(/broadcastDone = true/g).length).toBeGreaterThanOrEqual(2)
    })
})
