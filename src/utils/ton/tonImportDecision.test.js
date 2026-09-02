import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { decideImport, decideAfterChoice } from './tonImportDecision'

const probe = (candidates, failed = false) => ({ candidates, failed })
const c = (kind, version, balance) => ({ kind, version, balance, address: `${kind}-${version}` })

describe('cakisma YOK — tek standart gecerli', () => {
    it('yalnizca BIP39 gecerliyse BIP39 ile aktarilir', () => {
        const d = decideImport({ bip39Valid: true, tonValid: false, probe: probe([]) })
        expect(d).toEqual({ action: 'import', kind: 'bip39' })
    })

    it('yalnizca TON gecerliyse ve W5 bossa TON ile aktarilir', () => {
        const d = decideImport({
            bip39Valid: false, tonValid: true,
            probe: probe([c('tonMnemonic', 'w5', 0), c('tonMnemonic', 'v4R2', 0)]),
        })
        expect(d).toEqual({ action: 'import', kind: 'tonMnemonic' })
    })

    // SPEC §7 — ESKI SURUM. Bu kapi olmadan kullanici dogru ifadeyi girer,
    // uygulama "basarili" der, bakiye sifir gorunur.
    it('W5 bos ama ESKI SURUMDE bakiye varsa DURUR', () => {
        const d = decideImport({
            bip39Valid: false, tonValid: true,
            probe: probe([c('tonMnemonic', 'w5', 0), c('tonMnemonic', 'v4R2', 42)]),
        })
        expect(d.action).toBe('blocked')
        expect(d.reason).toBe('TON_OLD_WALLET_VERSION')
        expect(d.detail.version).toBe('v4R2')
        expect(d.detail.balance).toBe(42)
    })

    it('W5 DOLUYSA eski surumdeki bakiye ENGEL DEGILDIR', () => {
        const d = decideImport({
            bip39Valid: false, tonValid: true,
            probe: probe([c('tonMnemonic', 'w5', 5), c('tonMnemonic', 'v4R2', 42)]),
        })
        expect(d).toEqual({ action: 'import', kind: 'tonMnemonic' })
    })

    // Yoklama basarisiz olsa bile cakisma YOKKEN ice aktarma durmaz: burada
    // yoklama bir YARDIM mesajidir, karar degil (spec §7).
    it('yoklama basarisizsa ve cakisma yoksa yine de aktarilir', () => {
        const d = decideImport({ bip39Valid: false, tonValid: true, probe: probe([], true) })
        expect(d).toEqual({ action: 'import', kind: 'tonMnemonic' })
    })
})

