import { bootstrapWalletUi } from '../shared/bootstrap'
import { SURFACE_PANEL } from '../utils/uiSurface'

// Ucuncu duzen modu. popup/style.css html/body/#app'i 360x600'e `!important`
// ile kilitliyor; bu sinif o kilidi panelde gevsetir (bkz. style.css'teki
// `html.side-panel` blogu). Sinifi Vue mount'undan ONCE koymak sart: aksi halde
// ilk cizim 360px genisliginde olur ve panel gozle gorulur sekilde ziplar.
document.documentElement.classList.add('side-panel')

bootstrapWalletUi({ surface: SURFACE_PANEL })
