import { addressesFor, buildApproveCallData, buildCollectorApproveCallData } from './gasless'

/**
 * `/paymaster/status`'ün döndürdüğü `nextSteps`'i çalıştırılabilir op'lara çevirir.
 *
 * Adımların İÇERİĞİNE burada karar verilmez — hangi adımların gerektiğini backend söyler
 * (`server/status.ts`). Bu dosya yalnız "adım -> callData" çevirisidir. Karar mantığını
 * buraya taşımak, kaçınmak için uğraştığımız ikinci-uygulama sorununu geri getirirdi.
 */
export type NextStepLike = {
    chainId: number
    action: 'approve-paymaster' | 'approve-collector'
    suggestedAmount?: string
}

export interface OnboardingOp {
    chainId: number
    callData: `0x${string}`
    /**
     * EKLENTİ FARKI: adımın kaynak `action`'ı op'un ÜZERİNDE taşınır.
     *
     * Sebep: cüzdan her op'u `/sponsor`'un döneceği modla karşılaştırır
     * (`assertSponsorModeConsistent`) ve bu mod adıma göre DEĞİŞİR — `approve-paymaster`
     * tanım gereği bootstrap op'udur (BSC'de paymaster izni HENÜZ yoktur; zaten bu yüzden
     * ikinci adım normal olabiliyor), `approve-collector` ise normaldir.
     *
     * Bu bilgiyi `nextSteps` dizisiyle İNDEKS EŞLEŞTİREREK türetmek, `stepsToOps`'un sonsuza
     * kadar 1:1 `map` kalacağı varsayımına dayanırdı; satıcı bir adımı filtreleyip ya da iki
     * op'a bölerse eşleşme SESSİZCE kayar ve tam da düzeltilen hatayı geri getirir (yanlış
     * beklenen mod -> adres başına 3 ile sınırlı bootstrap hakkının yanması). Op'un kendini
     * tanımlaması bu kaymayı imkânsız kılar.
     */
    action: NextStepLike['action']
    /** Kullanıcıya gösterilecek kısa etiket. */
    label: string
}

export function stepsToOps(steps: NextStepLike[], collector: string): OnboardingOp[] {
    return steps.map((s) => {
        const a = addressesFor(s.chainId)
        if (s.action === 'approve-paymaster') {
            // Bootstrap callData'sı byte düzeyinde TAM OLARAK "paymaster'a sınırsız approve"
            // olmak zorunda (deposit drenajı savunması) — bu yüzden tutar parametresi yok.
            return {
                chainId: s.chainId, action: s.action,
                callData: buildApproveCallData(a.ats, a.paymaster), label: 'paymaster izni',
            }
        }
        // Toplayıcı izni SINIRSIZ VERİLMEZ: paymaster'dan farklı olarak toplayıcı bir sıcak
        // anahtarla tetiklenir, izin kullanıcının kabul ettiği gaz bütçesi kadar olmalıdır.
        // Tutar eksikse sessizce sınırsıza düşmek yerine FIRLAT.
        if (!s.suggestedAmount) {
            throw new Error('approve-collector adımında suggestedAmount eksik — sınırsız izne düşülmez')
        }
        return {
            chainId: s.chainId,
            action: s.action,
            callData: buildCollectorApproveCallData(a.ats, collector, BigInt(s.suggestedAmount)),
            label: 'toplayıcı izni',
        }
    })
}
