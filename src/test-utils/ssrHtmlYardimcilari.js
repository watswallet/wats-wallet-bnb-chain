// SSR cikti yardimcilari (Token.vue xStock testleri ortak kullanir; D8).
// SSR HTML'i sablon yorumlarini tasir: metin / buton aramadan ONCE yorumlar atilir (G3).

export const yorumsuzHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

// Her <button> icin { nitelikler, metin }: metin etiketlerden arindirilmis, bosluklari tek.
export const butonlar = (html) => [...yorumsuzHtml(html).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map(([, nitelikler, govde]) => ({
        nitelikler,
        metin: govde.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
    }))

export const butonSayisi = (html, etiket) => butonlar(html).filter((b) => b.metin === etiket).length

// `disabled` niteligi var mi (nitelik DEGERLERI temizlenir: "disabled:opacity-40" sinifi sayilmaz).
export const devreDisi = (buton) => /(^|\s)disabled(?=\s|=|$)/.test(buton.nitelikler.replace(/"[^"]*"/g, '""'))
