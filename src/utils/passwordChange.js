import { deriveMasterKey, randBytes, reencryptVaults, syncActiveAccount, toHex } from './crypto-utils'

// Şifre değiştirme akışının depo işi.
//
// Bilerek `chrome` global'ine dokunmaz, storage enjekte edilir: yazım sırası bu
// akışın en kritik özelliği ve ancak enjeksiyonla birim testine konabiliyor.
//
// SIRA KRİTİK: walletSalt/jwk, kasalardan ÖNCE yazılırsa araya düşen bir hata
// kasaları hem eski hem yeni şifreyle açılamaz bırakır — kalıcı cüzdan kaybı.
// Bu yüzden tüm kripto işi bittikten sonra TEK bir storage.set çağrısı yapılır.
// Bunu birden fazla çağrıya bölmek o bugu geri getirir.
export async function changeWalletPassword({ storage, currentPassword, newPassword }) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
        throw new Error('changeWalletPassword: storage.get/set gerekli')
    }
    if (!currentPassword || !newPassword) {
        throw new Error('changeWalletPassword: mevcut ve yeni şifre gerekli')
    }

    const { vaults, walletSalt, active_account } = await storage.get([
        'vaults', 'walletSalt', 'active_account'
    ])
    if (!vaults || !walletSalt) throw new Error('Kasa verisi bulunamadı')

    const saltHex = walletSalt.startsWith('0x')
        ? walletSalt.slice(2)
        : walletSalt

    const globalSalt = new Uint8Array(
        saltHex.match(/.{1,2}/g).map(b => parseInt(b, 16))
    )

    const masterKey = await deriveMasterKey(currentPassword, globalSalt)

    const newGlobalSalt = randBytes(32)
    const newMasterKey = await deriveMasterKey(newPassword, newGlobalSalt)

    // Kasalar ve içlerindeki importedSecret blob'ları bellekte yeniden şifrelenip
    // tek tek doğrulanır. Buraya kadar depoya hiçbir şey yazılmaz: hata olursa
    // eski şifre çalışmaya devam eder.
    const newVaults = await reencryptVaults(vaults, masterKey, newMasterKey)
    const newActiveAccount = syncActiveAccount(active_account, newVaults)

    // Master key diske yazılmaz; yalnızca yeni salt ve yeniden şifrelenmiş kasalar.
    //
    // needsPasswordRotation aynı yazımda temizlenir: rotasyon önerisi tam da bu
    // işlemle karşılanıyor. Ayrı bir yazım olsaydı araya düşen bir hata uyarıyı
    // gereksiz yere gösterilir halde bırakabilirdi.
    const changes = {
        walletSalt: toHex(newGlobalSalt),
        vaults: newVaults,
        needsPasswordRotation: false
    }

    // syncActiveAccount değişiklik gerekmiyorsa aynı referansı döner.
    if (newActiveAccount !== active_account) changes.active_account = newActiveAccount

    await storage.set(changes)
}
