import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// KAYNAK KILIDI -- oturum yasinin TEK sahibi arka plandir.
//
// Kapatilan hata: main.js acilista `sessionData.timestamp` 15 dakikadan eskiyse
// `chrome.storage.session.clear()` cagiriyordu. Bu, kullanicinin "Kilit suresi"
// ayarindan BAGIMSIZ ikinci bir kuraldi ve secici degildi: sessionMasterKeyJwk
// dahil her seyi siliyor, ama chrome.storage.local'daki `session_active` TRUE
// kaliyordu -- iki taraf ayrisiyordu (isUnlocked false, session_active true).
//
// Yan panelde somut zarar: panel saatlerdir acik ve MESRU sekilde kilitsizken,
// bir dapp istegi icin acilan onay penceresi (AYNI onyukleme kodu) eski damgayi
// gorup TUM oturumu siliyordu -- kullanici tam onaylamak uzereyken.
const main = readFileSync(fileURLToPath(new URL('./main.js', import.meta.url)), 'utf8')

describe('popup onyuklemesi -- oturum yasi arka planin isi', () => {
    it('acilista storage.session.clear cagrilmaz', () => {
        expect(main).not.toMatch(/storage\.session\.clear/)
    })

    it('sessionData damgasi artik yazilmaz', () => {
        expect(main).not.toMatch(/sessionData/)
    })

    it('beforeunload dinleyicisi kalmadi', () => {
        expect(main).not.toMatch(/beforeunload/)
    })

    it('15 dakikalik ikinci sabit kalmadi', () => {
        expect(main).not.toMatch(/15 \* 60 \* 1000/)
    })
})
