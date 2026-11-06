// GONDER EKRANI TASLAGI
//
// App.vue ekranlari `v-if` ile kuruyor (bkz. App.vue: <Send v-if="...">). Onizlemeye
// gecince Send.vue SOKULUYOR, geri gelince SIFIRDAN kuruluyor. Alici, tutar ve TON
// memosu bilesenin kendi ref'lerinde durdugu icin bu sokulmede yok oluyordu:
// kullanici onizlemeden geri donunce formu bastan dolduruyordu.
//
// Cozum girdileri store'da tutmak, ama KORUMASIZ geri yazmamak. Eski bir aliciyi
// yeni bir gonderime sessizce tasimak bu cuzdanin yapabilecegi en pahali hatadir:
// kullanici tutari yazip gonderir ve para BASKA bir adrese gider, geri alinamaz.
// Bu yuzden taslak yazildigi VARLIK + ZINCIR ciftine kilitlenir ve yalnizca ayni
// cift acildiginda geri verilir.

// Taslagin kimligi. chainId yoksa null: eksik zincir iki farkli agin taslagini
// ayni anahtara toplar ve bir agin alicisi digerinin ekraninda belirirdi.
export function sendDraftKey(asset, chainId) {
    if (chainId === null || chainId === undefined || chainId === '') return null

    // Send.vue varlik adresini `address || ca` diye okuyor; kimlik de AYNI
    // sirayi kullanmali, yoksa `ca` tasiyan kayitlar hicbir zaman eslesmez.
    const address = asset?.address ?? asset?.ca ?? ''

    // Native varlikta adres yok. Bos parca token adresiyle karisamaz cunku
    // token adresi hicbir zaman bos degildir.
    return `${chainId}:${String(address).toLowerCase()}`
}

// Para birimi kodu yalnizca metin olabilir; degilse '' (bilinmiyor). Bos metin
// reconcileFiatMode'da "farkli birim" sayilir: hangi parayla yazildigi bilinmeyen bir
// fiat girisi sessizce baska paraya donusmesin diye guvenli taraf budur.
function currencyText(currency) {
    return typeof currency === 'string' ? currency : ''
}

// NOT: kayitli mod degeri 'usd' KALDI (taslak ve testlerle uyum icin ad degismedi) ama
// artik "SECILI BIRIMLE giris" demek: kullanici Ayarlar'da TRY sectiyse 'usd' modu
// TRY girisidir. Hangi birim oldugu `currency` alaninda saklanir.
export function captureSendDraft({ asset, chainId, to, amount, tonComment, mode, currency }) {
    const key = sendDraftKey(asset, chainId)
    if (!key) return null

    // Alanlar METNE cevrilir: MAX dugmesi amount'a sayi yaziyor (Send.vue:setMax)
    // ve sayiyi input'a geri koymak v-model'in tipini degistirir.
    return {
        key,
        to: to == null ? '' : String(to),
        amount: amount == null ? '' : String(amount),
        tonComment: tonComment == null ? '' : String(tonComment),
        // Birim yalnizca iki degerden biri olabilir. Taninmayan bir deger
        // token'a duser: bilinmeyen bir birimde acilan kutu, kullanicinin
        // yazdigi sayiyi bambaska bir miktara cevirirdi.
        mode: mode === 'usd' ? 'usd' : 'token',
        // Fiat girisinin yazildigi para birimi (kucuk harf kod, ornegin 'try').
        currency: currencyText(currency),
    }
}

export function restoreSendDraft(draft, { asset, chainId }) {
    if (!draft?.key) return null

    const key = sendDraftKey(asset, chainId)
    if (!key || key !== draft.key) return null

    return {
        to: draft.to,
        amount: draft.amount,
        tonComment: draft.tonComment,
        mode: draft.mode,
        // Alani olmayan eski taslak '' olur (bkz. reconcileFiatMode).
        currency: currencyText(draft.currency),
    }
}

// Fiat girisi aciksa ve birim DEGISTIYSE (baska pencerede secim yapildi, kur sonradan
// geldi, taslak baska birimle yazilmisti) yazilan sayi sessizce baska paraya donusmesin:
// mod token'a doner ve alan bosalir. 'usd' modu = secili birimle giris (bkz. ustteki not).
// Token modunda hicbir sey temizlenmez: orada yazilan sayi zaten token miktaridir.
export function reconcileFiatMode({ mode, from, to }) {
    if (mode === 'usd' && from !== to) return { mode: 'token', clearInput: true }
    return { mode, clearInput: false }
}
