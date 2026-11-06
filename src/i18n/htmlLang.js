import { watch } from 'vue'

/**
 * `<html lang>` ozelligini secili arayuz diline baglar.
 *
 * Uc index.html'deki statik lang="en" yalnizca ilk degerdir; dil degisince (tarayici dili,
 * kayitli secim, Tercihler'den secim) ozellik de degismeli. Aksi halde tarayicinin ceviri
 * onerisi, ekran okuyucunun ses secimi ve yazim denetimi yanlis dile gore calisir.
 *
 * Service worker'da (ve node'da) `document` yoktur: baglama atlanir, null doner.
 *
 * `flush: 'sync'`: dil degisimi ile ozellik yazimi arasinda tick kalmaz; sonraki sync kod
 * (ornegin ilk render) hep guncel degeri gorur.
 *
 * @param {{ global: { locale: { value: string } } }} i18n composition modunda (legacy: false) vue-i18n ornegi
 * @param {{ documentElement?: { lang: string } } | null} [doc] test icin enjekte edilebilir
 * @returns {(() => void) | null} izlemeyi durduran fonksiyon; document yoksa null
 */
export function bindHtmlLang(i18n, doc = globalThis.document) {
    const kok = doc?.documentElement
    if (!kok) return null

    return watch(
        () => i18n.global.locale.value,
        (locale) => {
            // Bos ya da string olmayan deger gecersiz bir lang etiketi olurdu; son gecerli deger kalir.
            if (typeof locale === 'string' && locale) kok.lang = locale
        },
        { immediate: true, flush: 'sync' }
    )
}
