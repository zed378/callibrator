/**
 * The pre-paint theme script (ADR-118 Am. 3, ADR-122 §5), rendered inline by
 * the root layout through `ThemeInitScript` with the request's CSP nonce.
 *
 * Before first paint it puts <html> in the state `lib/theme.ts` maintains:
 *   - a stored choice (`hdc-theme-preference` = light | dark) → `.dark` if dark,
 *     and `data-theme-choice` = the choice;
 *   - no choice → no `data-theme-choice`, and `.dark` from the device's
 *     `prefers-color-scheme` (P11-Q4 A: follow the device until the user
 *     chooses — the dashboard used to stay light here, spec P11-00 D10);
 *   - while nothing is chosen, a device change flips `.dark` live.
 *
 * It lives in its own module so only the server layout imports it: the public
 * client bundles never carry the string.
 */
export const THEME_INIT_SCRIPT =
  "(function(){try{var d=document.documentElement,t=null," +
  "m=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;" +
  "try{t=localStorage.getItem('hdc-theme-preference');}catch(e){}" +
  "if(t==='dark'||t==='light'){d.setAttribute('data-theme-choice',t);d.classList.toggle('dark',t==='dark');}" +
  "else{d.removeAttribute('data-theme-choice');d.classList.toggle('dark',!!(m&&m.matches));}" +
  "if(m&&m.addEventListener){m.addEventListener('change',function(e){if(!d.hasAttribute('data-theme-choice'))d.classList.toggle('dark',e.matches);});}" +
  "}catch(e){}})();";
