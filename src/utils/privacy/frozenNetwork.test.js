import { describe, it, expect } from 'vitest'
import { fakeStorage } from '../../test-utils/fakeStorage'
import { FROZEN_NETWORK_KEY, dappVisibleNetwork, readPrivacyView } from './frozenNetwork'

// Sitelerin GORDUGU ag (P5, spec 4.9): donmus kayit VARKEN hesap turune bakilmaksizin kayit; kayit
// yokken canli ag. Kayit giriste yazilir, cikista (finishPrivacyExit) silinir.
const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
const ETH = { chainId: 1, name: 'Ethereum' }
const POLYGON = { chainId: 137, name: 'Polygon' }

const depo = (extra = {}) => fakeStorage({
    vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }],
    currentNetwork: POLYGON,
    ...extra,
})

describe('readPrivacyView', () => {
    it('kayit yokken frozen undefined; girerken ag kaydi yoktuysa saklanan null olarak korunur', async () => {
        expect((await readPrivacyView(depo({ active_account: A }))).frozen).toBeUndefined()
        expect((await readPrivacyView(depo({ active_account: A, [FROZEN_NETWORK_KEY]: null }))).frozen).toBeNull()
        expect((await readPrivacyView(depo({ active_account: A, [FROZEN_NETWORK_KEY]: ETH }))).frozen).toEqual(ETH)
    })

    it('isPrivate KIMLIKLE belirlenir: bayragi dusmus Gizli Hesap kopyasi da gizlidir', async () => {
        const bayraksiz = { key: 'g-1', address: GIZLI.address, type: 'hd' }
        expect((await readPrivacyView(depo({ active_account: GIZLI }))).isPrivate).toBe(true)
        expect((await readPrivacyView(depo({ active_account: bayraksiz }))).isPrivate).toBe(true)
        expect((await readPrivacyView(depo({ active_account: A }))).isPrivate).toBe(false)
    })
})

describe('dappVisibleNetwork', () => {
    it('Gizli modda kayit varsa kayit doner, canli ag degil (A-I3)', async () => {
        const storage = depo({ active_account: GIZLI, [FROZEN_NETWORK_KEY]: ETH })
        expect(await dappVisibleNetwork(storage)).toEqual(ETH)
    })

    it('GENEL modda da kayit varsa kayit doner: hesap yazildi, onarim ve geri yazim henuz olmadi penceresi (P5)', async () => {
        const storage = depo({ active_account: A, [FROZEN_NETWORK_KEY]: ETH })
        expect(await dappVisibleNetwork(storage)).toEqual(ETH)
    })

    it('KONTROL: kayit yokken iki modda da canli ag doner', async () => {
        expect(await dappVisibleNetwork(depo({ active_account: A }))).toEqual(POLYGON)
        expect(await dappVisibleNetwork(depo({ active_account: GIZLI }))).toEqual(POLYGON)
    })

    it('girerken ag kaydi yoktuysa (null) siteler "ag yok" gorur: iki modda da undefined, canli ag sizmaz', async () => {
        expect(await dappVisibleNetwork(depo({ active_account: GIZLI, [FROZEN_NETWORK_KEY]: null }))).toBeUndefined()
        expect(await dappVisibleNetwork(depo({ active_account: A, [FROZEN_NETWORK_KEY]: null }))).toBeUndefined()
    })

    it('kayit silinince (finishPrivacyExit) Genel modda canli ag geri gelir', async () => {
        const storage = depo({ active_account: A, [FROZEN_NETWORK_KEY]: ETH })
        expect(await dappVisibleNetwork(storage)).toEqual(ETH)
        delete storage.data[FROZEN_NETWORK_KEY]
        expect(await dappVisibleNetwork(storage)).toEqual(POLYGON)
    })
})
