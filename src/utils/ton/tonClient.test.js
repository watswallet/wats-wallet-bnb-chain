import { describe, it, expect, beforeEach } from 'vitest'
import { getTonClient } from './tonClient'

describe('getTonClient', () => {
    beforeEach(() => {
        // Her test için cache'i sıfırla — cache'i global state kullanıyor
        // Import sonrası direkt cache sıfırlanmıyor, ama ayrı apiBase
        // kullanarak isolation yaparız. Test 3 aynı apiBase ile cache testi yapacak.
    })

    it('uç doğru kuruluyor', () => {
        const client = getTonClient('https://x.com')
        expect(client.parameters.endpoint).toBe('https://x.com/ton/rpc')
    })

    it('sondaki eğik çizgi çift eğik çizgiye yol açmıyor', () => {
        const client = getTonClient('https://x.com/')
        expect(client.parameters.endpoint).toBe('https://x.com/ton/rpc')
    })

    it('birden çok sondaki eğik çizgi temizleniyor', () => {
        const client = getTonClient('https://x.com///')
        expect(client.parameters.endpoint).toBe('https://x.com/ton/rpc')
    })

    it('aynı apiBase aynı örneği döndürüyor (cache çalışıyor)', () => {
        const client1 = getTonClient('https://cache-test.com')
        const client2 = getTonClient('https://cache-test.com')
        expect(client1).toBe(client2)
    })

    it('farklı apiBase YENİ örnek üretiyor — ortam değişiminde yanlış sunucuya istek gitmesini engeller', () => {
        const client1 = getTonClient('https://dev.api.com')
        const client2 = getTonClient('https://prod.api.com')

        expect(client1).not.toBe(client2)
        expect(client1.parameters.endpoint).toBe('https://dev.api.com/ton/rpc')
        expect(client2.parameters.endpoint).toBe('https://prod.api.com/ton/rpc')
    })

    it('boş string hata veriyor', () => {
        expect(() => getTonClient('')).toThrow('TON_API_BASE_MISSING')
    })

    it('null hata veriyor', () => {
        expect(() => getTonClient(null)).toThrow('TON_API_BASE_MISSING')
    })

    it('undefined hata veriyor', () => {
        expect(() => getTonClient(undefined)).toThrow('TON_API_BASE_MISSING')
    })

    it('yalnızca boşluktan oluşan apiBase hata veriyor', () => {
        expect(() => getTonClient('   ')).toThrow('TON_API_BASE_MISSING')
    })

    it('baş/son boşluk + sondaki eğik çizgi temizleniyor', () => {
        // .env dosyalarında satır sonu boşluğu yaygın: VITE_API_URL="  https://y.com/  "
        // Yanlış sırada trim/replace olursa "  https://y.com/  ".replace(/\/+$/, '')
        // hiç bir şey yapmaz ($ sonundaki boşluk bulur, / değil) ve sonra trim()
        // yapınca "https://y.com/" kalır → çift eğik çizgi: "https://y.com//ton/rpc"
        // Sunucuda 404 hatası verir. Doğru sıra: trim() sonra replace().
        const client = getTonClient('  https://y.com/  ')
        expect(client.parameters.endpoint).toBe('https://y.com/ton/rpc')
    })

    it('baş/son boşluk tek başına temizleniyor', () => {
        // Sıfır eğik çizgi durumu da çalışması gerekir
        const client = getTonClient('  https://x.com  ')
        expect(client.parameters.endpoint).toBe('https://x.com/ton/rpc')
    })
})
