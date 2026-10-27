// Extra map glyphs kept separate from the large shared marker catalogue.
export const EXTRA_SVG = {
  // Non-specific projectile/reticle: does not imply a rifle or pistol.
  weapon: '<g><path fill-rule="evenodd" d="M256 66a190 190 0 1 0 0 380a190 190 0 0 0 0-380zm0 38a152 152 0 1 1 0 304a152 152 0 0 1 0-304z"/><path d="M34 244h116v24H34zm328 0h116v24H362zM244 34h24v116h-24zm0 328h24v116h-24z"/><path d="M256 166l57 68v68l-57 44-57-44v-68z"/></g>',
  // Side-profile rifle silhouette used only when the report explicitly says rifle / AK.
  rifle: '<g><path d="M24 222h54v-34h43v34h43l19-22h145l19 10h43l15 14h91v18h-91l-15 14h-44l-20 17h-55l-12 48h-25l-15-57h-66l-19-15h-25l-22 20H77l12-25-65-12z"/><path d="M187 280h67l21 73-27 8-25-56h-36z"/><path d="M277 278h34l-8 38h-28l-17-29z"/><path d="M190 194h144v13H190z"/><path d="M335 206h22v-20h12v20h12v16h-46z"/><path d="M74 214h20v34H74z"/></g>',
  // Side-profile pistol silhouette used only when the report explicitly says pistol / handgun.
  pistol: '<g><path d="M56 176h321l56 26v57H313v-26H174v24l-17 104H82l36-132H56z"/><path d="M172 233h144v20H172z"/><path d="M316 259h67v18h-67z"/><path d="M195 177h142v-15h26v15h44v18H195z"/><path d="M211 260h39v42h-39z"/></g>',
};