describe('CAKISMA — iki standart da gecerli (spec §8)', () => {
    it('yalnizca TON turetmesinde varlik varsa TON secilir', () => {
        const d = decideImport({
            bip39Valid: true, tonValid: true,
            probe: probe([c('tonMnemonic', 'w5', 3), c('bip39', 'w5', 0)]),
        })
        expect(d).toEqual({ action: 'import', kind: 'tonMnemonic' })
    })

    // Surum kapisi (spec §7) ve cakisma kapisi (spec §8) BIRBIRINDEN BAGIMSIZ:
    // ifadenin ayrica BIP39-gecerli olmasi, TON tarafinin eski bir surumde para
    // tutmasini degistirmez. Karar TON'a kayarken bile surum kontrolunden
    // GECMELI - aksi halde kullanici W5'e yerlesir, parasi v4R2'de kalir.
    it('cakismada TON secilse bile ESKI SURUMDE bakiye varsa DURUR', () => {
        const d = decideImport({
            bip39Valid: true, tonValid: true,
            probe: probe([
                c('tonMnemonic', 'w5', 0),
                c('tonMnemonic', 'v4R2', 42),
                c('bip39', 'w5', 0),
            ]),
        })
        expect(d.action).toBe('blocked')
        expect(d.reason).toBe('TON_OLD_WALLET_VERSION')
        expect(d.detail.version).toBe('v4R2')
        expect(d.detail.balance).toBe(42)
    })

    it('cakismada W5 DOLUYSA eski surumdeki bakiye ENGEL DEGILDIR', () => {
        const d = decideImport({
            bip39Valid: true, tonValid: true,
            probe: probe([
                c('tonMnemonic', 'w5', 5),
                c('tonMnemonic', 'v4R2', 42),
                c('bip39', 'w5', 0),
            ]),
        })
        expect(d).toEqual({ action: 'import', kind: 'tonMnemonic' })
    })

    it('yalnizca BIP39 turetmesinde varlik varsa BIP39 secilir', () => {
        const d = decideImport({
            bip39Valid: true, tonValid: true,
            probe: probe([c('tonMnemonic', 'w5', 0), c('bip39', 'w5', 7)]),
        })
        expect(d).toEqual({ action: 'import', kind: 'bip39' })
    })

    // Yoklamanin aday sirasi, probun cagrildigi `kinds` dizisinin sirasini
    // izler. Bugun o sira hep [tonMnemonic, bip39] - ustteki testler de bu
    // sirayla yazildi. Eger karar candidates[0]/[1] gibi KONUMA bakarak
    // verilseydi, o testler YANLIS bir uygulamayla da GECERDI ve sıra bir gun
    // degistiginde (baska bir gorevde `kinds` dizisi yer degistirirse) karar
    // SESSIZCE yanlis turetmeyi secerdi - tam bu planin onlemeye calistigi
    // hata. Burada sira BILEREK ters: bip39 once, tonMnemonic sonra. Yalnizca
    // `kind` alanina bakan bir uygulama bunu dogru cozer.
    it('aday SIRASI degil `kind` alani belirleyicidir', () => {
        const d = decideImport({
            bip39Valid: true, tonValid: true,
            probe: probe([c('bip39', 'w5', 0), c('tonMnemonic', 'w5', 3)]),
        })
        expect(d).toEqual({ action: 'import', kind: 'tonMnemonic' })
    })

    // Ikisi de bos: bugunku davranis korunur (BIP39) ama SESSIZ KALINMAZ.
    it('ikisi de bossa BIP39 secilir ama kullaniciya SOYLENIR', () => {
        const d = decideImport({
            bip39Valid: true, tonValid: true,
            probe: probe([c('tonMnemonic', 'w5', 0), c('bip39', 'w5', 0)]),
        })
        expect(d.action).toBe('import')
        expect(d.kind).toBe('bip39')
        expect(d.reason).toBe('MNEMONIC_AMBIGUOUS')
    })

    it('IKISINDE de varlik varsa kullaniciya SORULUR', () => {
        const d = decideImport({
            bip39Valid: true, tonValid: true,
            probe: probe([c('tonMnemonic', 'w5', 3), c('bip39', 'w5', 7)]),
        })
        expect(d.action).toBe('ask')
        expect(d.reason).toBe('MNEMONIC_AMBIGUOUS')
    })

    // SPEC §7 ISTISNASI: cakismada yoklama artik bir yardim mesaji degil, hangi
    // ANAHTARIN turetilecegini belirleyen KARAR. Varsayilana dusulmez.
    it('cakismada yoklama basarisizsa SORULUR, varsayilana DUSULMEZ', () => {
        const d = decideImport({ bip39Valid: true, tonValid: true, probe: probe([], true) })
        expect(d.action).toBe('ask')
    })
})

describe('hicbiri gecerli degil', () => {
    it('gecersiz ifade engellenir', () => {
        const d = decideImport({ bip39Valid: false, tonValid: false, probe: probe([]) })
        expect(d.action).toBe('blocked')
        expect(d.reason).toBe('TON_MNEMONIC_INVALID')
    })
})

