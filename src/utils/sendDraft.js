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

export function captureSendDraft({ asset, chainId, to, amount, tonComment, mode }) {
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
    }
}

export function restoreSendDraft(draft, { asset, chainId }) {
    if (!draft?.key) return null

    const key = sendDraftKey(asset, chainId)
    if (!key || key !== draft.key) return null

    return { to: draft.to, amount: draft.amount, tonComment: draft.tonComment, mode: draft.mode }
}
