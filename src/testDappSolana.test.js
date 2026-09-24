// test-dapp/ ELLE dogrulama kosumunun kaynak kilidi.
//
// NEDEN VAR: bu sayfa CI'da calismaz, yalnizca bir insan tiklar. Bir uye
// yeniden adlandirildiginda ya da bir sekme yanlislikla silindiginde hicbir
// sey kirilmaz -- sayfa sessizce EKSIK olur ve o eksik, ancak magazaya
// yuklendikten sonra fark edilir. Bu dosya, elle dogrulama listesinin
// gercekten cagirdigi yuzeyi metin olarak kilitler.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// CRLF normalizasyonu (G2): repo core.autocrlf=true; test-dapp/index.html icin
// .gitattributes eol=lf pinlese de, pin OLMADAN taze bir Windows checkout'u
// CRLF yapar. Fonksiyon-dali regex'i (`\n` arar) ve `indexOf('<script>\n')`
// boyle bir checkout'ta SAHTE kirmizi verir -- okuma aninda normalize ederek
// TUM pinler satir-sonu bagimsiz hale gelir.
const HTML = readFileSync(new URL('../../test-dapp/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('test-dapp -- sekmeler', () => {
    it('TON ve Wallet Standard sekmeleri vardir', () => {
        expect(HTML).toContain('id="tab-ton"')
        expect(HTML).toContain('id="tab-ws"')
        expect(HTML).toContain("secSekme('ws')")
    })
})

describe('test-dapp -- Wallet Standard sekmesi (SS3.1)', () => {
    // Referans uygulamada olayin `detail`i cuzdan nesnesi DEGIL, bir
    // FONKSIYONDUR. Sayfa bunu yanlis yaparsa "cuzdan gorunmuyor" hatasi
    // cuzdanda aranir -- oysa hata kosumdadir.
    it('app-ready yayinlar ve register-wallet detail ini FONKSIYON olarak cagirir', () => {
        expect(HTML).toContain('wallet-standard:app-ready')
        expect(HTML).toContain('wallet-standard:register-wallet')
        expect(HTML).toContain("typeof e.detail !== 'function'")
    })

    it('SS3.2 nin yedi ozelligini de yoklar', () => {
        for (const ad of [
            'standard:connect', 'standard:disconnect', 'standard:events',
            'solana:signTransaction', 'solana:signAndSendTransaction',
            'solana:signMessage', 'solana:signIn',
        ]) {
            expect(HTML, ad).toContain(ad)
        }
    })

    // K3'un sessiz basarisizligi: ['legacy','0'] yazmak adaptoru legacy-only'ye
    // dusurur. Kosum SAYI 0 arar, dizeyi degil.
    it('supportedTransactionVersions icinde SAYI 0 aranir', () => {
        expect(HTML).toContain('supportedTransactionVersions')
        expect(HTML).toContain("v === 0 && typeof v === 'number'")
    })

    // SS3.4: her solana:* metodu DIZI doner. Tek nesne donen bir cuzdan,
    // adaptorlerin `const [out] = await ...` kalibinda undefined verir.
    it('cikisin DIZI oldugunu dogrular', () => {
        expect(HTML).toContain('Array.isArray')
    })

    it('window.phantom ya da isPhantom YOKLAMASI ile cuzdan aramaz', () => {
        expect(HTML).not.toContain('window.phantom')
        // Brief yalnizca window.phantom'i pinler. Ozellik OKUMASI (`.isPhantom`)
        // burada da yasak -- ama Gorev 51 legacy sekmesinde `'isPhantom' in p`
        // DIZGE yoklamasi ekleyecek, o yuzden bu iddia ozellik-erisim SEKLINE
        // ozgu tutulur.
        expect(HTML).not.toMatch(/\.isPhantom\b/)
    })
})

