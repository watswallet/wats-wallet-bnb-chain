// background.js'in ping'i DOGRU kablolamasi (kaynak taramasi).
//
// KOK NEDEN: background.js'i calistiran harness'lar agirdir ve chrome stub'inda
// getManifest/i18n eksik olabilir; bu yuzden kablolama kaynak seviyesinde
// kilitleniyor. Asil davranis analyticsPing.test.js'te. Burada uc sey kritik:
//   1) YENI ALARM KURULMAZ: background.lockAlarm.test.js alarm create/get SAYISINI
//      ve onAlarm[0]'in kilit dinleyicisi oldugunu kilitliyor; ayri bir alarm ikisini
//      de bozar. Ustelik seyrek (6 saatlik) ayri alarm yeni kurulumu saatlerce
//      saymazdi: mevcut dakikalik tikle ilk ping kurulumdan ~1 dk sonra gider.
//   2) ping dinleyicisi kilit dinleyicisinden SONRA kaydolur ve onun mantigina
//      (shouldLock) dokunmaz: kilit bir GUVENLIK kontrolu.
//   3) ping hatalari yutulur (async + try/catch): yan ozellik hicbir akisi bozmamali.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Yalniz SATIR BASI yorumlar siyrilir: aciklama metni gercek koddan gelen bir
// eslesmeyi taklit edemesin. Satir ici '//' iceren dizelere (URL) dokunulmaz.
const src = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')

const LISTENER = 'chrome.alarms.onAlarm.addListener('

// Her `onAlarm.addListener(` gecisinden bir sonrakine (ya da dosya sonuna) kadar
// olan metin: o dinleyicinin "govdesi" (kendinden sonra gelen kodu da tasiyabilir).
function listenerBodies() {
    const starts = []
    for (let i = src.indexOf(LISTENER); i !== -1; i = src.indexOf(LISTENER, i + 1)) starts.push(i)
    return starts.map((start, n) => src.slice(start, n + 1 < starts.length ? starts[n + 1] : src.length))
}

describe('background analytics kablolamasi', () => {
    it('ping modulunu iceri alir ve cagirir', () => {
        expect(src).toContain("from './utils/analyticsPing'")
        expect(src).toContain('await runAnalyticsPing(')
    })

    it('YENI alarm ve onStartup tetigi YOK', () => {
        expect(src).not.toContain('ANALYTICS_ALARM')
        const satirlar = src.split(/\r?\n/)
        expect(satirlar.some((l) => l.includes('onStartup') && l.includes('pingAnalytics'))).toBe(false)
    })

    it('ping dinleyicisi kilit dinleyicisinden SONRA kayitli ve kilit mantigina dokunmaz', () => {
        const govdeler = listenerBodies()
        const kilit = govdeler.findIndex((b) => b.includes('shouldLock('))
        // `async function pingAnalytics()` bildirimi kilit dinleyicisinin ile ping
        // dinleyicisinin ARASINDA durur, yani kilit govdesinin icine de 'pingAnalytics()'
        // yazisi duser; ping dinleyicisi bu yazinin gectigi SON govdedir.
        const ping = govdeler.findLastIndex((b) => b.includes('pingAnalytics()'))

        expect(kilit).toBeGreaterThan(-1)
        expect(ping).toBeGreaterThan(kilit)
        expect(govdeler[ping]).toContain('alarm.name === ALARM_NAME')
        expect(govdeler[ping]).not.toContain('shouldLock(')
    })

    // NEDEN: yayimli politika analitik toplamadigini soyluyor; derleme bayragi kapaliyken
    // (yayin varsayilani) ne istek gitmeli ne de kimlik uretilmeli.
    it('derleme bayragi KAPALIYKEN pingAnalytics ilk satirda doner', () => {
        expect(src).toMatch(/import \{[^}]*ANALYTICS_ENABLED[^}]*\} from '\.\/utils\/featureFlags'/)
        const bas = src.indexOf('async function pingAnalytics()')
        const govde = src.slice(bas, src.indexOf('\n}', bas))
        const ilk = govde.split('\n').slice(1).map((l) => l.trim()).find((l) => l !== '')
        expect(ilk).toBe('if (!ANALYTICS_ENABLED) return')
        expect(govde.indexOf('if (!ANALYTICS_ENABLED) return')).toBeLessThan(govde.indexOf('try {'))
    })

    it('ping hatalari yutulur (async + try/catch)', () => {
        const bas = src.indexOf('async function pingAnalytics()')
        expect(bas).toBeGreaterThan(-1)
        const govde = src.slice(bas, src.indexOf('\n}', bas))
        expect(govde).toContain('try {')
        expect(govde).toContain('catch')
    })
})
