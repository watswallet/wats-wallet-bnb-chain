import { describe, it, expect } from 'vitest'
import { validateSiwsInput, buildSiwsMessage } from './siwsMessage'

// derive.test.js'in regresyon kilidindeki adres -- gercek bir base58 anahtar.
const ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'

describe('validateSiwsInput -- domain ezme (K9)', () => {
    // BU TESTIN KAPATTIGI SALDIRI: evil.com, girdiye domain:'phantom.app'
    // yazarak kullaniciya "phantom.app'e giris yapiyorsunuz" diyen bir metin
    // imzalatabilirdi; imza gercekten gecerlidir ve phantom.app'in backend'i
    // onu kabul ederdi. Alan REDDEDILMEZ (reddetmek dikkatsiz dapp'leri
    // kirardi), gercek origin'in host'uyla YENIDEN YAZILIR.
    it("iddia edilen domain kabul edilmez, gercek origin'in host'uyla EZILIR", () => {
        const r = validateSiwsInput(
            { domain: 'phantom.app', nonce: 'abc123' },
            { origin: 'https://evil.com', address: ADDRESS }
        )

        expect(r.ok).toBe(true)
        expect(r.input.domain).toBe('evil.com')
        expect(r.input.domain).not.toBe('phantom.app')
        // Ezme SESSIZ olmali: bu bir hata degil, politika.
        expect(r.code).toBeUndefined()
    })

    it('domain hic gelmezse gercek origin host ile DOLDURULUR', () => {
        const r = validateSiwsInput({}, { origin: 'https://app.example.com', address: ADDRESS })
        expect(r).toEqual({ ok: true, input: { domain: 'app.example.com', address: ADDRESS } })
    })

    // K5: yetki kaynagi TAM ORIGIN'dir; port host'un parcasidir ve
    // dusurulurse app.example.com:8443 ile app.example.com ayni domain
    // metnini imzalatir.
    it('port host ile birlikte korunur', () => {
        const r = validateSiwsInput({}, { origin: 'https://app.example.com:8443', address: ADDRESS })
        expect(r.input.domain).toBe('app.example.com:8443')
    })

    // Origin cozulemiyorsa domain'i ZORLAYAMAYIZ. Sayfanin verdigi domain'i
    // oldugu gibi imzalamak, yukaridaki saldiriyi geri acardi.
    it('cozulemeyen origin -> SOLANA_SIGNIN_DOMAIN_MISMATCH', () => {
        for (const origin of ['', null, undefined, 'bozuk-origin', 'about:blank']) {
            expect(validateSiwsInput({ domain: 'phantom.app' }, { origin, address: ADDRESS }))
                .toEqual({ ok: false, code: 'SOLANA_SIGNIN_DOMAIN_MISMATCH' })
        }
    })
})

describe('validateSiwsInput -- adres kapisi', () => {
    it('oturum adresiyle uyusmayan address REDDEDILIR', () => {
        expect(validateSiwsInput(
            { address: '11111111111111111111111111111111' },
            { origin: 'https://app.example.com', address: ADDRESS }
        )).toEqual({ ok: false, code: 'SOLANA_SIGNIN_ADDRESS_MISMATCH' })
    })

    // K8: base58 HARF KASASI ANLAMLIDIR. Repodaki her EVM aliskanligi adresi
    // toLowerCase yapiyor; burada bir tek toLowerCase, BASKA bir anahtarin
    // adresini gecerli sayardi.
    it('yalnizca harf kasasi farkli bir adres AYNI sayilmaz', () => {
        expect(validateSiwsInput(
            { address: ADDRESS.toLowerCase() },
            { origin: 'https://app.example.com', address: ADDRESS }
        )).toEqual({ ok: false, code: 'SOLANA_SIGNIN_ADDRESS_MISMATCH' })
    })

    it('address hic gelmezse oturum adresiyle DOLDURULUR', () => {
        const r = validateSiwsInput({ nonce: 'n1' }, { origin: 'https://app.example.com', address: ADDRESS })
        expect(r.ok).toBe(true)
        expect(r.input.address).toBe(ADDRESS)
    })

    it('address dizge degilse (nesne/sayi) reddedilir', () => {
        expect(validateSiwsInput(
            { address: { toString: () => ADDRESS } },
            { origin: 'https://app.example.com', address: ADDRESS }
        )).toEqual({ ok: false, code: 'SOLANA_SIGNIN_ADDRESS_MISMATCH' })
    })

    it('oturum adresi yoksa reddedilir', () => {
        expect(validateSiwsInput({}, { origin: 'https://app.example.com', address: '' }))
            .toEqual({ ok: false, code: 'SOLANA_SIGNIN_ADDRESS_MISMATCH' })
    })
})