describe('test-dapp -- kv() HTML kacirma (K1)', () => {
    // kv() cuzdan-kaynakli dizgeleri (name, chains, address, ozellik adlari,
    // hata mesajlari) HAM innerHTML'e yaziyordu. Bir cuzdan adina/ozelligine
    // '<img onerror=...>' gibi bir deger koysa bu sayfada calisirdi. esc()
    // hem anahtari hem degeri HTML-kacirir.
    it("esc yardimcisi tanimlidir ve '&<>\"'' i kaciriyor", () => {
        expect(HTML).toContain("replace(/[&<>\"']/g")
    })

    it('kv() degerleri esc() uzerinden yaziyor', () => {
        expect(HTML).toMatch(/const kv = [^\n]*esc\(/)
    })
})

describe('test-dapp -- web3.js CDN surumu (K3)', () => {
    it('uzantiyla ayni surum (1.98.4) pinlenir', () => {
        expect(HTML).toContain('@solana/web3.js@1.98.4/lib/index.iife.min.js')
    })
})

// Fix turu 1: controller okuma turunde iki mutant "var mi" tarzi zayif
// pinlerden HAYATTA KALDI. Bu describe blogu o pinleri TAM eslesmeye
// (esc'in HER IKI cagriyi da sardigini, Array.isArray'in HER cikis
// noktasinda goruldugunu) cevirir; ayrica P1/P2 duzeltmelerinin
// kaynak-kilidini ekler.
describe('test-dapp -- kaynak kilidi guclendirme (fix turu 1)', () => {
    // Onceki pin `[^\n]*esc\(` idi -- kv'nin YALNIZCA degeri (v) kacirip
    // anahtari (k) HAM biraktigi bir mutant bu pinle sessizce hayatta
    // kalirdi. v === undefined dalindaki isaret ASCII disi bir karakter
    // (em-dash) -- '[^\']*' onu atlar, test ASCII kalir.
    it('kv tanimi TAM olarak esc(k) VE esc(v) kullanir', () => {
        expect(HTML).toMatch(/const kv = \(k, v\) => '<div><span>' \+ esc\(k\) \+ '<\/span><span>' \+ \(v === undefined \? '[^']*' : esc\(v\)\) \+ '<\/span><\/div>'/)
    })

    // Onceki pin tek `toContain('Array.isArray')` idi -- iki cikis
    // noktasindan (signMessage/signIn) birinde `Array.isArray(out)` sabit
    // `true`ya donse bile diger noktadaki metin literali testi yesil
    // tutardi. Simdi HER IKI olusum da sayiliyor.
    it('Array.isArray(out) en az iki cikis noktasinda raporlanir', () => {
        expect((HTML.match(/dizi: Array\.isArray\(out\)/g) || []).length).toBeGreaterThanOrEqual(2)
        expect(HTML).toContain("log(Array.isArray(out) ? 'res' : 'err'")
    })

    it('app-ready dispatch ve register-wallet listener TAM sekliyle var', () => {
        expect(HTML).toContain("window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: wsApi }))")
        expect(HTML).toContain("window.addEventListener('wallet-standard:register-wallet'")
        expect(HTML).toMatch(/typeof e\.detail !== 'function'\) \{[\s\S]{0,200}?return\n\s*\}\n\s*e\.detail\(wsApi\)/)
    })

    it('eksik ozellik listesi filter+join ile hesaplanir', () => {
        expect(HTML).toContain("].filter((ad) => !f[ad])")
        expect(HTML).toContain("eksikler.length ? eksikler.join(', ') : 'yok'")
    })

    it('sifirTamam tanimi ve raporu TAM eslesir', () => {
        expect(HTML).toContain("const sifirTamam = stv.some((v) => v === 0 && typeof v === 'number')")
        expect(HTML).toMatch(/sifirTamam \? '[^']*SAYI 0 var' : '[^']*SAYI 0 YOK'/)
    })

    it('esc haritasinin bes girdisi de var', () => {
        expect(HTML).toContain(`'&': '&amp;'`)
        expect(HTML).toContain(`'<': '&lt;'`)
        expect(HTML).toContain(`'>': '&gt;'`)
        expect(HTML).toContain(`'"': '&quot;'`)
        expect(HTML).toContain(`"'": '&#39;'`)
    })

    it('web3.js CDN etiketi inline scriptten ONCE gelir', () => {
        expect(HTML).toContain('<script src="https://unpkg.com/@solana/web3.js@1.98.4/lib/index.iife.min.js"></script>')
        expect(HTML.indexOf('index.iife.min.js')).toBeLessThan(HTML.indexOf('<script>\n'))
    })

    it('secSekme pane gizleme satiri TAM eslesir', () => {
        expect(HTML).toContain("$('tab-' + s).hidden = s !== ad")
    })

    it('window/globalThis/self.phantom yoklamasi hicbir sekilde yok', () => {
        expect(HTML).not.toMatch(/(window|globalThis|self)\s*(\.|\[\s*['"])phantom/)
        expect(HTML).not.toMatch(/\.isPhantom\b/)
    })

    it('WS cagri sekilleri TAM eslesir', () => {
        expect(HTML).toContain('.connect(silent ? { silent: true } : undefined)')
        expect(HTML).toContain("new TextEncoder().encode($('wsMessage').value)")
        expect(HTML).toContain('signMessage({ account: wsAccount, message })')
        expect(HTML).toContain('wsAccount.publicKey instanceof Uint8Array')
    })

    it('kv() atlanip ws degerleri dogrudan HTML literaline yazilmaz', () => {
        expect(HTML).not.toMatch(/<span>' \+ ws(Wallet|Account)\./)
        expect(HTML).not.toMatch(/innerHTML = [^\n]*\bws(Wallet|Account)\./)
    })
})

describe('test-dapp -- banner konumu ve kaynak-serit ayrimi (P1)', () => {
    // banners kapsayicisi #tab-ton pane'inin ICINDE kalirsa WS sekmesi
    // aktifken (pane hidden) hicbir WS banner'i GORUNMEZ -- dugme sessiz
    // no-op gibi gorunur. Kapsayici iki pane'in DISINA, sekme cubugunun
    // USTUNE tasinmis olmali.
    it('banners kapsayicisi sekme cubugunun USTUNDE', () => {
        expect(HTML.indexOf('id="banners"')).toBeLessThan(HTML.indexOf('class="tabs"'))
    })

    // detectBridge eskiden TUM banner'lari siliyordu (`innerHTML = ''`) --
    // wsAra() -> detectBridge() yukleme sirasinda WS banner'i aninda
    // silinirdi. Artik yalnizca kendi seridini (data-serit="ton") temizler.
    it('detectBridge yalnizca kendi seridinin banner larini temizler', () => {
        expect(HTML).toContain(`querySelectorAll('[data-serit="ton"]')`)
        expect(HTML).not.toContain("$('banners').innerHTML = ''")
    })
})

describe('test-dapp -- coklu cuzdan secimi (P2)', () => {
    // Baska bir Solana cuzdani da kuruluysa son kaydolan rastgele kazanirdi.
    // Eski pin `toContain("'WATS Wallet'")` bir YORUM icinde de eslesiyordu
    // (solanaInjected.js:9'a atif yapan aciklama satiri) -- koddaki secim
    // tercihi silinse bile yorum kalinca pin YESIL kalirdi. Simdi CALISAN
    // iki satiri ayri ayri, tam dize olarak pinliyor.
    it('cuzdan kaydi Map e yazilir', () => {
        expect(HTML).toContain('wsKayitlar.set(wallet && wallet.name, wallet)')
    })

    it("'WATS Wallet' secimi CALISAN kod satirinda var", () => {
        expect(HTML).toContain("wsKayitlar.get('WATS Wallet')")
    })
})

describe('test-dapp -- ws banner tek-atis (fix turu 2 / G3, Gorev 51 K1 ile genellendi)', () => {
    // Cuzdansiz her tiklama (S1/S2/S3 herhangi bir WS kapisi) eskiden bir
    // banner DAHA ekliyordu -- TON'daki mevcut davranisin aynisi, ama WS
    // banner'i artik GORULEBILDIGI icin sorun buraya da tasindi. banner()
    // artik 'ws' seriti icin eklemeden ONCE kendi eski banner'ini temizler
    // (tek-atis). Gorev 51 K1: bu tek-atis mantigi 'ton' DISINDAKI HER serit
    // icin genellendi (legacy sekmesi de ayni davranisi ister); eski pin
    // yalnizca serit === 'ws'i ariyordu, artik serit !== 'ton' + degiskenli
    // secici araniyor.
    it("banner() 'ton' disindaki her serit icin eklemeden once eskisini temizler", () => {
        expect(HTML).toMatch(/serit !== 'ton'\) [^\n]*querySelectorAll\('\[data-serit="' \+ serit \+ '"\]'\)/)
    })
})

// Gorev 51 -- test-dapp: legacy window.solana sekmesi. Controller K4: pinler
// YALNIZCA calisan kod satirlarinda gecmeli -- brief'in bazi ciplak
// toContain iddialari (orn. 'onlyIfTrusted', 'window.wats.solana',
// 'sonuc === tx') UI hint metninde/etiketinde de eslesir; asagidaki pinler
// bu yuzden kod SEKLINE (bosluklar, parantezler, anahtar-deger ciftleri)
// daraltilmistir.
describe('test-dapp -- legacy window.solana sekmesi (SS3.5)', () => {
    it('sekme dugmesi ve secSekme cagrisi vardir', () => {
        expect(HTML).toContain('id="tab-legacy"')
        expect(HTML).toContain("secSekme('legacy')")
    })

    // Fix turu 1 / P2: yuvayi baska bir cuzdan kazanmis olabilir -- lg*
    // fonksiyonlari artik `window.solana.*` DEGIL, `lgSaglayici()`nin dondugu
    // `p` uzerinden cagrilir. 9. cagri (removeListener) M1 ile eklendi.
    it('dokuz cagri sekli de p uzerinden KOD satirinda cagrilir', () => {
        for (const cagri of [
            'p.connect(arg)',
            'p.disconnect()',
            'p.signTransaction(tx)',
            'p.signAllTransactions([a, b])',
            'p.signAndSendTransaction(lgIslem(false), { skipPreflight: true })',
            "p.signMessage(bytes, 'utf8')",
            "p.on('connect'",
            "p.off('connect'",
            "p.removeListener('accountChanged'",
        ]) {
            expect(HTML, cagri).toContain(cagri)
        }
    })

    // Bu sekmenin VAR OLMA SEBEBI: donen nesnenin girdiyle AYNI olmasi. base64
    // dizge donen bir cuzdan her legacy dapp'te TypeError uretir ve hata
    // cuzdanda degil dapp'te gorunur. Brief'in ciplak 'sonuc === tx' pini L3
    // hint metninde de gecer -- burada log nesnesindeki anahtar-deger cifti
    // (kod sekli) araniyor.
    it("donen nesnenin === girdiyle ayni oldugunu OLCER (kod satirinda)", () => {
        expect(HTML).toContain("'sonuc === tx': sonuc === tx")
        expect(HTML).toContain("'sonuc[0] === a': sonuc[0] === a")
        expect(HTML).toContain("'sonuc[1] === b': sonuc[1] === b")
    })

    // `new PublicKey(provider.publicKey)` legacy dapp'lerin ilk yaptigi seydir
    // ve sarmalayicinin gercek bir Uint8Array olmasinin tek sebebi budur.
    // Fix turu 1 / P2: `window.solana.publicKey` degil `p.publicKey` okunur --
    // window.solana yabanci bir cuzdana ait olabilir.
    it('new PublicKey(p.publicKey) cagrisini dener', () => {
        expect(HTML).toContain('new solanaWeb3.PublicKey(p.publicKey)')
    })

    // Brief'in ciplak 'onlyIfTrusted' pini L2 dugme etiketinde de gecer
    // (bosluksuz '{onlyIfTrusted:true}'); kod sekli bosluklu nesne literali.
    it('onlyIfTrusted KOD satirinda (bosluklu nesne literali) vardir', () => {
        expect(HTML).toContain('{ onlyIfTrusted: true }')
    })

    // Devredilmis yuva sessiz bir arizadir: dapp baska bir cuzdanla konusur ve
    // "Wats calismiyor" diye raporlanir. Kosum bunu ACIKCA gostermeli.
    // Brief'in ciplak 'window.wats.solana' pini L1 hint metninde de gecer;
    // burada '.legacy' ile biten kod sekli araniyor.
    it('yuvanin devredilip devredilmedigini raporlar (kod satirinda)', () => {
        expect(HTML).toContain("kv('legacySlot', p.legacySlot)")
        expect(HTML).toContain('window.wats.solana.legacy')
    })
})

describe('test-dapp -- legacy uye listesi ve olay kilidi (K7)', () => {
    // lgAra() dokuz uyeyi TEK SATIRDA yoklar -- dizinin TAM literalini
    // pinlemek, bir uyenin sessizce silinmesini/yeniden adlandirilmasini
    // yakalar (isWatsWallet ve publicKey/isConnected haric -- onlar
    // fonksiyon degil).
    it('uyeler dizisinin TAM literali kod satirinda var', () => {
        expect(HTML).toContain("['connect', 'disconnect', 'signTransaction', 'signAllTransactions', 'signAndSendTransaction', 'signMessage', 'on', 'off', 'removeListener']")
    })

    // Fix turu 1 / M1: eskiden her tiklama YENI bir closure ekliyordu ve
    // `off(() => {})` farkli bir referans oldugu icin HICBIR SEYI kaldirmiyordu.
    // Simdi dinleyiciler `lgDinleyiciler`de saklanir; ikinci tiklama AYNI
    // referanslarla p.off/p.removeListener cagirir.
    it('lgOlaylar kalici dinleyiciler kurar ve AYNI referanslarla kaldirir', () => {
        expect(HTML).toContain("p.on('connect', lgDinleyiciler.connect)")
        expect(HTML).toContain("p.on('disconnect', lgDinleyiciler.disconnect)")
        expect(HTML).toContain("p.on('accountChanged', lgDinleyiciler.accountChanged)")
        expect(HTML).toContain("p.off('connect', lgDinleyiciler.connect)")
        expect(HTML).toContain("p.off('disconnect', lgDinleyiciler.disconnect)")
        expect(HTML).toContain("p.removeListener('accountChanged', lgDinleyiciler.accountChanged)")
    })

    // Fix turu 1 / M2: cuzdan-kaynakli accountChanged/disconnect olaylari
    // eskiden L2 kartini yenilemiyordu (hesap degisince/kesilince eski hesap
    // gorunmeye devam ederdi).
    it('accountChanged/disconnect olaylari L2 kartini yeniler', () => {
        expect(HTML).toMatch(/if \(ad === 'accountChanged' \|\| ad === 'disconnect'\) lgHesapRender\(\)/)
    })
})

describe('test-dapp -- review fix turu 1: wats seridi yonlendirmesi (P1/P2)', () => {
    // P1: web3.js 1.98.4 VersionedTransaction ctor `signatures`i her zorunlu
    // imzaci icin SIFIR dolu bir Uint8Array(64) ile ON-DOLDURUR -- eski pin
    // (`!!tx.signatures[0]`) saglayici HIC imzalamasa bile true donerdi.
    it("v0 'imza yazildi' sifir-doldurulmus imzayla BASARILI GORUNMEZ (P1)", () => {
        expect(HTML).toContain('tx.signatures[0].some((b) => b !== 0)')
    })

    // Onceki turde `lgSaglayici`nin YEDEGI (window.wats.solana.legacy dali)
    // hicbir testte GERCEKTEN calisir sekilde pinlenmemisti -- controller'in
    // hayatta kalan mutanti: yedek kaldirilinca 41/41 yesil kaliyordu. Simdi
    // wats seridi ONCE denenen TAM satir pinleniyor.
    it('lgSaglayici wats seridini ONCE dener (P2)', () => {
        expect(HTML).toContain('return (window.wats && window.wats.solana && window.wats.solana.legacy) || window.solana || null')
    })

    // Yuvayi baska bir cuzdan kazanmis olabilir -- lg* fonksiyonlarinin
    // HICBIRI artik dogrudan window.solana.* CAGIRMAZ (hepsi p uzerinden).
    it('legacy fonksiyonlari ARTIK window.solana.* cagirmaz (P2)', () => {
        expect(HTML).not.toMatch(/window\.solana\.(connect|disconnect|signTransaction|signAllTransactions|signAndSendTransaction|signMessage|on|off|removeListener)\(/)
    })

    it('window.solana === p karsilastirmasi L1 raporunda var (P2)', () => {
        expect(HTML).toContain('window.solana === p')
    })
})

describe('test-dapp -- legacy sekmede kv()/log() disinda kacirma yok (K5)', () => {
    // legacy sekmesinde cuzdan/dapp-kaynakli tum degerler kv() (kacirir) ya da
    // log() (textContent) uzerinden gider; innerHTML'e dogrudan p./
    // window.solana. ya da PublicKey yeniden-kurma sonucu (yeniden) HAM
    // birlestirilmez.
    it('p./window.solana. degerleri <span> icine ham birlestirilmez', () => {
        expect(HTML).not.toMatch(/<span>' \+ (p|window\.solana)\./)
        expect(HTML).not.toMatch(/innerHTML = [^\n]*\b(p|window\.solana)\./)
    })

    it('yeniden degiskeni de <span> icine ham birlestirilmez', () => {
        expect(HTML).not.toMatch(/<span>' \+ yeniden\b/)
    })
})

describe('test-dapp -- sekme kilidi guclendirme (K6, ucuncu sekme)', () => {
    it("secSekme ucuncu sekmeyi (legacy) de kapsar", () => {
        expect(HTML).toContain("for (const s of ['ton', 'ws', 'legacy'])")
    })

    it('btn-tab-legacy dugmesi ve onclick i var', () => {
        expect(HTML).toContain('id="btn-tab-legacy"')
        expect(HTML).toContain("onclick=\"secSekme('legacy')\"")
    })
})

describe('test-dapp -- legacy banner seridi tutarliligi (K9 / M5 yedek pin)', () => {
    // Her banner() cagrisi 'legacy' seridini TASIMALI -- biri dusurulurse bu
    // banner baska bir seritte (ya da varsayilan 'ton'da) gorunur/kaybolur.
    // En az 3 cagri bekleniyor: lgAra() (err + warn) ve lgHazir() (warn).
    it("legacy sekmesindeki banner() cagrilarinin TAMAMI 'legacy' seridini tasir", () => {
        expect((HTML.match(/banner\('[a-z]+', [^\n]*, 'legacy'\)/g) || []).length).toBeGreaterThanOrEqual(3)
    })
})

describe('test-dapp -- ALICI_TEST kaldirildi, kendine transfer (K2)', () => {
    it('ALICI_TEST sabiti hic yazilmaz', () => {
        expect(HTML).not.toContain('ALICI_TEST')
    })

    it('lgIslem kendine transfer kurar (toPubkey: from)', () => {
        expect(HTML).toContain('toPubkey: from')
    })
})

// Fix turu 1 -- F1 (controller hatasi): arka plan {code:4001, message:'User
// closed the window.'} gonderir (utils/dappFunctions.js:18) AMA
// solanaInjected.js:163-164 STANDART_MESAJ tablosu 4001 mesajini 'User
// rejected the request.' ile EZER (Gorev 45b, bilerek -- ham metin yalnizca
// non-enumerable hamMesaj'ta kalir, dapp'e hicbir zaman gorunmez). Sayfa
// GERCEKTEN gozlemlenen metni yazmali; onceki pin ('User closed the window.')
// dapp'in HIC GORMEDIGI bir metni dogru sanip kirmizi kalmasi gereken bir
// hatayi yesile cikariyordu.
describe('test-dapp -- sahte blockhash hint metni gercek akisa gore (K3, F1)', () => {
    it('yanlis SOLANA_BLOCKHASH_EXPIRED iddiasi YOK, 4001 + normalize edilmis metin bekleniyor', () => {
        expect(HTML).not.toContain('SOLANA_BLOCKHASH_EXPIRED')
        expect(HTML).toContain('4001')
        expect(HTML).toContain("'User rejected the request.'")
    })
})

describe('test-dapp -- WS cuzdan-kaynakli olay abonelidigi (F3)', () => {
    // standard:events'e abone olunmazsa cuzdandan kesme/hesap degisikligi WS
    // tarafinda HICBIR SEY gostermez -- L2'nin accountChanged/disconnect
    // abonelidigiyle (K7) simetrik olmasi gerekirdi, WS tarafinda eksikti.
    it('standard:events change dinlenir ve gunlukte raporlanir (kod satirinda)', () => {
        expect(HTML).toContain("['standard:events'].on('change'")
        expect(HTML).toContain("log('evt', 'standard:events change'")
    })
})

describe('test-dapp -- WS hata gunlukleri kod tasir (F4)', () => {
    // Legacy sekmesindeki HER hata gunlugu 'kod ' + e.code tasir (K7); WS
    // tarafinda hicbiri tasimiyordu -- hata koduna bakmadan "hata oldu"dan
    // fazlasini soylemiyordu. Dort WS catch blogu da (connect, disconnect,
    // signMessage, signIn) artik kodu gunlukluyor.
    it("WS catch bloklarinin en az dordu hata KODUNU gunlukler", () => {
        expect(HTML).toContain("kod ' + (e && e.code)")
        expect((HTML.match(/kod ' \+ \(e && e\.code\)/g) || []).length).toBeGreaterThanOrEqual(4)
    })
})

// Fix turu 1 -- T1: onceki cagri-sekli pinleri sadece bir CAGRININ var
// oldugunu dogruluyordu ("const sonuc = tx; p.signTransaction(tx)" gibi bir
// mutasyon o pinleri yesil birakirdi). TAM atama satirlari pinlenir.
describe('test-dapp -- review fix turu 1: tam atama satirlari (T1)', () => {
    it('sonuc/res degiskenleri DOGRUDAN p cagrisinin sonucudur', () => {
        for (const satir of [
            "const sonuc = await p.signTransaction(tx)",
            "const sonuc = await p.signAllTransactions([a, b])",
            "const sonuc = await p.signAndSendTransaction(lgIslem(false), { skipPreflight: true })",
            "const sonuc = await p.signMessage(bytes, 'utf8')",
            "const res = await p.connect(arg)",
        ]) {
            expect(HTML, satir).toContain(satir)
        }
    })
})

// Fix turu 1 -- T2: dugme baglantilari (onclick) ve betik sonu kosum sirasi.
describe('test-dapp -- review fix turu 1: legacy dugme baglantilari ve kosum sirasi (T2)', () => {
    it('legacy pane deki her dugmenin onclick i var', () => {
        for (const onclick of [
            'onclick="lgAra()"',
            'onclick="lgConnect(false)"',
            'onclick="lgConnect(true)"',
            'onclick="lgDisconnect()"',
            'onclick="lgOlaylar()"',
            'onclick="lgBlockhashCek()"',
            'onclick="lgSignTx(false)"',
            'onclick="lgSignTx(true)"',
            'onclick="lgSignAll()"',
            'onclick="lgSignMessage()"',
            'onclick="lgSignAndSend()"',
        ]) {
            expect(HTML, onclick).toContain(onclick)
        }
    })

    it('betik sonunda wsAra() hemen ardindan lgAra() cagrilir', () => {
        expect(HTML).toMatch(/\nwsAra\(\)\nlgAra\(\)\n/)
    })
})

// Fix turu 1 -- T3: brief den kalan tuketici pinleri TAM satir olarak
// guclendirildi.
describe('test-dapp -- review fix turu 1: tuketici pinleri (T3)', () => {
    it('eksik uye hesabi, isPhantom yoklamasi ve onlyIfTrusted argumani TAM satir', () => {
        expect(HTML).toContain("uyeler.filter((ad) => typeof p[ad] !== 'function')")
        expect(HTML).toContain("'isPhantom' in p ?")
        expect(HTML).toContain('const arg = sessiz ? { onlyIfTrusted: true } : undefined')
    })
})

// Fix turu 1 -- T4: legacy segmentindeki HER banner() cagrisi 'legacy'
// seridini tasimali -- eski pin yalnizca >= 3 sayiyordu, seritsiz 4. bir
// cagri eklense de gecerdi. Esitlik banner-sayisi === legacy-serit-sayisi
// olarak dogrulanir.
describe('test-dapp -- review fix turu 1: legacy banner serit esitligi (T4)', () => {
    it("legacy segmentindeki TUM banner() cagrilari 'legacy' seridini tasir", () => {
        const marker = "// --- legacy window.solana (SS3.5)"
        const idx = HTML.indexOf(marker)
        expect(idx).toBeGreaterThan(-1)
        const seg = HTML.slice(idx)
        const bannerSayisi = (seg.match(/banner\(/g) || []).length
        const legacySeritSayisi = (seg.match(/, 'legacy'\)/g) || []).length
        expect(bannerSayisi).toBe(legacySeritSayisi)
        expect(bannerSayisi).toBeGreaterThanOrEqual(3)
    })
})

// Fix turu 1 -- T5: K5 genellemesi. kv()'nin KENDI tanimi (satir ~468, TON
// tarafinda paylasimli) `<span>' + (v === undefined ? ...` seklinde bir
// esc()-siz birlestirme icerir (esc(v) TERNARY icinde, dogrudan esc( ile
// baslamaz) -- bu KASITLI ve GUVENLIDIR (deger zaten esc() ile sarili,
// yalnizca placeholder farkli). Kontrol bu yuzden WS+legacy segmentine
// (kv() tanimindan SONRAKI kisma) daraltilir.
describe('test-dapp -- review fix turu 1: K5 genellemesi (T5)', () => {
    it('WS+legacy segmentinde esc siz span birlestirmesi yok', () => {
        const marker = '// --- Wallet Standard kesfi (SS3.1)'
        const idx = HTML.indexOf(marker)
        expect(idx).toBeGreaterThan(-1)
        const seg = HTML.slice(idx)
        expect(seg).not.toMatch(/<span>' \+ (?!esc\()/)
    })

    // NOT: controller'in onerdigi ham hali (`/innerHTML = \[[\s\S]*?\+ (p|window\.solana|
    // yeniden|res|sonuc)\.[\s\S]*?\]\.join/`) blok SINIRLARINI asarak eslesiyor --
    // ilk `innerHTML = [`den dosyanin cok ilerisindeki BASKA bir dizinin `].join`
    // ine kadar "her seyi" yutuyor. Dengelenmis parantezle TEK bir diziye
    // daraltilmis hali BILE zaten guvenli, incelenmis koda (satir 873:
    // `'evet ' + p.publicKey.length + ' bayt'` (ortadaki ayrac karakteri
    // atlandi), kv() DEGERI icinde -- esc()
    // ile sarili) yanlis pozitif veriyor. Gercek tehlike yalnizca HTML
    // ETIKETI metnine (<span>/<div>) HAM ekleme -- bu zaten yukaridaki iki
    // pinle (<span>' + p./window.solana., <span>' + yeniden) kapsaniyor;
    // burada <div>' + varyanti da dogrulanir.
    it('<div>ETIKETINE de p./window.solana./yeniden ham eklenmez', () => {
        expect(HTML).not.toMatch(/<div[^>]*>' \+ (p|window\.solana|yeniden|res|sonuc)\b/)
    })
})

// Gorev 52 -- test-dapp/README.md kaynak kilidi. README CI'da calismaz, bir
// insan tiklar; bu dosya, elle dogrulama listesinin gercekten cagirdigi
// yuzeyi (sekme adlari, kabul olcutleri, yukleyici kontrolu) metin olarak
// kilitler. CRLF normalizasyonu HTML sabitiyle ayni gerekceyle (Gorev 50 G2):
// core.autocrlf=true altinda taze bir checkout CRLF uretebilir, normalize
// edilmeden pinler satir-sonu bagimliligindan sahte kirmizi verir.
const README = readFileSync(new URL('../../test-dapp/README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('test-dapp/README -- elle dogrulama listesi', () => {
    it('iki Solana sekmesini de tarif eder', () => {
        expect(README).toContain('Wallet Standard')
        expect(README).toContain('window.solana')
    })

    // SS4.1'in TEK gercek testi budur ve yalnizca gercek tarayicida gorunur:
    // solanaInjected.js bir sey IMPORT ederse @crxjs onu asenkron bir
    // YUKLEYICIYE sarar, `window.solana` document_start'ta senkron var olmaz
    // ve K1'in tum amaci gider. vitest bu kusuru GORMEZ.
    it('dist/manifest.json yukleyici kontrolunu ADIM ADIM yazar', () => {
        expect(README).toContain('dist/manifest.json')
        expect(README).toContain('solanaInjected.js-loader')
        expect(README).toContain('document_start')
    })

    it('donen nesnenin === girdiyle ayni olmasi kabul olcutu olarak yazilidir', () => {
        expect(README).toContain('sonuc === tx')
    })

    it('isPhantom in ASLA yazilmadigini kabul olcutu olarak yazar', () => {
        expect(README).toContain('isPhantom')
    })
})

describe('test-dapp/README -- kaynak-kilidi guclendirme (K6)', () => {
    it('eski TON-yalnizca basligi KAYBOLDU', () => {
        expect(README).not.toMatch(/^# Wats TON Dapp Test/)
    })

    // K5: yukleyici kontrolunun dorduncu manifest girdisi all_frames: false
    // ile iframe reddini de dogrulamali; kontrol taze bir `npm run build`
    // kosup manifesti okumayi gerektirir, eski bir dist/ yeterli degildir.
    it('manifest kontrolu all_frames ve npm run build i anar', () => {
        expect(README).toContain('all_frames')
        expect(README).toContain('npm run build')
    })

    // K1 fix turu 1 / F1 (controller hatasi): sahte blockhash satiri
    // GERCEKTEN dapp'e ulasan mesaji anlatmali -- arka planin 'User closed
    // the window.' metni solanaInjected.js'te normalize edilir, dapp
    // 'User rejected the request.' gorur.
    it('sahte blockhash satiri gercek akisi anlatir (F1)', () => {
        expect(README).toContain("'User rejected the request.'")
    })

    // K2: yuva baska bir cuzdana devredilmis olabilir -- bu hata degildir,
    // sayfa wats seridi uzerinden test etmeye devam eder.
    it('devredilmis yuva satiri window.wats.solana.legacy ve legacySlot i anar (K2)', () => {
        expect(README).toContain('window.wats.solana.legacy')
        expect(README).toContain('legacySlot')
    })
})

describe('test-dapp/README -- fix turu 1 ek pinleri (F2, F9)', () => {
    // Gorev 58: Ayarlar -> Dapp'ler -> Solana bolumu Gorev 54 ile GELDI --
    // README'deki "henuz yok / Gorev 54 gerektirir" notlari artik ESKI ve
    // kaldirildi. Bu pin artik boslugun KAPANDIGINI dogrular: README'de
    // "Gorev 54" gecen hicbir satir kalmamali. Test dosyasi ASCII kalir,
    // README UTF-8 -- 'Gorev' kelimesindeki Turkce harf (o-umlaut) tek-karakter
    // joker ile eslenir.
    it('Gorev 54 notu ARTIK YOK (bolum Task 54 ile geldi)', () => {
        expect(README).not.toMatch(/G.rev 54/)
    })

    // Task 58 fix turu 1 (D9): yukaridaki test yalnizca ESKI notun GITTIGINI
    // dogrular -- bu, DUZ beklenti metninin ("Ayarlar -> Dapp'ler ->
    // Solana Baglantilari" gibi kosulsuz satirlar) hala VAR oldugunu
    // pinlemez. Bolum basligindaki Turkce harfler (g-breve, noktali i) tek-
    // karakter joker ile eslenir, test dosyasi ASCII kalir.
    it('Solana Baglantilari bolum adi kosulsuz beklenti olarak gecer', () => {
        expect(README).toMatch(/Solana Ba.lant.lar./)
    })

    // F9: 'iki Solana sekmesini de tarif eder' pini yalnizca giris
    // paragrafiyla doyuyordu (kelimeler orada da gecer) -- iki sekme
    // basligi ayrica pinlenir. Basliktaki orta-nokta karakteri tek-karakter
    // joker ile eslenir (test dosyasi ASCII kalir).
    it('iki Solana sekmesinin basligi da ayrica var', () => {
        expect(README).toMatch(/^## Solana . Wallet Standard sekmesi$/m)
        expect(README).toMatch(/^## Solana . legacy `window\.solana` sekmesi$/m)
    })
})
