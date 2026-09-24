import { describe, it, expect } from 'vitest'
import { Address, Cell, beginCell, comment as yorumHucresi, internal, loadOutList, storeMessageRelaxed } from '@ton/core'
import { parseTonPayload, verifyTonQuote, TonQuoteVerifyError } from './tonQuoteVerify'
import GOLDEN from './__fixtures__/tonQuote.golden.json'
import JETTON from './__fixtures__/tonQuoteJetton.golden.json'

// Olculen govdenin hedefi cuzdanin KENDISI (kendine gonderim quote'u).
const SELF = 'EQD4joKxbphnt0bFfsaCb-KyJaydnMiLTTltGfrQB0mjzgJ2'
// AYNI adresin bounce-etmeyen yazimi. Ayni cuzdan, farkli metin.
const SELF_UQ = 'UQD4joKxbphnt0bFfsaCb-KyJaydnMiLTTltGfrQB0mjzl-z'
// BASKA bir cuzdan - saldirganin parayi yonlendirmek istedigi yer. Saglama
// toplami GECERLI olmali: cozulemeyen bir adres kullanilsaydi V5/V7 "adres
// farkli" diye degil "adres okunamadi" diye gecer, kontrol sinanmamis olurdu.
const OTHER = 'EQAREREREREREREREREREREREREREREREREREREREREREeYT'

const W5_WALLET_ID = 2147483409
const AMOUNT = 1000000n

// Kullanicinin GERCEKTEN istedigi sey. Dogrulama kapisi govdeyi buna karsi olcer.
const intent = (over = {}) => ({
    tonWallet: GOLDEN.sign.feeAuth.tonWallet,
    tonPublicKey: GOLDEN.sign.feeAuth.tonPublicKey,
    seqno: GOLDEN.sign.feeAuth.seqno,
    approvedAtsFee: BigInt(GOLDEN.atsFee),
    now: GOLDEN.validUntil - 60,
    actions: [{ to: SELF, amountNano: AMOUNT }],
    ...over,
})

// ALTIN VEKTOR BIR TRANSKRIPSIYONDUR. Bozma vakalari fixture'i DEGISTIRMEZ;
// derin bir kopya uzerinde calisir. Fixture'a dokunmak, sonraki her testi
// uydurma bir zeminde yesil yapardi.
const boz = (mutate) => {
    const q = JSON.parse(JSON.stringify(GOLDEN))
    mutate(q)
    return q
}

// Ele gecirilmis bir backend TEK bir alani degil, birbirine bagli TUM alanlari
// tutarli birakacak sekilde degistirir. Govdeyi degistiren vakalar bu yuzden
// hash'leri de yeniden hesaplar; yoksa V1'e takilir ve sinanmak istenen
// kontrol hic calismaz.
const govdeyiDegistir = (q, cell) => {
    q.payloadBoc = cell.toBoc().toString('base64')
    const h = '0x' + cell.hash().toString('hex')
    q.sign.tonPayloadHash = h
    q.sign.feeAuth.actionHash = h
    return q
}

// W5 imzali internal govdesi kurar. Varsayilanlar altin vektorun olculen degerleri.
const govdeKur = ({
    op = 0x73696e74,
    validUntil = GOLDEN.validUntil,
    seqno = GOLDEN.sign.feeAuth.seqno,
    hasOtherActions = 0,
    actions = [{ tag: 0x0ec3c86d, to: SELF, value: AMOUNT, mode: 3 }],
} = {}) => {
    // KANONIK KURULUM: her yeni eylem bir ONCEKININ disina sarilir, yani dizinin
    // SON elemani en DISTAKI hucre olur - @ton/core'un storeOutList'i ile ayni.
    // Burada bir `reverse()` olsaydi parser'daki ters sira hatasini TAM OLARAK
    // telafi eder ve testler yesil kalirken hata gorunmez olurdu.
    let list = beginCell().endCell() // bos hucre = liste sonu
    for (const a of actions) {
        const msg = internal({ to: a.to, value: a.value, bounce: a.bounce ?? false, init: a.init, body: a.body ?? beginCell().endCell() })
        list = beginCell()
            .storeUint(a.tag, 32)
            .storeUint(a.mode ?? 3, 8)
            .storeRef(list)
            .storeRef(beginCell().store(storeMessageRelaxed(msg)).endCell())
            .endCell()
    }
    return beginCell()
        .storeUint(op, 32)
        .storeUint(W5_WALLET_ID, 32)
        .storeUint(validUntil, 32)
        .storeUint(seqno, 32)
        .storeBit(actions.length > 0 ? 1 : 0)
        .storeBit(hasOtherActions)
        .storeRef(list)
        .endCell()
}

// Firlatilan kodu doner. Hic firlatmazsa null - "bozuk quote SESSIZCE gecti"
// durumu testte acikca gorunur.
const kod = (fn) => {
    try { fn(); return null } catch (e) { return e.code ?? e.message }
}

