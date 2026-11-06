// Rusca cogul kurali (spec Bolum C). vue-i18n'in varsayilan kurali iki bicimlidir
// (1 -> 0, digerleri -> 1); Rusca uc bicim ister: "ya | yb | yc".
//
// Donen indeks `|` ile ayrilan parcayi secer (CLDR Rusca, tam sayilar):
//   0 = bir     (1, 21, 31, ... 101; 11 haric)
//   1 = birkac  (2-4, 22-24, ... 102-104; 12-14 haric)
//   2 = cok     (0, 5-20, 25-30, ... ve 11-14 ile biten her sayi)
//
// Imza vue-i18n'in PluralizationRule imzasidir: (choice, choicesLength, orgRule?) -> indeks.
// Yalnizca Rusca kayitlidir; baska dillerin kurali (varsayilan) degismez, tek bicimli dillerde
// mesajda `|` olmadigi icin kural hic cagrilmaz.
//
// choicesLength'ten buyuk indeks DONMEZ: 2 parcali (hatali) bir Rusca mesajda 5 icin
// messages[2] undefined olur ve vue-i18n t() icinde "Unexpected return type in composer"
// firlatip ekrani bozar. Boyle bir mesaj genel testlerde zaten kirmizidir (Rusca 3 parca
// sarttir); burasi uretimde cokmeyi onleyen son savunmadir.

/**
 * @param {number} choice t(key, named, n)'deki n
 * @param {number} [choicesLength] mesajdaki `|` ile ayrilmis parca sayisi
 * @returns {0 | 1 | 2}
 */
export function ruPlural(choice, choicesLength) {
    const n = Math.abs(choice)
    const son1 = n % 10
    const son2 = n % 100

    let indeks = 2
    if (son1 === 1 && son2 !== 11) indeks = 0
    else if (son1 >= 2 && son1 <= 4 && (son2 < 12 || son2 > 14)) indeks = 1

    return choicesLength >= 1 ? Math.min(indeks, choicesLength - 1) : indeks
}

// createI18n({ pluralRules }) seceneginin degeri: dil kodu -> kural.
export const pluralRules = Object.freeze({ ru: ruPlural })
