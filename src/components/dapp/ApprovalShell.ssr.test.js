// ApprovalShell.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (task-59 brief): 8 onay ekrani AYNI iskeleti (kok sabit popup olculeri, ustte
// kucuk baslik + buyuk origin + iddia pili, altta sabit buton seridi) BAGIMSIZ
// birer kopya olarak tasiyordu -- icerik kisa oldugunda ekranin cogu bos kalirdi
// ve sekiz kopyadan biri guncellenip digerleri unutulursa yeni bir sinif TEK
// ekranda kapanirdi. Bu dosya o ORTAK iskeleti (ApprovalShell.vue) TEK basina,
// TUKETEN ekranlardan BAGIMSIZ dogrular; dappScreensShell.test.js ise sekiz
// ekranin GERCEKTEN bu kabugu kullandigini kilitler.
//
// ApprovalShell'in KENDI script'i onMounted/async veri cekme icermez (yalniz
// props'tan turetilen computed'lar) -- bu yuzden diger dapp SSR testlerindeki
// 'vue' mock'u / captureInstance mekanizmasi (bkz. ssrRender.js basindaki
// KULLANIM notu) burada GEREKSIZ: renderToString props degistikce SENKRON
// olarak dogru HTML'i uretir.
import { describe, it, expect } from 'vitest'
import { h } from 'vue'
import { createApp, render } from '../../test-utils/ssrRender.js'
import { LISTED_CHAINS } from '../../data/chains'
import { TON_MAINNET_ID } from '../../utils/chainKind'
import ApprovalShell from './ApprovalShell.vue'

const TON_LOGO_URI = LISTED_CHAINS.find((c) => Number(c.chainId) === TON_MAINNET_ID)?.logoURI

// createApp(Component, { props }) bilesenin PROPS'unu tasir ama SLOT
// GECIREMEZ (bkz. ssrRender.js: createSSRApp(Component, props)). Slot
// icerigi vermek gerektiginde kucuk bir sarmalayici bilesen -- render'i
// dogrudan h(ApprovalShell, props, slots) cagiran -- kok bilesen olarak
// verilir; bu, testin KENDI ihtiyaci olan tek yerel yardimcidir, ApprovalShell'in
// KENDI kaynagina hicbir sekilde dokunmaz.
function renderShell(props, slots = {}) {
    const Sarmalayici = { render: () => h(ApprovalShell, props, slots) }
    return render(createApp(Sarmalayici))
}

describe('ApprovalShell.vue (SSR) -- iskelet', () => {
    it('kok ucuncu duzen modunda esneyen sinifi tasir', async () => {
        const html = await renderShell({ chain: 'evm', title: 'BASLIK', origin: 'https://example.com' })
        // Kok sinifi ucuncu duzen modunda da calisacak sekilde degisti:
        // sabit popup olculeri yerine `w-full h-full` + ortalanan max-width.
        // Panel genisletildiginde olu serit, 320px'e daraltildiginda kesilen
        // icerik olusmaz.
        expect(html.startsWith('<div class="w-full h-full max-w-[420px] mx-auto')).toBe(true)
    })

    it('icerik sargisi min-h-full VE justify-center tasir (kisa icerik dikeyde ortalanir)', async () => {
        const html = await renderShell({ chain: 'evm', title: 'BASLIK', origin: 'https://example.com' })
        expect(html).toContain('min-h-full flex flex-col justify-center')
    })

    it('footer slotu <footer icinde cizilir', async () => {
        const html = await renderShell(
            { chain: 'evm', title: 'BASLIK', origin: 'https://example.com' },
            { footer: () => [h('button', 'Reddet'), h('button', 'Onayla')] },
        )
        const footerAcilis = html.indexOf('<footer')
        const footerKapanis = html.indexOf('</footer>')
        expect(footerAcilis).toBeGreaterThan(-1)
        const footerIcerik = html.slice(footerAcilis, footerKapanis)
        expect(footerIcerik).toContain('Reddet')
        expect(footerIcerik).toContain('Onayla')
        // Butonlar footer'IN ICINDE olmali, ustteki kayan icerik alaninda DEGIL.
        expect(html.indexOf('Reddet')).toBeGreaterThan(footerAcilis)
    })

    it('varsayilan slot icerigi cizilir', async () => {
        const html = await renderShell(
            { chain: 'evm', title: 'BASLIK', origin: 'https://example.com' },
            { default: () => h('p', 'GOVDE-METNI-XYZ') },
        )
        expect(html).toContain('GOVDE-METNI-XYZ')
    })
})

describe('ApprovalShell.vue (SSR) -- baslik/origin', () => {
    it('title ve origin AYNEN cizilir', async () => {
        const html = await renderShell({ chain: 'evm', title: 'BAGLANTI ISTEGI', origin: 'https://app.example.com' })
        expect(html).toContain('BAGLANTI ISTEGI')
        expect(html).toContain('https://app.example.com')
        const h2Icerik = html.match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1]
        expect(h2Icerik).toBe('https://app.example.com')
    })
})

