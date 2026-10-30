// Extra map glyphs kept separate from the large shared marker catalogue.
export const EXTRA_SVG = {
  // Non-specific projectile/reticle: does not imply a rifle or pistol.
  weapon: '<g><path fill-rule="evenodd" d="M256 66a190 190 0 1 0 0 380a190 190 0 0 0 0-380zm0 38a152 152 0 1 1 0 304a152 152 0 0 1 0-304z"/><path d="M34 244h116v24H34zm328 0h116v24H362zM244 34h24v116h-24zm0 328h24v116h-24z"/><path d="M256 166l57 68v68l-57 44-57-44v-68z"/></g>',
  urgent_warning: '<path d="M256 42 475 430H37z" fill="none" stroke="currentColor" stroke-width="34" stroke-linejoin="round"/><path d="M237 154h42l-9 174h-24z"/><circle cx="256" cy="375" r="23"/>',
  explosion_modern: '<path d="M256 30l32 82 74-44-8 92 98 6-67 70 75 70-95 24 26 94-93-32-42 88-41-88-93 32 26-94-95-24 75-70-67-70 98-6-8-92 74 44z"/><circle cx="256" cy="256" r="54" fill="none" stroke="currentColor" stroke-width="25"/>',
  fire_modern: '<path d="M256 36c18 53 75 77 75 161 38-16 52-45 56-76 39 40 72 95 72 164 0 116-88 197-203 197S53 401 53 285c0-70 36-135 94-185-6 50 3 82 34 111 9-75 34-128 75-175z"/><path d="M256 234c-35 43-59 79-59 122a59 59 0 1 0 118 0c0-38-22-85-59-122z" fill="#fef3c7"/>',
  civil_shield: '<path d="M256 36 437 106v137c0 110-73 188-181 233-108-45-181-123-181-233V106z" fill="none" stroke="currentColor" stroke-width="30" stroke-linejoin="round"/><path d="M224 158h64v66h66v64h-66v66h-64v-66h-66v-64h66z"/>',
  // Side-profile rifle silhouette used only when the report explicitly says rifle / AK.
  rifle: '<g><path d="M24 222h54v-34h43v34h43l19-22h145l19 10h43l15 14h91v18h-91l-15 14h-44l-20 17h-55l-12 48h-25l-15-57h-66l-19-15h-25l-22 20H77l12-25-65-12z"/><path d="M187 280h67l21 73-27 8-25-56h-36z"/><path d="M277 278h34l-8 38h-28l-17-29z"/><path d="M190 194h144v13H190z"/><path d="M335 206h22v-20h12v20h12v16h-46z"/><path d="M74 214h20v34H74z"/></g>',
  // Side-profile pistol silhouette used only when the report explicitly says pistol / handgun.
  pistol: '<g><path d="M56 176h321l56 26v57H313v-26H174v24l-17 104H82l36-132H56z"/><path d="M172 233h144v20H172z"/><path d="M316 259h67v18h-67z"/><path d="M195 177h142v-15h26v15h44v18H195z"/><path d="M211 260h39v42h-39z"/></g>',
};