describe('parseTonPayload - sunucunun kurdugu govde ACILABILIR', () => {
    // Acilamazsa kullanici NEYI imzaladigini goremez ve V5 hic yazilamaz.
    it('basligi cozer', () => {
        const p = parseTonPayload(GOLDEN.payloadBoc)
        expect(p.op).toBe(0x73696e74)
        expect(p.validUntil).toBe(GOLDEN.validUntil)
        expect(p.seqno).toBe(GOLDEN.sign.feeAuth.seqno)
    })

    // ISIN KALBI: mesajin hedefi ve tutari okunabilmeli.
    it('cikan mesajlarin hedefini ve tutarini cozer', () => {
        const p = parseTonPayload(GOLDEN.payloadBoc)
        expect(p.messages).toHaveLength(1)
        expect(p.messages[0].to).toBe(SELF)
        expect(typeof p.messages[0].valueNano).toBe('bigint')
        expect(p.messages[0].valueNano).toBe(AMOUNT)
    })

    // TANIMADIGIMIZ EYLEM = DUR. Atlanan bir eylem, kullanicinin imzasiyla
    // birlikte dogrulanmadan yayina cikardi.
    it('bilinmeyen eylem etiketinde FIRLATIR', () => {
        const boc = govdeKur({ actions: [{ tag: 0xdeadbeef, to: SELF, value: AMOUNT }] })
            .toBoc().toString('base64')
        expect(kod(() => parseTonPayload(boc))).toBe('TON_PAYLOAD_UNKNOWN_ACTION')
    })

    // has_other_actions W5'in "genisletilmis eylem" bolumu: eklenti ekleme,
    // imza dogrulamasini kapatma. Cozmedigimiz bir bolumu gormezden gelemeyiz.
    it('has_other_actions kuruluysa FIRLATIR', () => {
        const boc = govdeKur({ hasOtherActions: 1 }).toBoc().toString('base64')
        expect(kod(() => parseTonPayload(boc))).toBe('TON_PAYLOAD_UNKNOWN_ACTION')
    })

    // SIRA HATASI BURADA YAKALANIR. Hakem bizim builder'imiz degil, @ton/core'un
    // KENDI loadOutList'i: o da ayni dolasimi yapip sonunda reverse() cagirir.
    // parseTonPayload'da o reverse() yokken bu test [OTHER, SELF] dondurup
    // duserdi - altin vektorun tek mesaji bu hatayi asla gosteremezdi.
    it('iki eylemli listede sira KANONIK loadOutList ile AYNI', () => {
        const cell = govdeKur({
            actions: [
                { tag: 0x0ec3c86d, to: SELF, value: 1n },
                { tag: 0x0ec3c86d, to: OTHER, value: 2n },
            ],
        })
        const kanonik = loadOutList(cell.beginParse().skip(130).loadRef().beginParse())
        expect(kanonik.map(a => a.outMsg.info.dest.toString())).toEqual([SELF, OTHER])

        const p = parseTonPayload(cell.toBoc().toString('base64'))
        expect(p.messages.map(m => m.to)).toEqual([SELF, OTHER])
        expect(p.messages.map(m => m.valueNano)).toEqual([1n, 2n])
    })

    // KAPI YALNIZ *TANINAN* JETTON TRANSFERINE ACILDI. Baska her op hala duser:
    // "govde var ama ne yaptigini bilmiyoruz" ile "govdeyi actik ve niyetle
    // karsilastirdik" ayni sey degil.
    it('TANINMAYAN op tasiyan govde FIRLATIR', () => {
        const boc = govdeKur({
            actions: [{
                tag: 0x0ec3c86d, to: SELF, value: AMOUNT,
                body: beginCell().storeUint(0xdeadbeef, 32).storeUint(0, 64).endCell(),
            }],
        }).toBoc().toString('base64')
        expect(kod(() => parseTonPayload(boc))).toBe('TON_PAYLOAD_BODY_UNVERIFIED')
    })

    // Hangi op'a takildigimiz mesajda gorunmeli: bilinmeyen bir govdeyle
    // karsilasildiginda tek teshis ipucu bu.
    it('dogrulanmamis govdenin op u hata mesajinda gecer', () => {
        const boc = govdeKur({
            actions: [{
                tag: 0x0ec3c86d, to: SELF, value: AMOUNT,
                body: beginCell().storeUint(0xdeadbeef, 32).endCell(),
            }],
        }).toBoc().toString('base64')
        let err
        try { parseTonPayload(boc) } catch (e) { err = e }
        expect(err.code).toBe('TON_PAYLOAD_BODY_UNVERIFIED')
        expect(err.message).toContain('0xdeadbeef')
    })

    // init (StateInit) hedefe kontrat dagitir. V5 `dest` ve `value`yi kilitledigi
    // icin tek basina parayi baska yere gonderemez; yine de "okunup yok sayilan
    // alan" sinifindan ve ayristiricinin kurali geregi GECMEZ.
    it('init (StateInit) tasiyan mesaj FIRLATIR', () => {
        const code = beginCell().storeUint(0xdead, 16).endCell()
        const boc = govdeKur({
            actions: [{
                tag: 0x0ec3c86d, to: SELF, value: AMOUNT,
                init: { code, data: beginCell().endCell() },
            }],
        }).toBoc().toString('base64')
        let err
        try { parseTonPayload(boc) } catch (e) { err = e }
        expect(err.code).toBe('TON_PAYLOAD_INIT_UNVERIFIED')
        expect(err.message).toContain('0x' + code.hash().toString('hex'))
    })

    // Altin vektor duz TON transferi: govdesi BOS, gecmeli. Gecmezse bosluk
    // olcumu yanlistir.
    it('altin vektorun govdesi BOS ve init i YOK - iki kapiya da TAKILMAZ', () => {
        expect(() => parseTonPayload(GOLDEN.payloadBoc)).not.toThrow()
    })

    it('acilamayan govdede FIRLATIR', () => {
        expect(kod(() => parseTonPayload('bu bir boc degil'))).toBe('TON_PAYLOAD_UNPARSEABLE')
    })

    // Kendi kurdugumuz govde, olculen govdeyle AYNI cikmali; cikmazsa asagidaki
    // bozma vakalari gercek sunucu ciktisini degil kendi hayalimizi sinar.
    it('kendi kurdugumuz varsayilan govde OLCULEN govdeyle birebir', () => {
        expect(govdeKur().toBoc().toString('base64')).toBe(GOLDEN.payloadBoc)
    })
})

describe('verifyTonQuote - saglam altin vektor', () => {
    it('GECER', () => {
        expect(() => verifyTonQuote(GOLDEN, intent())).not.toThrow()
    })

    // Ayni adresin iki yazimi. String karsilastirmasi burada YANLIS reddederdi
    // ve birileri bunu "adresi normalize edelim" diye yanlis yonde cozerdi.
    it('intent adresi UQ yaziminda olsa da GECER', () => {
        expect(() => verifyTonQuote(GOLDEN, intent({ actions: [{ to: SELF_UQ, amountNano: AMOUNT }] })))
            .not.toThrow()
    })

    it('intent tonWallet i UQ yaziminda olsa da GECER', () => {
        expect(() => verifyTonQuote(GOLDEN, intent({ tonWallet: SELF_UQ }))).not.toThrow()
    })

    it('amountNano string olarak verilse de GECER', () => {
        expect(() => verifyTonQuote(GOLDEN, intent({ actions: [{ to: SELF, amountNano: '1000000' }] })))
            .not.toThrow()
    })
})

describe('V1 - hash(payloadBoc) = tonPayloadHash = actionHash', () => {
    // Hash tutmuyorsa imzalanan sey gosterilen govde DEGILDIR.
    it('tonPayloadHash tek bit degisirse firlatir', () => {
        const q = boz(x => { x.sign.tonPayloadHash = '0xbd7e0f3a254ff14e90eeb7591e1bc9781214a57c74416b2b897ab8deb4539f7f' })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_HASH_MISMATCH')
    })

    // EIP-712'de imzalanan alan budur: bununla govde ayrisirsa ucret bir
    // eyleme, TON imzasi BASKA bir eyleme baglanir.
    it('feeAuth.actionHash degisirse firlatir', () => {
        const q = boz(x => { x.sign.feeAuth.actionHash = '0xbd7e0f3a254ff14e90eeb7591e1bc9781214a57c74416b2b897ab8deb4539f7f' })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_HASH_MISMATCH')
    })
})

describe('V2 - opcode internal auth', () => {
    // Hash'ler de tutarli: yalniz opcode degisti. V1 bunu YAKALAYAMAZ.
    it('external-auth govdesi firlatir', () => {
        const s = Cell.fromBase64(GOLDEN.payloadBoc).beginParse()
        s.loadUint(32)
        const external = beginCell().storeUint(0x7369676e, 32).storeSlice(s).endCell()
        const q = govdeyiDegistir(boz(() => {}), external)
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_AUTH_TYPE')
    })
})

describe('V3 - validUntil = quote.validUntil = feeAuth.deadline', () => {
    it('ust seviye validUntil govdeden ayrisirsa firlatir', () => {
        const q = boz(x => { x.validUntil = GOLDEN.validUntil + 1 })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_DEADLINE_MISMATCH')
    })

    it('feeAuth.deadline govdeden ayrisirsa firlatir', () => {
        const q = boz(x => { x.sign.feeAuth.deadline = GOLDEN.validUntil + 1 })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_DEADLINE_MISMATCH')
    })
})

describe('V4 - seqno govde = feeAuth = zincir', () => {
    // intent.seqno ZINCIRDEN okunan degerdir. Ayrisirsa govde baska bir
    // sirada yayinlanir; tekrar oynatma ya da olu imza uretir.
    it('zincirden okunan seqno govdedekinden farkliysa firlatir', () => {
        expect(kod(() => verifyTonQuote(GOLDEN, intent({ seqno: 2 })))).toBe('TON_QUOTE_SEQNO_MISMATCH')
    })

    it('feeAuth.seqno govdedekinden farkliysa firlatir', () => {
        const q = boz(x => { x.sign.feeAuth.seqno = 2 })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_SEQNO_MISMATCH')
    })
})