describe('KULLANICI CEVABI da surum kapisindan gecer (spec §7 + §8)', () => {
    // ULASILABILIR SENARYO, ve bu delik 'ask'i bir SORUYA cevirince ACILDI:
    // ondan once 'ask' firlatiyordu, yani hicbir sey ice aktarilmiyordu ve kapi
    // VAKUMDA guvenliydi. Soru sorulunca yol ulasilabilir hale geldi ve kapi
    // onunla birlikte tasinmadi.
    //
    // Sekli: cift-gecerli ifade, TON parasi v4R2'de, BIP39 tarafi da dolu.
    // `has(candidates, 'tonMnemonic')` v4R2 adayiyla TRUE oluyor -> karar 'ask'.
    // Kullanici TON'u seciyor -> BOS bir W5 cuzdani UYARISIZ aktariliyordu,
    // oysa engeli tetikleyecek kanit `probe.candidates` icinde ZATEN duruyor.
    const DUAL_OLD_TON = probe([
        c('tonMnemonic', 'w5', 0),
        c('tonMnemonic', 'v4R2', 42),
        c('bip39', 'w5', 7),
    ])

    it('cift-gecerli + iki taraf da dolu -> karar KULLANICIYA birakilir', () => {
        const d = decideImport({ bip39Valid: true, tonValid: true, probe: DUAL_OLD_TON })
        expect(d.action).toBe('ask')
        expect(d.reason).toBe('MNEMONIC_AMBIGUOUS')
    })

    it('kullanici TON secince ESKI SURUM engeli calisir - SEBEBIYLE', () => {
        const d = decideAfterChoice({ kind: 'tonMnemonic', probe: DUAL_OLD_TON })

        expect(d.action).toBe('blocked')
        expect(d.reason).toBe('TON_OLD_WALLET_VERSION')
        // Spec §12: kullanici surumu, adresi ve bakiyeyi gormeli - genel bir
        // basarisizlik degil.
        expect(d.detail).toEqual({ version: 'v4R2', address: 'tonMnemonic-v4R2', balance: 42 })
    })

    it('ayni durumda BIP39 secilirse ENGEL YOK - kapi asiri uygulanmiyor', () => {
        // Kapi karar aninda (secimden ONCE) uygulansaydi, kullanicinin gayet
        // gecerli BIP39 ice aktarmasi da engellenirdi. Surum kapisi YALNIZCA
        // TON secildiginde anlamlidir.
        expect(decideAfterChoice({ kind: 'bip39', probe: DUAL_OLD_TON }))
            .toEqual({ action: 'import', kind: 'bip39' })
    })

    it('TON tarafi W5 te DOLUYSA TON secimi normal aktarilir', () => {
        const p = probe([
            c('tonMnemonic', 'w5', 5),
            c('tonMnemonic', 'v4R2', 42),
            c('bip39', 'w5', 7),
        ])
        expect(decideImport({ bip39Valid: true, tonValid: true, probe: p }).action).toBe('ask')
        expect(decideAfterChoice({ kind: 'tonMnemonic', probe: p }))
            .toEqual({ action: 'import', kind: 'tonMnemonic' })
    })

    it('eski surumde de para YOKSA TON secimi normal aktarilir', () => {
        const p = probe([c('tonMnemonic', 'w5', 3), c('bip39', 'w5', 7)])
        expect(decideAfterChoice({ kind: 'tonMnemonic', probe: p }))
            .toEqual({ action: 'import', kind: 'tonMnemonic' })
    })

    // BILGI SINIRI, delik degil: yoklama basarisizsa aday YOK, yani eski surumde
    // para olup olmadigini gosteren kanit da yok. Burada "ihtiyaten engelle"
    // demek, bir RPC kesintisinde kullanicinin kendi cuzdanini aktarmasini
    // durdurmak olurdu. Engel UYDURULMAZ.
    it('yoklama basarisizken TON secimi ENGELLENMEZ - engel uydurulmaz', () => {
        expect(decideAfterChoice({ kind: 'tonMnemonic', probe: probe([], true) }))
            .toEqual({ action: 'import', kind: 'tonMnemonic' })
    })

    it('probe hic verilmezse de cokmez', () => {
        expect(decideAfterChoice({ kind: 'tonMnemonic' }))
            .toEqual({ action: 'import', kind: 'tonMnemonic' })
    })
})

describe('surum kapisi TEK HUNIDEN gecer — yapisal', () => {
    // Bu kusur IKI KEZ, IKI FARKLI KAPIDAN geldi: once cakisma dali kapiyi
    // atliyordu (Gorev 7), sonra kullanici secimi yeni bir yol acti (Onemli 7).
    // Ikisinde de sebep ayni: kapi, SAYILAN yollara tek tek konuyordu. Asagidaki
    // iddialar "TON turetmesine cikan her yol tek huniden gecer" yapisini kilitler
    // - davranissal testler yalnizca DUSUNULMUS yollari kapsayabilir, bu ise
    // henuz yazilmamis bir ucuncu yolu da kapsar.
    const SOURCE = readFileSync(fileURLToPath(new URL('./tonImportDecision.js', import.meta.url)), 'utf8')

    it('tonVersionBlock dosyada TEK yerden cagrilir', () => {
        const calls = SOURCE.match(/tonVersionBlock\(/g) || []
        // 1 tanim + 1 cagri
        expect(SOURCE.match(/function tonVersionBlock\(/g)).toHaveLength(1)
        expect(calls).toHaveLength(2)
    })

    it('o tek cagri decideAfterChoice ICINDE', () => {
        const funnel = SOURCE.slice(
            SOURCE.indexOf('export function decideAfterChoice'),
            SOURCE.indexOf('export function decideImport')
        )
        expect(funnel).toMatch(/tonVersionBlock\(/)
    })

    it('decideImport TON turetmesini HUNIYI ATLAYARAK dondurmez', () => {
        const body = SOURCE.slice(SOURCE.indexOf('export function decideImport'))
        // `kind: 'tonMnemonic'` YALNIZCA decideAfterChoice cagrilarinin argumaninda
        // gecmeli; duz bir `{ action: 'import', kind: 'tonMnemonic' }` donusu
        // huniyi atlar.
        expect(body).not.toMatch(/action:\s*'import',\s*kind:\s*'tonMnemonic'/)
        for (const line of body.split('\n')) {
            if (!line.includes("kind: 'tonMnemonic'")) continue
            expect(line, `huniyi atlayan satir: ${line.trim()}`).toContain('decideAfterChoice(')
        }
    })
})