describe('ApprovalShell.vue (SSR) -- iddia pili', () => {
    it('claimedName BOS ise pil HIC cizilmez', async () => {
        const html = await renderShell({ chain: 'evm', title: 'T', origin: 'https://x.example', claimedName: '' })
        expect(html).not.toContain('max-w-full')
    })

    it('claimedName DOLU ise pil cizilir ve metni tasir', async () => {
        const html = await renderShell({ chain: 'evm', title: 'T', origin: 'https://x.example', claimedName: 'Iddia Edilen Ad' })
        expect(html).toContain('max-w-full')
        expect(html).toContain('Iddia Edilen Ad')
    })

    it('claimedIcon BOS ise pil icinde <img> YOK', async () => {
        const html = await renderShell({ chain: 'evm', title: 'T', origin: 'https://x.example', claimedName: 'Ad', claimedIcon: '' })
        const pilEslesme = html.match(/<div class="flex items-center gap-2 mt-1[^"]*">([\s\S]*?)<\/div>/)
        expect(pilEslesme).not.toBeNull()
        expect(pilEslesme[1]).not.toContain('<img')
    })

    it('claimedIcon DOLU ise pil icindeki img TAM OLARAK w-4 h-4 tasir', async () => {
        const html = await renderShell({
            chain: 'evm', title: 'T', origin: 'https://x.example', claimedName: 'Ad', claimedIcon: 'https://cdn.example.com/i.png',
        })
        const pilEslesme = html.match(/<div class="flex items-center gap-2 mt-1[^"]*">([\s\S]*?)<\/div>/)
        expect(pilEslesme).not.toBeNull()
        const imgEslesme = pilEslesme[1].match(/<img[^>]*class="([^"]*)"/)
        expect(imgEslesme).not.toBeNull()
        // K5: iddia edilen ikon 16px'i (w-4 h-4) ASLA ASMAZ -- ikincil kalir.
        expect(imgEslesme[1]).toContain('w-4 h-4')

        // KOD INCELEMESI: onceki negatif regex `/w-(?!4\b)\d+ h-(?!4\b)\d+/`
        // idi ve BIR UST SATIR sayesinde PRATIKTE HIC KIRMIZI OLAMIYORDU:
        // yakaladigi her dizge (`w-8 h-8`, `w-6 h-6`, `w-14 h-14`) zaten
        // `toContain('w-4 h-4')` iddiasinda kirmiziya donuyordu, `w-4 h-4`i
        // KORUYARAK boyutu buyuten gercekci gerilemelerin ise HICBIRINI
        // gormuyordu: olculdu -- 'w-4 h-4 sm:w-8 sm:h-8', 'w-4 h-4 md:w-10
        // md:h-10', 'w-4 h-4 scale-150', 'w-4 h-4 min-w-8 min-h-8' hepsi
        // null (yesil). Yan yana OLMAYAN ciftleri de goremiyordu ('w-4 h-8',
        // 'h-8 w-8' -> null). Simdi sinif listesindeki HER boyut belirteci
        // tek tek toplanir ve kume TAM OLARAK {w-4, h-4} olmak zorundadir --
        // duyarli (`sm:`), en/boy alt-ust sinirlari ve `scale-` dahil.
        const boyutBelirtecleri = imgEslesme[1]
            .split(/\s+/)
            .filter(Boolean)
            .filter((sinif) => /(^|:)(min-|max-)?[wh]-|(^|:)(size|scale)-/.test(sinif))
        expect([...boyutBelirtecleri].sort()).toEqual(['h-4', 'w-4'])
    })
})

describe('ApprovalShell.vue (SSR) -- rozet', () => {
    it('chain=solana ise varsayilan rozet /chains/solana.svg cizer', async () => {
        const html = await renderShell({ chain: 'solana', title: 'T', origin: 'https://x.example' })
        expect(html).toContain('/chains/solana.svg')
    })

    it('chain=ton ise varsayilan rozet TON ag listesinin logoURI sini cizer', async () => {
        expect(TON_LOGO_URI).toBeTruthy()
        const html = await renderShell({ chain: 'ton', title: 'T', origin: 'https://x.example' })
        expect(html).toContain(TON_LOGO_URI)
    })

    it('chain=evm ise varsayilan rozet /chains/1.png cizer', async () => {
        const html = await renderShell({ chain: 'evm', title: 'T', origin: 'https://x.example' })
        expect(html).toContain('/chains/1.png')
    })

    it('badgeSrc verilirse varsayilan yerine ONU cizer', async () => {
        const html = await renderShell({ chain: 'solana', title: 'T', origin: 'https://x.example', badgeSrc: 'https://cdn.example.com/ozel.png' })
        expect(html).toContain('https://cdn.example.com/ozel.png')
        expect(html).not.toContain('/chains/solana.svg')
    })

    it('badge slotu verilince VARSAYILAN rozet HIC cizilmez', async () => {
        const html = await renderShell(
            { chain: 'solana', title: 'T', origin: 'https://x.example' },
            { badge: () => h('div', { class: 'ozel-rozet-isareti' }, 'OZEL ROZET') },
        )
        expect(html).toContain('ozel-rozet-isareti')
        expect(html).not.toContain('/chains/solana.svg')
        // Varsayilan rozetin KENDI kutusu (w-14 h-14) de HIC cizilmemeli.
        expect(html).not.toContain('w-14 h-14')
    })
})

describe('ApprovalShell.vue (SSR) -- tint', () => {
    it('chain=evm -> indigo tint', async () => {
        const html = await renderShell({ chain: 'evm', title: 'T', origin: 'https://x.example' })
        expect(html).toContain('from-indigo-500/5')
        expect(html).not.toContain('from-violet-500/5')
        expect(html).not.toContain('from-sky-500/5')
    })

    it('chain=solana -> violet tint', async () => {
        const html = await renderShell({ chain: 'solana', title: 'T', origin: 'https://x.example' })
        expect(html).toContain('from-violet-500/5')
        expect(html).not.toContain('from-indigo-500/5')
        expect(html).not.toContain('from-sky-500/5')
    })

    it('chain=ton -> sky tint', async () => {
        const html = await renderShell({ chain: 'ton', title: 'T', origin: 'https://x.example' })
        expect(html).toContain('from-sky-500/5')
        expect(html).not.toContain('from-indigo-500/5')
        expect(html).not.toContain('from-violet-500/5')
    })
})