describe('V5 - govdedeki HER mesaj kullanicinin istedigiyle AYNI', () => {
    // BU UC VAKA PAZARLIK DISI. Digerleri tutarlilik olcer; V5 NIYET olcer ve
    // ele gecirilmis bir backend'in kullanicinin parasini baska adrese
    // gonderten govde imzalatmasini engelleyen TEK kontroldur.
    it('hedef baska adres ise firlatir', () => {
        expect(kod(() => verifyTonQuote(GOLDEN, intent({ actions: [{ to: OTHER, amountNano: AMOUNT }] }))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('tutar baska ise firlatir', () => {
        expect(kod(() => verifyTonQuote(GOLDEN, intent({ actions: [{ to: SELF, amountNano: AMOUNT + 1n }] }))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('intent 2 mesaj isterken govdede 1 varsa firlatir', () => {
        expect(kod(() => verifyTonQuote(GOLDEN, intent({
            actions: [{ to: SELF, amountNano: AMOUNT }, { to: OTHER, amountNano: AMOUNT }],
        })))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // EN SINSI VAKA: hedef ve tutar niyetle BIREBIR ayni, sadece gonderim modu
    // 128 (kalan bakiyenin tamamini tasi). Kullanici 0.001 TON gonderdigini
    // sanirken cuzdanin TAMAMI cikar. Yalniz to/valueNano bakan bir V5 bunu
    // goremezdi.
    it('sendMode 128 ise (hedef ve tutar dogru olsa bile) firlatir', () => {
        const cell = govdeKur({ actions: [{ tag: 0x0ec3c86d, to: SELF, value: AMOUNT, mode: 128 }] })
        const q = govdeyiDegistir(boz(() => {}), cell)
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // -----------------------------------------------------------------------
    // YORUM (memo) - DORT YON DE OLCULUR.
    //
    // Notlu gonderim eskiden relay yolunda YASAKTI ve yasagin gerekcesi
    // "sunucunun eylem sozlesmesinde yorum alani yok" idi. Varsayim olculdu ve
    // YANLIS cikti; kapi acildi. Kapiyi acmak TEK BASINA guvenli degil: not
    // niyetin parcasidir ve degistirilmesi/dusurulmesi somut KAYIP demektir
    // (memosuz giden bir borsa yatirimi kayip sayilir). Bu yuzden karsilastirma
    // IKI YONLU olmali ve metin COZULMEDEN, hucre hash'i uzerinden yapilmali.
    // -----------------------------------------------------------------------
    // MUHUR DE GUNCELLENIR (`muhurleDegistir`, yalniz `govdeyiDegistir` DEGIL):
    // V8 V5'ten SONRA calisir, yani muhru bayat birakan bir vaka "V5 hic bakmadi"
    // ile "V5 yakaladi"yi AYNI yesile/kirmiziya cevirir. Muhru tutarli birakinca
    // geriye tek savunma olarak V5 kalir - olcmek istedigimiz tam olarak o.
    const yorumluGovde = (metin) => govdeKur({
        actions: [{ tag: 0x0ec3c86d, to: SELF, value: AMOUNT, body: yorumHucresi(metin) }],
    })

    it('yorum niyetle AYNIYSA gecer', () => {
        const q = muhurleDegistir(boz(() => {}), yorumluGovde('memo-123'))
        expect(kod(() => verifyTonQuote(q, intent({
            actions: [{ kind: 'ton', to: SELF, amountNano: AMOUNT, comment: 'memo-123' }],
        })))).toBe(null)
    })

    it('sunucu notu DUSURDUYSE firlatir', () => {
        // Govde GOLDEN'in kendisi (yorumsuz), niyet ise notlu.
        expect(kod(() => verifyTonQuote(GOLDEN, intent({
            actions: [{ kind: 'ton', to: SELF, amountNano: AMOUNT, comment: 'memo-123' }],
        })))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('sunucu notu DEGISTIRDIYSE firlatir', () => {
        // Hedef ve tutar niyetle BIREBIR ayni; sapan tek sey not. Bir borsa
        // yatiriminda memoyu degistirmek, parayi baska bir hesaba yazdirmaktir.
        const q = muhurleDegistir(boz(() => {}), yorumluGovde('memo-999'))
        expect(kod(() => verifyTonQuote(q, intent({
            actions: [{ kind: 'ton', to: SELF, amountNano: AMOUNT, comment: 'memo-123' }],
        })))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('niyet NOTSUZKEN sunucunun not EKLEMESI firlatir', () => {
        // Ters yon. Kullanicinin yazmadigi bir not, onun adina soylenmis bir sozdur.
        const q = muhurleDegistir(boz(() => {}), yorumluGovde('kullanici bunu yazmadi'))
        expect(kod(() => verifyTonQuote(q, intent({
            actions: [{ kind: 'ton', to: SELF, amountNano: AMOUNT }],
        })))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('bos/bosluk niyet notu YORUMSUZ govdeyle eslesir', () => {
        // quoteAction bos notu ayikliyor; dogrulama da ayni normalizasyonu
        // uygulamali, yoksa gecerli bir gonderim reddedilirdi.
        expect(kod(() => verifyTonQuote(GOLDEN, intent({
            actions: [{ kind: 'ton', to: SELF, amountNano: AMOUNT, comment: '   ' }],
        })))).toBe(null)
    })

    // -----------------------------------------------------------------------
    // kind:'raw' - OPAK YUK. Dogrulama ANLAM degil OZDESLIK olcer.
    //
    // Dapp'ten gelen govdeyi cuzdan COZEMEZ ve cozmeyi denemez. Bu yuzden soru
    // "govde mantikli mi" degil, "govde kullanicinin ekranda gordugunun TA KENDISI
    // mi". Hash esitligi bunun icin anlamsal cozumlemeden GUCLUDUR: tek bit farki
    // yakalar. Kapinin bedeli de var - parseTonPayload'un "taninmayan govde duser"
    // kurali bu turde ASKIYA ALINIR - o yuzden izin NIYETTEN gelir, sunucudan degil.
    // -----------------------------------------------------------------------
    const YUK = beginCell().storeUint(0x12345678, 32).storeUint(42, 64).endCell()
    const YUK_B64 = YUK.toBoc().toString('base64')
    const GAZ = 50000000n

    const hamGovde = ({ body = YUK, value = AMOUNT + GAZ, bounce = true } = {}) => govdeKur({
        actions: [{ tag: 0x0ec3c86d, to: SELF, value, bounce, body }],
    })
    const hamNiyet = (over = {}) => intent({
        actions: [{ kind: 'raw', to: SELF, amountNano: AMOUNT, payloadBoc: YUK_B64, gasTonNano: GAZ, bounce: true, ...over }],
    })

    it('ham yuk niyetle AYNIYSA gecer', () => {
        const q = muhurleDegistir(boz(() => {}), hamGovde())
        expect(kod(() => verifyTonQuote(q, hamNiyet()))).toBe(null)
    })

    it('sunucu yuku DEGISTIRDIYSE firlatir', () => {
        // Hedef, tutar ve bounce niyetle BIREBIR ayni; sapan tek sey govdenin icerigi.
        const baska = beginCell().storeUint(0x12345678, 32).storeUint(43, 64).endCell()
        const q = muhurleDegistir(boz(() => {}), hamGovde({ body: baska }))
        expect(kod(() => verifyTonQuote(q, hamNiyet()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('giden deger amountNano + gasTonNano DEGILSE firlatir', () => {
        // Fazlasi kullanicinin KENDI bakiyesinden cikardi - urunun on kabulu ise
        // kullanicinin TON tutmadigidir.
        const q = muhurleDegistir(boz(() => {}), hamGovde({ value: AMOUNT + GAZ + 1n }))
        expect(kod(() => verifyTonQuote(q, hamNiyet()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('bounce niyetten SAPARSA firlatir', () => {
        // Kontrat cagrisinda bounce=false, cagri duserse TON'u hedefte KILITLI birakir.
        const q = muhurleDegistir(boz(() => {}), hamGovde({ bounce: false }))
        expect(kod(() => verifyTonQuote(q, hamNiyet()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // DAHA ERKEN KAPI: niyette `payloadBoc` YOKSA ham govde izni HIC acilmaz, yani
    // sunucunun ekledigi govde V5'e VARMADAN, parseTonPayload'da duser. Kod burada
    // testin ilk bekledigi koddan (INTENT_MISMATCH) daha KATI davraniyor - izin
    // eylem eylem, `payloadBoc`un varligindan turuyor.
    it('yuksuz raw: govdeye bir sey EKLENMISSE daha govde ACILIRKEN duser', () => {
        const q = muhurleDegistir(boz(() => {}), hamGovde({ value: AMOUNT, bounce: false }))
        expect(kod(() => verifyTonQuote(q, intent({
            actions: [{ kind: 'raw', to: SELF, amountNano: AMOUNT, bounce: false }],
        })))).toBe('TON_PAYLOAD_BODY_UNVERIFIED')
    })

    it('yuksuz raw: bos govde ve esit tutar GECER (0 TON dahil)', () => {
        // Dapp islemlerinin cok yaygin sekli. `kind:'ton'` sifiri reddeder, `raw` etmez.
        const cell = govdeKur({ actions: [{ tag: 0x0ec3c86d, to: SELF, value: 0n, bounce: false }] })
        const q = muhurleDegistir(boz(() => {}), cell)
        expect(kod(() => verifyTonQuote(q, intent({
            actions: [{ kind: 'raw', to: SELF, amountNano: 0n, bounce: false }],
        })))).toBe(null)
    })

    // KARISIK NIYET LISTESI - ham govde izni GLOBAL, dogrulama ise MESAJ BAZINDA.
    //
    // Bu testin var olma sebebi somut bir delikti: izin bayragi tum listeye
    // uygulandigi icin, listedeki bir `ton` eyleminin TANINMAYAN govdesi de
    // parseJettonBody'yi atliyordu. Ayri bir `commentHash` alani kullanildigi surece
    // o govde "yorum yok" gibi gorunuyor, beklenen de null oluyor ve DOGRULANMAMIS
    // bir govde geciyordu. Karsilastirma `bodyHash`e tasindi.
    it('raw ile ayni listedeki ton eyleminin TANINMAYAN govdesi gecmez', () => {
        const cell = govdeKur({
            actions: [
                { tag: 0x0ec3c86d, to: SELF, value: AMOUNT + GAZ, bounce: true, body: YUK },
                { tag: 0x0ec3c86d, to: OTHER, value: AMOUNT, bounce: false, body: YUK },
            ],
        })
        const q = muhurleDegistir(boz(() => {}), cell)
        expect(kod(() => verifyTonQuote(q, intent({
            actions: [
                { kind: 'raw', to: SELF, amountNano: AMOUNT, payloadBoc: YUK_B64, gasTonNano: GAZ, bounce: true },
                // Bu eylem YORUMSUZ bir duz TON gonderimi; govdesi BOS olmaliydi.
                { kind: 'ton', to: OTHER, amountNano: AMOUNT },
            ],
        })))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('niyette raw YOKKEN taninmayan govde HALA duser (izin sunucudan gelmez)', () => {
        const cell = hamGovde({ value: AMOUNT })
        const q = muhurleDegistir(boz(() => {}), cell)
        // Niyet duz TON: izin bayragi acilmaz, parseTonPayload eski katiligiyla duser.
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_PAYLOAD_BODY_UNVERIFIED')
    })

    it('TANINMAYAN op HALA duser (kapi genislemedi)', () => {
        // Yorum dali eklenirken "dolu govde" kontrolu op tabanina cevrildi.
        // Taninmayan bir op'un yorum sanilip GECMEDIGINI olcer.
        const cell = govdeKur({
            actions: [{ tag: 0x0ec3c86d, to: SELF, value: AMOUNT, body: beginCell().storeUint(0xdeadbeef, 32).endCell() }],
        })
        expect(kod(() => parseTonPayload(cell.toBoc().toString('base64')))).toBe('TON_PAYLOAD_BODY_UNVERIFIED')
    })

    // Cozulemeyen bir adres "esit degil" sayilir - kapali tarafa duser.
    it('intent adresi cozulemiyorsa firlatir', () => {
        expect(kod(() => verifyTonQuote(GOLDEN, intent({ actions: [{ to: 'adres degil', amountNano: AMOUNT }] }))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // Ters yon: sunucu kullanicinin istemedigi FAZLADAN bir mesaj ekledi.
    it('govdede 2 mesaj varken intent 1 istiyorsa firlatir', () => {
        const cell = govdeKur({
            actions: [
                { tag: 0x0ec3c86d, to: SELF, value: AMOUNT },
                { tag: 0x0ec3c86d, to: OTHER, value: AMOUNT },
            ],
        })
        const q = govdeyiDegistir(boz(() => {}), cell)
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })
})

describe('V6 - feeAuth.tonPublicKey bizim anahtarimiz', () => {
    it('baska anahtar ise firlatir', () => {
        const q = boz(x => { x.sign.feeAuth.tonPublicKey = '0x' + '11'.repeat(32) })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_PUBKEY_MISMATCH')
    })
})

describe('V7 - feeAuth.tonWallet bizim W5 adresimiz', () => {
    it('baska adres ise firlatir', () => {
        const q = boz(x => { x.sign.feeAuth.tonWallet = OTHER })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_WALLET_MISMATCH')
    })
})

describe('V8 - quoteId muhurlu govdesi ust seviyeyle TUTARLI', () => {
    it('ust seviye atsFee muhurdekinden farkliysa firlatir', () => {
        const q = boz(x => { x.atsFee = '1' })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_SEALED_MISMATCH')
    })

    it('ust seviye attachNanoton muhurdekinden farkliysa firlatir', () => {
        const q = boz(x => { x.attachNanoton = '1' })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_SEALED_MISMATCH')
    })

    // MUHRUN GUCU BURADA GORUNUR. Saldirgan govdeyi bastan kurdu, hash'leri
    // yeniden hesapladi ve intent'i de kendi adresine gore ayarladi - V1..V7
    // hepsi GECER. Muhur payloadBoc'un KENDISINI tasidigi icin kapiyi yalniz
    // TAM GOVDE karsilastirmasi kapatir.
    it('govde bastan kurulup hash ve intent uyumlu yapilsa bile muhur yakalar', () => {
        const cell = govdeKur({ actions: [{ tag: 0x0ec3c86d, to: OTHER, value: AMOUNT }] })
        const q = govdeyiDegistir(boz(() => {}), cell)
        const niyet = intent({ actions: [{ to: OTHER, amountNano: AMOUNT }] })
        expect(kod(() => verifyTonQuote(q, niyet))).toBe('TON_QUOTE_SEALED_MISMATCH')
    })

    it('quoteId cozulemezse firlatir', () => {
        const q = boz(x => { x.quoteId = 'cozulemez.imza' })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_SEALED_MISMATCH')
    })
})

describe('V9 - sign.domain istemcinin KENDI domaini', () => {
    it('chainId 1 ise firlatir', () => {
        const q = boz(x => { x.sign.domain.chainId = 1 })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_FEE_DOMAIN_MISMATCH')
    })

    it('verifyingContract baska ise firlatir', () => {
        const q = boz(x => { x.sign.domain.verifyingContract = '0x000000000000000000000000000000000000dEaD' })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_FEE_DOMAIN_MISMATCH')
    })
})

describe('V10 - atsMaxFee = atsFee ve onaylanani ASMAZ', () => {
    // Kullaniciya atsFee gosterilir, imzalanan atsMaxFee'dir. Ayrisirlarsa
    // gosterilen sayi ile tahsil edilebilecek sayi ayni degildir.
    it('atsMaxFee atsFee den farkliysa firlatir', () => {
        const q = boz(x => { x.sign.feeAuth.atsMaxFee = (BigInt(GOLDEN.atsFee) - 1n).toString() })
        expect(kod(() => verifyTonQuote(q, intent()))).toBe('TON_QUOTE_FEE_MISMATCH')
    })

    it('atsMaxFee kullanicinin onayladigini asiyorsa firlatir', () => {
        const niyet = intent({ approvedAtsFee: BigInt(GOLDEN.atsFee) - 1n })
        expect(kod(() => verifyTonQuote(GOLDEN, niyet))).toBe('TON_QUOTE_FEE_ABOVE_APPROVED')
    })
})

describe('V11 - teklifin suresi ne GECMIS ne de ASIRI UZUN', () => {
    // Pencere `deadline - now` ile olculuyor. Bozma vakalari quote'un
    // deadline'ini degil intent'in `now`unu oynatiyor: deadline tek basina
    // degistirilseydi govdedeki validUntil'den ayrisir ve V3 once duserdi,
    // yani sinanmak istenen kontrole hic gelinmezdi. Ikisi ayni sey - pencere
    // genisligi degisiyor.
    it('now deadline dan sonra ise firlatir', () => {
        const niyet = intent({ now: GOLDEN.sign.feeAuth.deadline + 1 })
        expect(kod(() => verifyTonQuote(GOLDEN, niyet))).toBe('TON_QUOTE_EXPIRED')
    })

    it('now tam deadline da ise GECER', () => {
        expect(() => verifyTonQuote(GOLDEN, intent({ now: GOLDEN.sign.feeAuth.deadline }))).not.toThrow()
    })

    // Suresi bir gun olan bir teklif: suresi GECMEMIS, yani V11'in alt siniri
    // bunu goremez. Yine de kullanicinin ATS'sini bir gun boyunca baglayan bir
    // odeme yetkisi imzalatirdi.
    it('pencere bir gun ise firlatir', () => {
        const niyet = intent({ now: GOLDEN.sign.feeAuth.deadline - 86400 })
        expect(kod(() => verifyTonQuote(GOLDEN, niyet))).toBe('TON_QUOTE_WINDOW_TOO_LONG')
    })

    // Ust sinirin COK DAR olmadigini kilitler: 179sn (120sn sunucu TTL'i + saat
    // kaymasi payi icinde) GECMELI. Bu test olmadan siniri 120'ye cekmek dogru
    // gorunur ve istemcinin saati birkac saniye ilerideyken gecerli teklifler
    // reddedilmeye baslar.
    it('pencere 179sn ise GECER', () => {
        const niyet = intent({ now: GOLDEN.sign.feeAuth.deadline - 179 })
        expect(() => verifyTonQuote(GOLDEN, niyet)).not.toThrow()
    })
})

describe('hata sekli', () => {
    it('TonQuoteVerifyError ve code tasir', () => {
        const q = boz(x => { x.sign.tonPayloadHash = '0x' + '00'.repeat(32) })
        let err
        try { verifyTonQuote(q, intent()) } catch (e) { err = e }
        expect(err).toBeInstanceOf(TonQuoteVerifyError)
        expect(err.code).toBe('TON_QUOTE_HASH_MISMATCH')
        expect(err.name).toBe('TonQuoteVerifyError')
    })
})

// ---------------------------------------------------------------------------
// JETTON - ic govde dogrulamasi
//
// Jetton transferinde DIS mesajin hedefi kullanicinin KENDI jetton cuzdani,
// degeri ise iliskilendirilen TON'dur. GERCEK alici ve GERCEK token tutari
// transfer#0f8a7ea5 govdesinin ICINDEDIR. Dis alanlara bakan bir V5 jetton
// yolunda YESIL yanar ve tokenlarin kime gittigi hakkinda HICBIR SEY dogrulamaz.
// Asagidaki degerler ikinci altin vektorun payloadBoc'undan COZULDU, uydurulmadi.
// ---------------------------------------------------------------------------
const J_WALLET = 'EQDWTpfN3Bw5DC_yENjpItwdG1d9BqhvsScTpxTquIF5XnCq' // DIS hedef: KENDI jetton cuzdanimiz
const J_TO = SELF          // IC alici (olculen quote kendine gonderim)
const J_AMOUNT = 1000n     // IC token tutari (ham birim)
const J_VALUE = 50000001n  // mesaja ILISKILENDIRILEN TON
const J_FORWARD = 1n       // forward_ton_amount

// TEP-74 transfer govdesi. Varsayilanlar olculen vektorun degerleridir; her
// bozma vakasi TEK bir alani oynatir.
const jettonGovde = ({
    amount = J_AMOUNT,
    destination = J_TO,
    responseDestination = SELF,
    customPayload = null,
    forwardTon = J_FORWARD,
    forwardPayload = null,
    artikBit = null,
} = {}) => {
    const b = beginCell()
        .storeUint(0x0f8a7ea5, 32)                      // transfer
        .storeUint(0, 64)                               // query_id
        .storeCoins(amount)                             // amount (VarUInteger 16)
        .storeAddress(Address.parse(destination))       // destination - GERCEK alici
        .storeAddress(Address.parse(responseDestination))
        .storeMaybeRef(customPayload)                   // custom_payload:(Maybe ^Cell)
        .storeCoins(forwardTon)                         // forward_ton_amount
        .storeMaybeRef(forwardPayload)                  // forward_payload:(Either Cell ^Cell)
    if (artikBit !== null) b.storeUint(artikBit, 8)
    return b.endCell()
}

// Olculen jetton vektorunun W5 govdesini kurar. DIS hedef/deger ve gonderim modu
// ayrica oynatilabilir: "dis dogru, ic yanlis" vakasinin kurulabilmesi icin sart.
const jettonYuk = ({ outerTo = J_WALLET, outerValue = J_VALUE, mode = 3, bounce = true, ...govde } = {}) =>
    govdeKur({
        validUntil: JETTON.validUntil,
        seqno: JETTON.sign.feeAuth.seqno,
        actions: [{ tag: 0x0ec3c86d, to: outerTo, value: outerValue, mode, bounce, body: jettonGovde(govde) }],
    })

const bozJ = (mutate = () => {}) => {
    const q = JSON.parse(JSON.stringify(JETTON))
    mutate(q)
    return q
}

// ELE GECIRILMIS BIR BACKEND'IN GERCEKCI HALI. Govdeyi degistiren bir sunucu
// quoteId'nin MUHURLU govdesini de KENDI kurar - HMAC istemcide DOGRULANAMAZ
// (anahtar sunucuda). Muhru guncellemeyen bir bozma vakasi V8'e takilir; V8 ise
// V5'ten SONRA calisir, yani "V5 hic bakmadi" ile "V5 yakaladi" ayni yesili
// uretir. Muhru de tutarli birakinca geriye TEK savunma olarak V5 kalir.
const muhurleDegistir = (q, cell) => {
    govdeyiDegistir(q, cell)
    const [govdeB64, hmac] = String(q.quoteId).split('.')
    const muhur = JSON.parse(Buffer.from(govdeB64, 'base64url').toString('utf8'))
    muhur.payloadBoc = q.payloadBoc
    muhur.actionHash = q.sign.feeAuth.actionHash
    q.quoteId = Buffer.from(JSON.stringify(muhur), 'utf8').toString('base64url') + '.' + hmac
    return q
}

// Jetton niyeti. `jettonWallet` SUNUCUYA GITMEZ - yalniz istemcinin "bu transfer
// benim HANGI jetton cuzdanimdan geciyor" dogrulamasinin girdisidir.
const jettonIntent = (over = {}) => ({
    tonWallet: JETTON.sign.feeAuth.tonWallet,
    tonPublicKey: JETTON.sign.feeAuth.tonPublicKey,
    seqno: JETTON.sign.feeAuth.seqno,
    approvedAtsFee: BigInt(JETTON.atsFee),
    now: JETTON.validUntil - 60,
    actions: [{ kind: 'jetton', to: J_TO, amount: J_AMOUNT, jettonWallet: J_WALLET }],
    ...over,
})

describe('parseTonPayload - jetton altin vektoru', () => {
    it('basligi cozer', () => {
        const p = parseTonPayload(JETTON.payloadBoc)
        expect(p.op).toBe(0x73696e74)
        expect(p.validUntil).toBe(JETTON.validUntil)
        expect(p.seqno).toBe(JETTON.sign.feeAuth.seqno)
    })

    // ISIN KALBI: dis alanlar ile ic alanlar FARKLI seyler soyluyor. Bu testin
    // kendisi kapinin var olma sebebini gosterir.
    it('DIS hedef kendi jetton cuzdanimiz, IC alici ise GERCEK alicidir', () => {
        const p = parseTonPayload(JETTON.payloadBoc)
        expect(p.messages).toHaveLength(1)
        expect(p.messages[0].to).toBe(J_WALLET)
        expect(p.messages[0].valueNano).toBe(J_VALUE)
        expect(p.messages[0].sendMode).toBe(3)
        expect(p.messages[0].jetton).toMatchObject({
            amount: J_AMOUNT,
            destination: J_TO,
            responseDestination: SELF,
            forwardTonAmount: J_FORWARD,
        })
    })

    // Duz TON mesajinda `jetton` alani NULL olmali: V5'in hangi karsilastirmayi
    // yapacagini bu ayrim belirler.
    it('duz TON mesajinda jetton alani null', () => {
        const p = parseTonPayload(GOLDEN.payloadBoc)
        expect(p.messages[0].jetton).toBeNull()
    })

    // custom_payload KENDI jetton cuzdanimiza giden, dogrulamadigimiz bir talimat.
    // HANGI ALANDA takildigimiz da iddiaya dahil: yalniz koda bakan bir test,
    // okunmadan birakilan ref'in "artik veri"ye takilmasiyla da YESIL kalirdi -
    // yani custom_payload kontrolu silinse bile fark edilmezdi.
    it('custom_payload tasiyan jetton govdesi FIRLATIR', () => {
        const boc = jettonYuk({ customPayload: beginCell().storeUint(1, 8).endCell() })
            .toBoc().toString('base64')
        let err
        try { parseTonPayload(boc) } catch (e) { err = e }
        expect(err.code).toBe('TON_PAYLOAD_BODY_UNVERIFIED')
        expect(err.message).toContain('custom_payload')
    })

    // FORWARD_PAYLOAD ARTIK COZULMEZ, HASH'LENIR (2026-09-15).
    //
    // Burasi eskiden FIRLIYORDU ve notlu JETTON gonderiminin rolede yasak
    // olmasinin GERCEK sebebi buydu: TEP-74'te not forward_payload'in ICINDE
    // tasinir (duz TON'da govdenin KENDISINDE - o dal 2026-09-14'te acilmisti).
    //
    // KAPI GEVSEMEDI, YER DEGISTIRDI. Icerik hala COZULMEZ (snake hucre zinciri,
    // cok baytli karakterler; kendi cozucumuz sunucununkiyle ayrisabilirdi);
    // yalnizca hash'i disari verilir ve V5 onu KENDI kurdugu yorum hucresinin
    // hash'iyle karsilastirir. Duz TON'daki `bodyHash` teknigiyle AYNI.
    it('forward_payload ref COZULMEZ, HASH olarak disari verilir', () => {
        const yuk = yorumHucresi('merhaba')
        const boc = jettonYuk({ forwardPayload: yuk }).toBoc().toString('base64')
        const p = parseTonPayload(boc)
        expect(p.messages[0].jetton.forwardPayloadHash).toBe(yuk.hash().toString('hex'))
    })

    // NULL DA BIR DEGERDIR: V5'te "niyet notsuz" ile karsilastirilan sey budur.
    // Alanin yoklugu ile bos olmasi ayni sey degil - undefined, `!== null`
    // karsilastirmasinda sessizce "not var" tarafina duserdi.
    it('forward_payload YOKSA hash null', () => {
        const p = parseTonPayload(JETTON.payloadBoc)
        expect(p.messages[0].jetton.forwardPayloadHash).toBeNull()
    })

    // Belgelenen alanlar bittikten SONRA kalan veri, okumadigimiz bir seydir.
    it('jetton govdesinde ARTIK veri kalirsa FIRLATIR', () => {
        const boc = jettonYuk({ artikBit: 0xff }).toBoc().toString('base64')
        expect(kod(() => parseTonPayload(boc))).toBe('TON_PAYLOAD_BODY_UNVERIFIED')
    })

    // Op TANINIYOR ama govde yapiya uymuyor: gecirmek, ayristirmadigimiz baytlari
    // "herhalde iyidir" saymak olurdu.
    it('kesik jetton govdesi FIRLATIR', () => {
        const boc = govdeKur({
            actions: [{
                tag: 0x0ec3c86d, to: J_WALLET, value: J_VALUE, bounce: true,
                body: beginCell().storeUint(0x0f8a7ea5, 32).endCell(),
            }],
        }).toBoc().toString('base64')
        expect(kod(() => parseTonPayload(boc))).toBe('TON_PAYLOAD_BODY_UNVERIFIED')
    })

    // Kendi kurdugumuz jetton govdesi OLCULEN govdeyle AYNI cikmali; cikmazsa
    // asagidaki bozma vakalari gercek sunucu ciktisini degil kendi hayalimizi sinar.
    it('kendi kurdugumuz jetton govdesi OLCULEN govdeyle birebir', () => {
        expect(jettonYuk().toBoc().toString('base64')).toBe(JETTON.payloadBoc)
    })
})

// ---------------------------------------------------------------------------
// JETTON NOTU (memo) - forward_payload icinde
//
// Notlu jetton gonderimi rolede YASAKTI ve yasagin sebebi sunucunun notu kabul
// etmemesi DEGIL, bizim onu DOGRULAYAMIYOR olmamizdi. 2026-09-15'te canli
// sunucuya AYIRT EDICI bir olcum yapildi: `comment` jetton eyleminde KABUL
// edildi, `gasTonNano` AYNI istekte REDDEDILDI - yani kapi gercekten ayirt
// ediyor ve kabul bir yanilsama degil. Yasagin bizdeki yarisi da bu yuzden
// kalkti; once DOGRULAMA acildi, sonra alan.
// ---------------------------------------------------------------------------
const jettonNotluQuote = (not, over = {}) =>
    muhurleDegistir(bozJ(), jettonYuk({ forwardPayload: yorumHucresi(not), ...over }))

const jettonNotluIntent = (not) => jettonIntent({
    actions: [{ kind: 'jetton', to: J_TO, amount: J_AMOUNT, jettonWallet: J_WALLET, comment: not }],
})

// ---------------------------------------------------------------------------
// TAKAS (swap) - forward_payload OPAK bir DEX yukudur
//
// Notlu gonderimde forward_payload'i BIZ kurariz (yorum hucresi) ve hash'i
// yeniden kurarak karsilastiririz. Takasta kuramayiz: yuk STON.fi SDK'sindan
// gelir ve router SURUMUNE gore bambaska bir sekle sahip (tonSwap.js dosya
// basi). O yuzden olculen sey ANLAM degil OZDESLIK - `kind:'raw'` dalindaki
// AYNI teknik: "govde kullanicinin ekranda onayladigi govdenin TA KENDISI mi".
//
// Sunucu yuku HIC denetlemiyor (sozlesme ss05: "Backend swap yukunun icerigini
// hic denetlemez"), yani bu karsilastirma TEK gercek korumadir.
// ---------------------------------------------------------------------------
const SWAP_YUKU = beginCell()
    .storeUint(0x25938561, 32)
    .storeAddress(Address.parse(J_TO))
    .storeCoins(1234n)
    .endCell()
const SWAP_BOC = SWAP_YUKU.toBoc().toString('base64')
const SWAP_FORWARD = 240000000n

const takasQuote = (over = {}) => muhurleDegistir(bozJ(), jettonYuk({
    forwardPayload: SWAP_YUKU, forwardTon: SWAP_FORWARD, ...over,
}))

const takasIntent = (over = {}) => jettonIntent({
    actions: [{
        kind: 'jetton', to: J_TO, amount: J_AMOUNT, jettonWallet: J_WALLET,
        forwardTonNano: SWAP_FORWARD.toString(), forwardPayloadBoc: SWAP_BOC,
        ...over,
    }],
})

describe('V5 jetton - TAKAS yuku OZDESLIKLE dogrulanir', () => {
    it('takas sekli GECER (yuk hash i ve forward tutari birebir)', () => {
        expect(() => verifyTonQuote(takasQuote(), takasIntent())).not.toThrow()
    })

    // YUK DEGISTIRILIRSE: ele gecirilmis bir backend, beyaz listedeki AYNI
    // router'a KEYFI bir swap kurabilir - baska bir token, baska bir minimum,
    // baska bir alici. Sunucu icerigi okumadigi icin bunu yakalayan TEK sey bu.
    it('govdedeki yuk niyettekinden FARKLIYSA firlatir', () => {
        const baska = beginCell().storeUint(0x25938561, 32).storeCoins(9n).endCell()
        expect(kod(() => verifyTonQuote(takasQuote({ forwardPayload: baska }), takasIntent())))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('govdede yuk YOKKEN niyette VARSA firlatir', () => {
        const q = muhurleDegistir(bozJ(), jettonYuk({ forwardTon: SWAP_FORWARD }))
        expect(kod(() => verifyTonQuote(q, takasIntent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // FORWARD TUTARI NIYETTEN GELIR ve BIREBIR tutmali. Notlu gonderimde yalniz
    // "sifir olmasin" deniyordu (tutari sunucu seciyordu); takasta tutari BIZ
    // veriyoruz cunku DEX'in istedigi gaz payi odur. Sunucu onu DUSURURSE swap
    // router'da gazsiz kalir: zincirde sessizce duser, ucret ise ALINMISTIR.
    it('forward tutari niyetten SAPARSA firlatir', () => {
        expect(kod(() => verifyTonQuote(takasQuote({ forwardTon: SWAP_FORWARD - 1n }), takasIntent())))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('niyet forward tutarini SOYLEMIYORSA firlatir', () => {
        const niyet = takasIntent({ forwardTonNano: undefined })
        expect(kod(() => verifyTonQuote(takasQuote(), niyet))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // AYNI SLOT. TEP-74'te forward_payload TEKTIR: yorum da takas yuku de oraya
    // yazilir. Ikisini birden tasiyan bir niyet ANLAMSIZDIR ve hangisinin
    // dogrulandigi belirsiz kalirdi. Sunucu da reddediyor (olculdu 2026-09-15:
    // "comment and forwardPayloadBoc cannot be given together").
    it('niyet hem yorum hem yuk tasiyorsa firlatir', () => {
        expect(kod(() => verifyTonQuote(takasQuote(), takasIntent({ comment: 'merhaba' }))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // Niyetin KENDI yuku cozulemiyorsa karsilastiracak bir sey yok - `raw`
    // dalindaki ayni kural, ayni sebeple.
    it('niyetteki yuk COZULEMIYORSA firlatir', () => {
        expect(kod(() => verifyTonQuote(takasQuote(), takasIntent({ forwardPayloadBoc: 'bu-boc-degil' }))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // BOUNCE JETTONDA HER ZAMAN TRUE (sozlesme ss05 mesaj tablosu; kendi
    // self-pay yolumuz jettonSend.js de bilerek true seciyor). false secilirse
    // transfer dustugunde iliştirilen TON GERI DONMEZ, jetton cuzdaninda kalir.
    // Alan ayristiriciya bastan beri okunuyordu ama jetton dalinda HIC
    // karsilastirilmiyordu - okunup dogrulanmayan alan, bu dosyanin kapatmak
    // icin var oldugu delik sinifinin ta kendisi.
    it('jetton mesajinda bounce false ise firlatir', () => {
        expect(kod(() => verifyTonQuote(takasQuote({ bounce: false }), takasIntent())))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('NOTLU jettonda da bounce false firlatir', () => {
        const q = muhurleDegistir(bozJ(), jettonYuk({
            forwardPayload: yorumHucresi('siparis-42'), bounce: false,
        }))
        expect(kod(() => verifyTonQuote(q, jettonNotluIntent('siparis-42'))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })
})

describe('V5 jetton - NOT forward_payload icinde dogrulanir', () => {
    it('notlu jetton GECER (govdedeki hucre = bizim kurdugumuz hucre)', () => {
        expect(() => verifyTonQuote(jettonNotluQuote('siparis-42'), jettonNotluIntent('siparis-42')))
            .not.toThrow()
    })

    // SUNUCU NOT EKLERSE: kullanici notsuz gonderdigini sanir, zincire not gider.
    // Duz TON dalindaki ayni kural, ayni sebeple iki yonlu.
    it('niyette not YOKKEN govdede not VARSA firlatir', () => {
        expect(kod(() => verifyTonQuote(jettonNotluQuote('siparis-42'), jettonIntent())))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // SUNUCU NOTU DUSURURSE: memosuz giden bir borsa yatirimi KAYIP sayilir.
    it('niyette not VARKEN govdede not YOKSA firlatir', () => {
        expect(kod(() => verifyTonQuote(JETTON, jettonNotluIntent('siparis-42'))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('not DEGISTIRILIRSE firlatir', () => {
        expect(kod(() => verifyTonQuote(jettonNotluQuote('siparis-43'), jettonNotluIntent('siparis-42'))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // TAKAS YOLU HALA KAPALI. forward_payload'in hash'lenmesi "artik her yuk
    // gecer" demek DEGIL: karsilastirilan sey BIZIM kurdugumuz YORUM hucresidir,
    // yani bir DEX yonlendirici yuku hicbir niyetle eslesemez.
    it('yorum OLMAYAN bir forward_payload hicbir niyetle eslesmez', () => {
        const q = muhurleDegistir(bozJ(), jettonYuk({
            forwardPayload: beginCell().storeUint(0x25938561, 32).storeUint(7, 64).endCell(),
        }))
        expect(kod(() => verifyTonQuote(q, jettonIntent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
        expect(kod(() => verifyTonQuote(q, jettonNotluIntent('siparis-42')))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // `trim()` cagiranin (quoteAction, buildJettonTransferBody) uyguladigi AYNI
    // normalizasyon: ekranda gorulen ile imzalanan ayni dize olmali.
    it('bosluklu niyet notu, kirpilmis govde notuyla eslesir', () => {
        expect(() => verifyTonQuote(jettonNotluQuote('siparis-42'), jettonNotluIntent('  siparis-42  ')))
            .not.toThrow()
    })

    // NOT VARKEN forward_ton_amount SIFIR OLAMAZ. Notu tasiyan sey
    // transfer_notification mesajidir ve o mesaj yalniz forward_ton_amount > 0
    // ise OLUSUR: sifirda not govdeye yazilir ama ALICIYA HIC ULASMAZ - yani
    // "not gitti" sanilir, gitmez. jettonTransfer.js KAPI 1 ile ayni kural:
    // orada KENDI govdemizi kurarken, burada SUNUCUNUNKINI olcerken.
    it('notlu jettonda forward_ton_amount 0 ise firlatir', () => {
        const q = jettonNotluQuote('siparis-42', { forwardTon: 0n })
        expect(kod(() => verifyTonQuote(q, jettonNotluIntent('siparis-42'))))
            .toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // NOTSUZ gonderimde ayni kural YOK: teslim edilecek bir not olmadigi icin
    // bildirim mesajinin olusmamasi bir kayip degil. Kapi BILEREK dar - gercek
    // bir sunucu davranisini olculmeden yasaklamak, calisan bir akisi kapatirdi.
    it('notsuz jettonda forward_ton_amount 0 GECER', () => {
        const q = muhurleDegistir(bozJ(), jettonYuk({ forwardTon: 0n }))
        expect(() => verifyTonQuote(q, jettonIntent())).not.toThrow()
    })
})

describe('V5 jetton - karsilastirma IC alanlarla yapilir', () => {
    it('saglam jetton altin vektoru GECER', () => {
        expect(() => verifyTonQuote(JETTON, jettonIntent())).not.toThrow()
    })

    // BU TESTIN VAR OLMA SEBEBI KAPININ VAR OLMA SEBEBI.
    // Dis hedef (kendi jetton cuzdanimiz) ve dis deger NIYETLE BIREBIR DOGRU;
    // yalniz govdenin ICINDEKI alici saldirganin adresi. Dis alanlara bakan bir
    // V5 bunu GECIRIR ve "dogruladim" der - dogruladigi sey tokenlarin nereye
    // gittigi DEGILDIR.
    it('DIS hedef DOGRU ama IC alici YANLIS ise firlatir', () => {
        const cell = jettonYuk({ destination: OTHER })
        const q = muhurleDegistir(bozJ(), cell)
        expect(parseTonPayload(q.payloadBoc).messages[0].to).toBe(J_WALLET) // dis hedef DEGISMEDI
        expect(kod(() => verifyTonQuote(q, jettonIntent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('IC tutar baska ise firlatir', () => {
        const cell = jettonYuk({ amount: J_AMOUNT + 1n })
        const q = muhurleDegistir(bozJ(), cell)
        expect(kod(() => verifyTonQuote(q, jettonIntent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // HANGI TOKEN sorusu. Ic alici ve ic tutar niyetle BIREBIR ayni, ama transfer
    // bizim BASKA bir jetton cuzdanimizdan geciyor: kullanici USDT gonderdigini
    // sanirken baska bir token cikar.
    it('DIS hedef BASKA bir jetton cuzdani ise firlatir', () => {
        const cell = jettonYuk({ outerTo: OTHER })
        const q = muhurleDegistir(bozJ(), cell)
        expect(kod(() => verifyTonQuote(q, jettonIntent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // Niyet hangi jetton cuzdanini bekledigimizi SOYLEMIYORSA hangi tokenin
    // gittigi dogrulanamaz - kapali tarafa duseriz.
    it('niyette jettonWallet yoksa firlatir', () => {
        const niyet = jettonIntent({ actions: [{ kind: 'jetton', to: J_TO, amount: J_AMOUNT }] })
        expect(kod(() => verifyTonQuote(JETTON, niyet))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // response_destination ARTAN TON'un geri donecegi adres. Saldirganin adresi
    // yazilirsa iliskilendirilen TON'un artani ona kalir.
    it('response_destination baska adres ise firlatir', () => {
        const cell = jettonYuk({ responseDestination: OTHER })
        const q = muhurleDegistir(bozJ(), cell)
        expect(kod(() => verifyTonQuote(q, jettonIntent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // ILISKILENDIRILEN TON kullanicinin KENDI bakiyesinden cikar. Relayer'in
    // yatirdigi attachNanoton'u asan bir deger, jetton transferi kiligina
    // girmis bir TON tahliyesidir.
    it('iliskilendirilen TON attachNanoton u asiyorsa firlatir', () => {
        const cell = jettonYuk({ outerValue: BigInt(JETTON.attachNanoton) + 1n })
        const q = muhurleDegistir(bozJ(), cell)
        expect(kod(() => verifyTonQuote(q, jettonIntent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('attachNanoton a TAM esit iliskilendirilen TON GECER', () => {
        const cell = jettonYuk({ outerValue: BigInt(JETTON.attachNanoton) })
        const q = muhurleDegistir(bozJ(), cell)
        expect(() => verifyTonQuote(q, jettonIntent())).not.toThrow()
    })

    // V12'nin jetton yolunda da AYNI sertlikte oldugu: mod 128'de cikan tutar
    // value alanindan bagimsizdir.
    it('jetton mesajinda sendMode 128 ise firlatir', () => {
        const cell = jettonYuk({ mode: 128 })
        const q = muhurleDegistir(bozJ(), cell)
        expect(kod(() => verifyTonQuote(q, jettonIntent()))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // TUR ESLESMESI IKI YONLU. Niyet jetton derken sunucunun duz TON gonderen bir
    // govde kurmasi (ya da tersi) sessizce gecmemeli: biri digerinin yerine
    // gecerse karsilastirilan alanlar da yer degistirir.
    // Niyet HER IKI tutar alanini da tasiyor ve DIGER dalin karsilastirmalari da
    // TUTUYOR: boylece tur kontrolu silinse test YESIL kalmaz. Yalniz
    // `amount`/`amountNano`dan birinin EKSIK olmasina yaslanan bir iddia, tur
    // kontrolunu hic sinamaz - eksik alan zaten tamSayi'da duserdi.
    it('niyet jetton derken govde duz TON ise firlatir', () => {
        const q = muhurleDegistir(bozJ(), govdeKur({
            validUntil: JETTON.validUntil,
            seqno: JETTON.sign.feeAuth.seqno,
            actions: [{ tag: 0x0ec3c86d, to: J_TO, value: J_AMOUNT }],
        }))
        const niyet = jettonIntent({
            actions: [{ kind: 'jetton', to: J_TO, amount: J_AMOUNT, amountNano: J_AMOUNT, jettonWallet: J_WALLET }],
        })
        expect(kod(() => verifyTonQuote(q, niyet))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    it('niyet duz TON derken govde jetton ise firlatir', () => {
        const niyet = jettonIntent({
            actions: [{ kind: 'ton', to: J_TO, amount: J_AMOUNT, amountNano: J_VALUE, jettonWallet: J_WALLET }],
        })
        expect(kod(() => verifyTonQuote(JETTON, niyet))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // Duz TON yolunun `kind` YAZILMAMIS eski cagrilari bozulmadan calismali:
    // eksik `kind` jetton SAYILMAZ, duz TON sayilir.
    it('kind yazilmamis niyet duz TON sayilir', () => {
        expect(() => verifyTonQuote(GOLDEN, intent())).not.toThrow()
    })

    // TANIMADIGIMIZ `kind` DUZ TON'A DUSURULEMEZ. "jetton mi degil mi" diye soran
    // bir kontrol, 'swap'i / yazim hatasini / sonradan eklenen bir turu SESSIZCE
    // duz TON dali ile olcer ve "dogruladim" der - oysa o eylem seklini bu dosya
    // ANLAMIYOR. Bir dosya oteki (tonFeeRelayer) TAM TERS kurali uyguluyor:
    // tanimadigi kind FIRLATIR, yok saymaz. Dogrulayici disa acik guvenlik
    // sinirdir; tek cagirani relayer olmak zorunda degil.
    it('TANIMADIGI kind i duz TON sayip GECIRMEZ', () => {
        const niyet = intent({ actions: [{ kind: 'swap', to: SELF, amountNano: AMOUNT }] })
        expect(kod(() => verifyTonQuote(GOLDEN, niyet))).toBe('TON_QUOTE_INTENT_MISMATCH')
    })

    // KARSILASTIRMA HANGI ALANLA YAPILIYOR? Gecen tum vakalar KENDINE gonderim
    // oldugu icin `destination`, `responseDestination` ve `intent.tonWallet` AYNI
    // adres - suit "eylem.to ile karsilastirdik" ile "intent.tonWallet ile
    // karsilastirdik"i AYIRT EDEMEZ. Ucuncu tarafa gonderim bu ikisini ayirir:
    // ic alici BASKA biri, response_destination hala BIZ.
    it('UCUNCU TARAFA jetton gonderimi GECER (ic alici != kendi cuzdanimiz)', () => {
        const cell = jettonYuk({ destination: OTHER, responseDestination: SELF })
        const q = muhurleDegistir(bozJ(), cell)
        const niyet = jettonIntent({
            actions: [{ kind: 'jetton', to: OTHER, amount: J_AMOUNT, jettonWallet: J_WALLET }],
        })
        expect(() => verifyTonQuote(q, niyet)).not.toThrow()
    })
})
