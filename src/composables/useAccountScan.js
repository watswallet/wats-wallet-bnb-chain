// Seed import'unda tarama durumunu tutar: bulunan satirlar, "kontrol ediliyor" satiri, Atla.
//
// Saf tarama mantigi accountScan.js'te; burasi onun olaylarini ekranin okuyacagi reaktif
// duruma cevirir. Gorunum (AccountScan.vue) yalniz bu durumu gosterir.
//
// SOZLESME (anti-hedef: import tamamlanamaz ya da kullanici ekranda takili kalir):
//   - start() HICBIR kosulda firlatmaz ve reddedilmez. Tarama ya da yoklama kaynakli her
//     hata (bozuk sonuc dahil) {accountCount: 1, outcome: 'error'} olur ve phase yine
//     'done'a ulasir; import Hesap 1 ile surer. Sessiz hatanin tek izi console.error'dur.
//   - skip() asili bir tarama olsa bile ekrani serbest birakir. Iptal sinyali `scan`e
//     gider ama `scan` ona hic yanit vermese de start() beklemeden 'skipped' ile doner
//     (ikinci guvence: "takili kalma" iptalin calismasina bagli degildir).
//   - "Atla" son sozdur: skip() cagrildiysa sonuc HER ZAMAN 'skipped' / 1 hesaptir, tarama
//     ayni anda bitmis olsa bile. Atla'dan sonra gelen gec olaylar yok sayilir.
//
// `rows` = EKLENECEK hesaplar. accountScan 'skipped' donerken onceden yaydigi 'included'
// olaylarini geri almaz ve bir hata taramayi yarida kesebilir; bu yuzden skip() ve sonuc
// yazimi listeyi sonucun hesap sayisina kirpar. Ekranda gosterilen ile cuzdana eklenen
// hesap sayisi hicbir durumda ayrismaz.
import { ref } from 'vue'
import { scanUsedAccounts } from '../utils/accountScan'
import { probeEvmAddress } from '../utils/evmUsageProbe'

// Her seferinde TAZE nesne: sonuc `result` ref'ine yazilir, paylasilan bir sabit olsaydi bir
// tuketicinin degisikligi sonraki taramalara sizardi.
const skippedResult = () => ({ accountCount: 1, usedIndexes: [], outcome: 'skipped' })
const errorResult = () => ({ accountCount: 1, usedIndexes: [], outcome: 'error' })

// Adlandirma cagirandadir (i18n + mevcut hesap sayisi gerekir); verilmezse ad bos dizgidir.
const noName = () => ''

// start() basina bir calisma nesnesi: iptal denetleyicisi, "atlandi" bayragi ve start()'i asili
// `scan`den kurtaran sozu. Bayrak calisma BASINA oldugu icin atlanmis ya da yenisiyle
// degistirilmis bir taramanin gec olaylari, yeni taramanin durumunu kirletemez.
function newRun() {
    const run = { controller: new AbortController(), skipped: false, release: null, whenSkipped: null }
    run.whenSkipped = new Promise((resolve) => {
        run.release = resolve
    })
    return run
}

// Taramayi birakir: gec olaylar yok sayilir, bekleyen yoklamalar iptal edilir ve start()
// beklemeden 'skipped' ile doner.
function halt(run) {
    run.skipped = true
    run.controller.abort()
    run.release(skippedResult())
}

/**
 * @param {object} [deps] testte enjekte edilir
 * @param {Function} [deps.scan] tarama dongusu (varsayilan accountScan.scanUsedAccounts)
 * @param {*} [deps.probe] adres yoklamasi (varsayilan evmUsageProbe.probeEvmAddress); `scan`e aynen verilir
 */
export function useAccountScan({ scan = scanUsedAccounts, probe = probeEvmAddress } = {}) {
    const phase = ref('idle') // 'idle' | 'scanning' | 'done'
    const rows = ref([]) // eklenecek hesaplar: {index, name, address, used}
    const checking = ref(null) // su an yoklanan indeks: {index, name, address} | null
    const result = ref(null) // {accountCount, usedIndexes, outcome} | null

    // Calisan tarama (yoksa null). Ortak durumu (rows/checking/result/phase) yalniz o yazar.
    let current = null

    /**
     * Taramayi baslatir ve bitince sonucu dondurur; HICBIR kosulda firlatmaz.
     * Tarama surerken yeni bir start() eskisini birakir (iptal eder; eskisi 'skipped' ile doner,
     * ortak duruma dokunmaz).
     *
     * @param {string} mnemonic BIP39 ifadesi
     * @param {{nameFor?: (index: number) => string}} [opts] satir adlarini verir
     * @returns {Promise<{accountCount: number, usedIndexes: number[],
     *   outcome: 'completed'|'network_failed'|'timed_out'|'skipped'|'error'}>}
     */
    async function start(mnemonic, opts) {
        const nameFor = opts?.nameFor ?? noName
        // Surerken gelen ikinci start() eskisini birakir; yoksa eskisinin olaylari yeni durumu kirletirdi.
        if (current) halt(current)

        // Buradan scan() cagrisina kadar HICBIR await yok: scan ilk olaylarini (included 0) hemen yayar
        // ve "start sonra hemen skip" signal'e ulasabilmelidir.
        const run = newRun()
        current = run
        phase.value = 'scanning'
        rows.value = []
        checking.value = null
        result.value = null

        const onProgress = (event) => {
            if (run.skipped) return
            if (event.type === 'included') {
                rows.value.push({
                    index: event.index,
                    name: nameFor(event.index),
                    address: event.address,
                    used: event.used,
                })
            } else if (event.type === 'checking') {
                checking.value = { index: event.index, name: nameFor(event.index), address: event.address }
            } else if (event.type === 'checked') {
                checking.value = null
            }
        }

        let outcome
        try {
            outcome = await Promise.race([
                scan({ mnemonic, probe, signal: run.controller.signal, onProgress }),
                run.whenSkipped,
            ])
            // Sozlesmeyi bozan sonuc (bos, 1'den az hesap) sessizce yazilmaz: tek hesap + 'error'.
            if (!outcome || !Number.isInteger(outcome.accountCount) || outcome.accountCount < 1) {
                throw new TypeError('gecersiz tarama sonucu')
            }
        } catch (err) {
            console.error('[useAccountScan] tarama basarisiz:', err)
            outcome = errorResult()
        }
        // "Atla son sozdur": scan ayni anda bitmis (ya da hata vermis) olsa bile yarisin sonucu atilir.
        if (run.skipped) outcome = skippedResult()

        // Bu arada yeni bir start() bu taramanin yerini aldiysa ortak durum artik ona aittir.
        if (current !== run) return outcome

        current = null
        rows.value = rows.value.slice(0, outcome.accountCount)
        checking.value = null
        result.value = outcome
        phase.value = 'done'
        return outcome
    }

    /**
     * "Atla": taramayi birakir, yalniz ilk satir kalir. Calisan tarama yoksa (henuz baslamamis ya
     * da bitmis) etkisizdir; art arda cagrilmasi da zararsizdir (halt() tekrarlanabilir).
     */
    function skip() {
        if (!current) return
        halt(current)
        rows.value = rows.value.slice(0, 1)
        checking.value = null
    }

    return { phase, rows, checking, result, start, skip }
}
