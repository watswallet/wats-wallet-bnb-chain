// Aktivite listesini GUN BLOKLARINA ayiran SAF katman.
//
// NEDEN AYRI BIR MODUL: History.vue'de mount-test harness'i yok (bkz.
// historyWiring.test.js ustundeki ayni gerekce), yani .vue icinde kalan her
// mantik testsiz kalir. Tarih mantigi tam da sessizce kayan turden: "bugun"
// karari YEREL saate gore verilmezse 03:00'te yapilan bir islem "dun"
// gorunur.
//
// UC ZINCIRIN TARIH ALANI FARKLI: EVM/TON satirlari `block_timestamp` (ISO
// dizgi), Solana satirlari `timestamp` (ms sayisi) tasir. Bu modul hangi
// alanin okunacagini BILMEZ -- cagiran bir `dateOf` erisimcisi verir. Boylece
// modul uc semadan da bagimsiz kalir.

function toDate(value) {
    if (value === null || value === undefined || value === '') return null
    // Number(NaN) da dahil: gecersiz her deger burada elenir.
    const d = value instanceof Date ? value : new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
}

// Yerel takvim gununun kimligi. UTC KULLANILMAZ: kullanicinin gordugu "bugun"
// onun saat diliminin gunudur; UTC'ye gecmek +03 bolgesinde her gece 21:00'den
// sonraki islemleri "yarin" kovasina atardi.
function localDayId(date) {
    const ay = String(date.getMonth() + 1).padStart(2, '0')
    const gun = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${ay}-${gun}`
}

function shiftDays(date, days) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    d.setDate(d.getDate() + days)
    return d
}

/**
 * Bir tarihi gun kovasina cevirir: 'today' | 'yesterday' | 'YYYY-MM-DD'.
 * Cozulemeyen tarihte null doner (satir DUSMEZ, yalnizca baslıksiz kalir).
 */
export function dayKey(value, now = new Date()) {
    const date = toDate(value)
    if (!date) return null

    const bugun = toDate(now)
    if (!bugun) return localDayId(date)

    const id = localDayId(date)
    if (id === localDayId(bugun)) return 'today'
    if (id === localDayId(shiftDays(bugun, -1))) return 'yesterday'
    return id
}

/**
 * Gun basliginda yil gosterilmeli mi? Yalnizca icinde bulundugumuz yildan
 * FARKLI bir yilsa. Aksi halde her baslikta tekrarlayan yil gurultu olurdu --
 * ama 2023'teki bir islem de bugunkuyle ayni gorunmemeli.
 */
export function needsYear(value, now = new Date()) {
    const date = toDate(value)
    const bugun = toDate(now)
    if (!date || !bugun) return false
    return date.getFullYear() !== bugun.getFullYear()
}

/**
 * Listeyi ARDISIK gun bloklarina boler.
 *
 * BU BIR SIRALAMA DEGILDIR ve olmamalidir: liste ust katmanda zaten siralanmis
 * geliyor (History.vue: combinedList.sort) ve bekleyen yerel kayitlar bilerek
 * one alinabiliyor. Burada yeniden siralamak o karari SESSIZCE EZERDI -- az
 * once gonderilen islem listenin ortasina duserdi. Bu yuzden ayni gun arada
 * kesilirse IKI AYRI blok olusur; satirlarin sirasi HIC degismez.
 */
export function groupByDay(rows, dateOf, now = new Date()) {
    if (!Array.isArray(rows)) return []

    const gruplar = []
    for (const row of rows) {
        const ham = dateOf(row)
        const key = dayKey(ham, now)
        const son = gruplar[gruplar.length - 1]

        if (son && son.key === key) {
            son.rows.push(row)
            continue
        }

        gruplar.push({ key, date: toDate(ham), rows: [row] })
    }

    return gruplar
}