describe('validateSiwsInput -- normalizasyon', () => {
    it('tanimadigimiz alanlar DUSURULUR', () => {
        const r = validateSiwsInput(
            { nonce: 'n1', isPhantom: true, __proto__hack: 'x', autoApprove: true },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r.input).toEqual({ nonce: 'n1', domain: 'app.example.com', address: ADDRESS })
    })

    it('cagiranin nesnesini DEGISTIRMEZ, yeni nesne dondurur', () => {
        const original = { domain: 'phantom.app', nonce: 'n1' }
        const r = validateSiwsInput(original, { origin: 'https://evil.com', address: ADDRESS })
        expect(original.domain).toBe('phantom.app')
        expect(r.input).not.toBe(original)
    })

    it('resources dizisindeki dizge olmayanlar elenir, dizi degilse alan dusurulur', () => {
        const ok = validateSiwsInput(
            { resources: ['https://example.com/tos', 42, null] },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(ok.input.resources).toEqual(['https://example.com/tos'])

        const bad = validateSiwsInput(
            { resources: 'https://example.com/tos' },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(bad.input.resources).toBeUndefined()
    })

    it('girdi null/tanimsiz olsa bile iki zorunlu alan yazilir', () => {
        expect(validateSiwsInput(null, { origin: 'https://app.example.com', address: ADDRESS }))
            .toEqual({ ok: true, input: { domain: 'app.example.com', address: ADDRESS } })
    })
})

describe('validateSiwsInput -- erken boyut kapisi (govde KURULMADAN once)', () => {
    // KOK NEDEN: gate 2 (oturum sarti) signIn'e UYGULANMIYOR (K9 disi tasarim
    // karari), yani BURAYA herhangi bir origin -- baglantisi bile olmayan biri
    // -- erisebilir. buildSiwsMessage + TextEncoder zincirini govde kurulmadan
    // ONCE calistirmak, paylasilan arka plan servis calisanini (TUM zincirlerin
    // imzalama yolu) sayfa kontrolundeki keyfi uzunluktaki statement/resources
    // alanlariyla bellek tuketimine acardi -- MAX_MESSAGE_BYTES (8192) burada,
    // hicbir dize BIRLESTIRILMEDEN, ZATEN uygulanir.
    it('devasa statement, govde kurulmadan SOLANA_MESSAGE_TOO_LARGE ile reddedilir', () => {
        const r = validateSiwsInput(
            { statement: 'a'.repeat(50_000) },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r).toEqual({ ok: false, code: 'SOLANA_MESSAGE_TOO_LARGE' })
    })

    // TEK BASINA KUCUK, TOPLAMDA DEVASA: her giris ayri ayri hicbir sinira
    // takilmaz (parseDappTransaction'daki 8192 kontrolu tek bir dizeye
    // bakar) -- toplam boyut kontrol edilmezse bu yol acik kalirdi.
    it('tek tek kucuk ama toplamda devasa resources reddedilir', () => {
        const resources = Array.from({ length: 2000 }, (_, i) => `https://example.com/kaynak/${i}`)
        const r = validateSiwsInput(
            { resources },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r).toEqual({ ok: false, code: 'SOLANA_MESSAGE_TOO_LARGE' })
    })

    it('sinir altindaki normal girdi ETKILENMEZ (regresyon)', () => {
        const r = validateSiwsInput(
            { statement: 'Sign in to Example.', nonce: 'n1' },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r.ok).toBe(true)
    })

    // F3 (nihai inceleme fix turu 1): eski `rawFieldsLength` yalniz
    // `kaynak.length`i topluyordu -- BOS (ya da cok kisa) dizgelerden olusan
    // COK SAYIDA eleman ucuz sayilirdi. buildSiwsMessage her elemani `- \n`
    // (3 karakter EN AZ) uretecek sekilde birlestirdigi icin
    // Array(1_000_000).fill('') erken kapiyi GECIP govdeyi ~3 MB'a
    // cikarabiliyordu (8192 baytlik NIHAI kapi bunu SONRADAN yakalar, ama
    // paylasilan servis calisani o ana kadar megabaytlik bir dizeyi
    // kurmus/birlestirmis olurdu).
    it('COK SAYIDA bos resources (dizge basina 0 uzunluk) erken kapiyla reddedilir', () => {
        const resources = Array.from({ length: 1_000_000 }, () => '')
        const r = validateSiwsInput(
            { resources },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r).toEqual({ ok: false, code: 'SOLANA_MESSAGE_TOO_LARGE' })
    })
})

describe('validateSiwsInput -- tip karisikligi (dizge OLMAYAN alan degerleri)', () => {
    // KOK NEDEN (2. tur bulgu): rawFieldsLength yalnizca DIZGELERI olcer.
    // Bir DIZI ya da NESNE, uzunluk toplamina 0 katkiyla sessizce GECERDI --
    // sonra normalize adimi degeri OLDUGU GIBI kopyalar ve buildSiwsMessage
    // sablon enterpolasyonuyla (`${i.statement}`) toString()'i TETIKLER. Bir
    // dizi icin bu virgullu birlestirmedir (Array.prototype.toString):
    // Array(5_000_000).fill('a') gibi bir girdi, govde KURULDUKTAN SONRA
    // megabaytlarca bir metne donusur -- erken kapinin onlemesi gereken TAM
    // OLARAK bu durum, sadece uzun bir dizge yerine yanlis TIPTEKI bir deger
    // uzerinden.
    it('devasa bir DIZI (dizge degil) statement TIP GUVENLIGI ile reddedilir', () => {
        const r = validateSiwsInput(
            { statement: Array.from({ length: 5000 }, () => 'a') },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r).toEqual({ ok: false, code: 'SOLANA_MESSAGE_TOO_LARGE' })
    })

    // GENELLIK KANITI: kural yalnizca statement'a OZEL degil, dokuzlu
    // METIN alaninin TAMAMINA uygulanir. KUCUK bir dizi bile reddedilir --
    // kural BOYUTA degil TIPE dayanir, kucuk oldugu icin GECMEZ.
    it('dokuzlu listedeki BASKA bir alan (nonce) icin de dizge disi deger reddedilir', () => {
        const r = validateSiwsInput(
            { nonce: ['x', 'y'] },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r).toEqual({ ok: false, code: 'SOLANA_MESSAGE_TOO_LARGE' })
    })

    // NESNE, DIZININ AKSINE, varsayilan toString()'de sabit kisa bir dize
    // uretir ("[object Object]") -- yani bu DoS'un KENDISI degil, ama YINE DE
    // TIP GUVENLIGI ihlalidir: kullanici sayfanin hic yazmadigi bu sabit
    // dizeyi imzalamis olurdu. Kural TIPE bakar, DoS potansiyeline degil.
    it('DIZI OLMAYAN bir NESNE deger de reddedilir (toString farkli davranir)', () => {
        const r = validateSiwsInput(
            { uri: { zararli: 'x'.repeat(100) } },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r).toEqual({ ok: false, code: 'SOLANA_MESSAGE_TOO_LARGE' })
    })

    // BASKA ROTA YOK: resources zaten dizi+dizge filtresinden geciyor.
    // Dizinin ICINDEKI bir nesne toplam uzunluga KATILMADAN silinir; kalan
    // gecerli dizgeler ETKILENMEZ.
    it('resources icindeki dizge olmayan (nesne) girdi baska bir rotadan SIZMAZ', () => {
        const r = validateSiwsInput(
            { resources: ['https://example.com/tos', { buyuk: 'x'.repeat(50_000) }] },
            { origin: 'https://app.example.com', address: ADDRESS }
        )
        expect(r.ok).toBe(true)
        expect(r.input.resources).toEqual(['https://example.com/tos'])
    })
})

describe('buildSiwsMessage -- EIP-4361 govdesi', () => {
    it('tum alanlarla tam govdeyi uretir', () => {
        const message = buildSiwsMessage({
            domain: 'app.example.com',
            address: ADDRESS,
            statement: 'Sign in to Example.',
            uri: 'https://app.example.com/login',
            version: '1',
            chainId: 'mainnet',
            nonce: 'abc123',
            issuedAt: '2026-09-01T00:00:00.000Z',
            expirationTime: '2026-09-01T00:10:00.000Z',
            notBefore: '2026-09-01T00:00:00.000Z',
            requestId: 'req-7',
            resources: ['https://example.com/tos', 'https://example.com/privacy'],
        })

        expect(message).toBe(
            'app.example.com wants you to sign in with your Solana account:\n' +
            `${ADDRESS}\n` +
            '\n' +
            'Sign in to Example.\n' +
            '\n' +
            'URI: https://app.example.com/login\n' +
            'Version: 1\n' +
            'Chain ID: mainnet\n' +
            'Nonce: abc123\n' +
            'Issued At: 2026-09-01T00:00:00.000Z\n' +
            'Expiration Time: 2026-09-01T00:10:00.000Z\n' +
            'Not Before: 2026-09-01T00:00:00.000Z\n' +
            'Request ID: req-7\n' +
            'Resources:\n' +
            '- https://example.com/tos\n' +
            '- https://example.com/privacy'
        )
    })

    // Eksik alanlar SATIR OLARAK CIKMAZ: "Nonce: undefined" yazan bir govde
    // dapp'in backend'inde dogrulanamaz.
    it('yalnizca domain + address ile iki satirlik govde uretir', () => {
        expect(buildSiwsMessage({ domain: 'app.example.com', address: ADDRESS })).toBe(
            `app.example.com wants you to sign in with your Solana account:\n${ADDRESS}`
        )
    })

    it('statement varsa bos satirla ayrilir, alan listesi yoksa sonda bosluk kalmaz', () => {
        expect(buildSiwsMessage({ domain: 'd.example', address: ADDRESS, statement: 'Merhaba.' })).toBe(
            `d.example wants you to sign in with your Solana account:\n${ADDRESS}\n\nMerhaba.`
        )
    })

    it('bos resources dizisi yalnizca basligi yazar (referans uygulamayla ayni)', () => {
        expect(buildSiwsMessage({ domain: 'd.example', address: ADDRESS, resources: [] }))
            .toBe(`d.example wants you to sign in with your Solana account:\n${ADDRESS}\n\nResources:`)
    })

    it('validateSiwsInput ciktisi dogrudan beslenebilir ve ezilen domain govdeye yansir', () => {
        const r = validateSiwsInput(
            { domain: 'phantom.app', statement: 'Sign in.', nonce: 'n1' },
            { origin: 'https://evil.com', address: ADDRESS }
        )
        const message = buildSiwsMessage(r.input)

        expect(message.startsWith('evil.com wants you to sign in with your Solana account:')).toBe(true)
        expect(message).not.toContain('phantom.app')
        expect(message).toContain('Nonce: n1')
    })
})
