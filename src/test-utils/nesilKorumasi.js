// Zaman asimina ugrayan testin GOVDESI, vitest onu "basarisiz" sayip bir sonraki teste gectikten sonra da calismaya
// devam eder: bir `await`'ten uyanir ve SONRAKI testin globalThis.chrome'u uzerinde tabs.query/sendMessage cagirir
// ('[5,5]' vs '[5]' kaymasi, T28/T29). Test icinde bunu onlemenin yolu yoktur; bu yardimci KAYNAGINI keser:
//
//   const kor = nesilKorumasi()
//   beforeEach(() => { kor.yeniNesil() })
//   const yukle = () => kor.sarmala(() => import('./modul.js'))
//   ... testte: const m = await yukle()
//
// `sarmala(f)`: f() cozulene kadar nesil degistiyse (yani bu govdenin testi bitti, sonraki test basladi) donen
// promise ASLA cozulmez; bayat govde orada ASILI kalir ve sonraki testin chrome'una dokunmaz. Nesil
// degismediyse f()'nin sonucu aynen doner (hata da aynen yayilir).
export function nesilKorumasi() {
    let nesil = 0
    return {
        yeniNesil: () => { nesil++ },
        sarmala: async (f) => {
            const buNesil = nesil
            const sonuc = await f()
            if (nesil !== buNesil) return new Promise(() => {})
            return sonuc
        },
    }
}
