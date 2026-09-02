// Ice aktarma karari — saf katman. Zincire DOKUNMAZ; tonWalletProbe'un topladigi
// veriyi karara cevirir.
//
// Ayri dosya olmasinin sebebi: karar, agdan bagimsiz olarak test edilebilmeli.
// Yoklamanin icine gomulseydi her kosul icin bir sahte zincir kurmak gerekirdi
// ve kararin kendisi degil, sahtenin dogrulugu test edilirdi.

const has = (candidates, kind) => candidates.some((c) => c.kind === kind && c.balance > 0)

// Surum kapisi §7. CAKISMADAN BAGIMSIZ: ifadenin ayrica BIP39-gecerli olmasi,
// paranin eski surumde durmasini degistirmez.
//
// BU FONKSIYON YALNIZCA `decideAfterChoice` ICINDEN CAGRILIR. Ikinci bir cagri
// yeri acmak, kapinin bir yolda unutulmasi demektir ve bu tam olarak IKI KEZ
// yasandi: once cakisma dali kapiyi tumden atliyordu (Gorev 7), sonra kullanici
// secimi bir SORUYA cevrilince (Onemli 7) o yeni yol da kapisiz kaldi. Kural:
// TON turetmesine cikan HER yol tek bir huniden gecer.
function tonVersionBlock(candidates) {
    const w5 = candidates.find((c) => c.kind === 'tonMnemonic' && c.version === 'w5')

    // W5'te varlik varsa eski surumdeki bakiye ENGEL DEGILDIR: kullanici zaten
    // W5 kullaniyor, eski surum onun gecmisinden kalmis olabilir.
    if (w5 && w5.balance > 0) return null

    const old = candidates.find(
        (c) => c.kind === 'tonMnemonic' && c.version !== 'w5' && c.balance > 0
    )
    if (!old) return null

    return {
        action: 'blocked',
        reason: 'TON_OLD_WALLET_VERSION',
        detail: { version: old.version, address: old.address, balance: old.balance },
    }
}

/**
 * SECILEN TURETMEYI KARARA CEVIREN TEK HUNI.
 *
 * `decideImport` kendi karar verdiginde de, kullanici cakismayi kendi cozdugunde
 * de (spec §8: "ikisinde de varlik" -> soru) BURAYA gelinir. Iki giris, tek kapi.
 *
 * Neden kapi karar katmaninda ve secimden SONRA:
 *
 *   - SECIMDEN ONCE olamaz. Cakismada BIP39 tarafi da doluysa surum engeli
 *     ERKEN uygulanirsa, kullanicinin gayet gecerli olan BIP39 ice aktarmasi da
 *     engellenirdi. Surum kapisi yalnizca TON SECILDIGINDE anlamlidir.
 *   - Ekranda olamaz. Ekran (ImportPhrases.vue) kurali kopyalamak zorunda kalir
 *     ve ilk kurulum yolu (CreatePassword2) ile ikinci bir kopya dogar. Kural
 *     saf katmanda kalinca agsiz test edilebilir ve tek kaynak olur.
 */
export function decideAfterChoice({ kind, probe }) {
    // BIP39 tarafinda "eski surum" diye bir sey YOK: tonWalletProbe o tohumdan
    // yalnizca W5 adayi uretiyor (contractsFor), cunku bu uygulama o tohumdan
    // baska bir surumde hic adres uretmedi.
    if (kind !== 'tonMnemonic') return { action: 'import', kind }

    // YOKLAMA BASARISIZSA ENGEL UYDURULMAZ.
    //
    // `probe.failed` demek aday listesi BOS demek - yani eski surumde para olup
    // olmadigini gosteren kanit ELDE YOK. Bu bir BILGI SINIRIDIR, delik degil:
    // burada "ihtiyaten engelle" demek, RPC kesintisinde kullanicinin kendi
    // cuzdanini aktarmasini durdurmak olurdu (tonWalletProbe'un `failed`
    // bayragini tasima sebebiyle ayni gerekce).
    //
    // Acikca yaziliyor: tonVersionBlock bos listede zaten null doner, ama o
    // sessiz davranisa GUVENMEK, okuyana bunun bir unutma mi karar mi oldugunu
    // birakirdi.
    if (probe?.failed) return { action: 'import', kind }

    return tonVersionBlock(probe?.candidates ?? []) ?? { action: 'import', kind }
}

export function decideImport({ bip39Valid, tonValid, probe }) {
    if (!bip39Valid && !tonValid) {
        return { action: 'blocked', reason: 'TON_MNEMONIC_INVALID' }
    }

    // ---- CAKISMA (spec §8) ----
    //
    // Sabit bir sira BILEREK kullanilmiyor. Olculdu: bir TON ifadesinin ayrica
    // BIP39-gecerli cikma olasiligi ~500'de bir. Sabit sirayla, 500 Tonkeeper
    // ice aktarmasinin biri yanlis dala duser ve SESSIZCE yanlis adres uretir.
    if (bip39Valid && tonValid) {
        // Yoklama basarisizsa varsayilana DUSULMEZ: burada yoklama bir yardim
        // mesaji degil, hangi anahtarin turetilecegini belirleyen karardir.
        if (probe.failed) return { action: 'ask', reason: 'MNEMONIC_AMBIGUOUS' }

        const tonHas = has(probe.candidates, 'tonMnemonic')
        const bip39Has = has(probe.candidates, 'bip39')

        // TON secilse bile surum kapisindan GECMEK zorunda: cakisma, eski
        // surumde para kalma ihtimalini ORTADAN KALDIRMAZ.
        if (tonHas && !bip39Has) return decideAfterChoice({ kind: 'tonMnemonic', probe })
        if (bip39Has && !tonHas) return decideAfterChoice({ kind: 'bip39', probe })

        // IKISINDE DE VARLIK: karar KULLANICININ. Burada surum kapisi CALISTIRILMAZ
        // - cunku kullanici BIP39'u secebilir ve o ice aktarma gayet gecerlidir.
        // Kapi, cevap geldikten sonra `decideAfterChoice` ile uygulanir; cagiran
        // taraf cevabi ORAYA vermek zorunda.
        if (tonHas && bip39Has) return { action: 'ask', reason: 'MNEMONIC_AMBIGUOUS' }

        // Ikisi de bos. BIP39 secilir cunku bugunku davranis odur ve bos bir TON
        // cuzdaninin kaybedecek bir seyi yoktur. Ama SESSIZ KALINMAZ.
        return { ...decideAfterChoice({ kind: 'bip39', probe }), reason: 'MNEMONIC_AMBIGUOUS' }
    }

    if (bip39Valid) return decideAfterChoice({ kind: 'bip39', probe })

    // ---- YALNIZCA TON: SURUM KONTROLU (spec §7) ----
    return decideAfterChoice({ kind: 'tonMnemonic', probe })
}
