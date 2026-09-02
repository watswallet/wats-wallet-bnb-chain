// composables/useNetworkManager.js veya store action'ı

export const useNetworkManager = () => {
    
    // RPC başarısız olduğunda çağrılacak fonksiyon
    const rotateRPC = async (currentNetwork) => {        
        const currentRpcUrl = network.rpc; // Global state'den gelen mevcut URL
        
        // Mevcut RPC dışındaki diğerlerini al
        const availableRpcs = currentNetwork.rpc
            .map(r => r.url)
            .filter(url => url !== currentRpcUrl);

        if (availableRpcs.length === 0) {
            return;
        }

        // Kalanlar arasından en hızlısını bul (veya rastgele seç)
        const fastest = await findFastestRPC(availableRpcs);
        
        if (fastest) {
            network.rpc = fastest.url; // State'i güncelle
            return fastest.url;
        }
    };

    // Provider isteğini saran güvenli fonksiyon (Wrapper)
    // Bunu sendTransaction veya getBalance gibi yerlerde kullanabilirsin
    const safeRequest = async (requestFn) => {
        try {
            return await requestFn();
        } catch (error) {
            // Hata bir ağ hatası veya sunucu hatası mı?
            const isNetworkError = error.code === 'NETWORK_ERROR' || 
                                   error.code === 'SERVER_ERROR' || 
                                   error.code === 'TIMEOUT' ||
                                   error.message.includes('rate limit');

            if (isNetworkError) {
                // RPC değiştir ve tekrar dene
                const { currentNetwork } = await chrome.storage.local.get('currentNetwork');
                await rotateRPC(currentNetwork);
                
                // (Opsiyonel) Rekürsif olarak işlemi tekrar dene:
                // return await requestFn(); 
                // Not: Sonsuz döngüye girmemesi için sayaç koymak gerekir.
            }
            throw error;
        }
    };

    return { rotateRPC, safeRequest };
};