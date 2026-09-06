// Every hard figure on the page with its provenance, and the list of things
// that are modelled rather than measured. Pure data, no side effects.
// ════════════════════════════════════════════════════════════════════════════
// SOURCES — every hard number on this page, with its provenance.
// Checked 2026-09-05. Dates are publication dates, not measurement dates.
// Reported figures were still being revised when this was built.
// ════════════════════════════════════════════════════════════════════════════
const SOURCES=[
 {figure:'Reported toll as of 5 September 2026 — Nepal: at least 1,342 dead, 4,886 missing (including 583 foreign nationals from 39 countries), 5,300 injured. Tibet/China: 31 dead, 531 missing as of 4 September. Around 8,317 houses destroyed; 13 hydropower projects damaged, removing 431 MW from the grid; nearly 900 hydropower workers unaccounted for. Preliminary damage estimate Rs 387.54 billion (about US$2.57 bn).',
  status:'REPORTED · STILL CHANGING',date:'2026-09-05',name:'Wikipedia · 2026 Nepal–Tibet floods',url:'https://en.wikipedia.org/wiki/2026_Nepal_floods'},
 {figure:'26 August 2026 collapse on the north flank of Langtang Lirung (7,234 m). Seismically detected: initially reported M 4.4 by USGS, later revised toward Ms 5.2 for the mass movement.',
  status:'REPORTED',date:'2026-08-28',name:'Britannica · Nepal floods of 2026',url:'https://www.britannica.com/event/Nepal-floods-of-2026'},
 {figure:'Failure scar centred near 28.2853° N, 85.5252° E. Rock–ice cascade, not a glacial lake outburst flood. Precise mechanism unresolved.',
  status:'REPORTED / PRELIMINARY',date:'2026-08-27',name:'AntarcticGlaciers.org',url:'https://www.antarcticglaciers.org/2026/08/august-2026-nepal-tibet-floods/'},
 {figure:'The landslide temporarily blocked the Lhende Khola, impounding a lake that then broke through the debris dam. No published timing for either the blockage or the breach.',
  status:'REPORTED / UNTIMED',date:'2026-08-27',name:'AntarcticGlaciers.org',url:'https://www.antarcticglaciers.org/2026/08/august-2026-nepal-tibet-floods/'},
 {figure:'Seismic signal at 08:37 NPT; source near 5,200 m; fall of roughly 1,500 m; first ~22 km covered at approximately 193 km/h (≈54 m/s). Eyewitness accounts give a later time; the discrepancy is unresolved.',
  status:'REPORTED ESTIMATES · CONFLICTING TIMES',date:'2026-08-28',name:'Down To Earth',url:'https://www.downtoearth.org.in/natural-disasters/nepal-floods-what-we-now-know-about-the-glacier-collapse'},
 {figure:'Failure at the confluence of the Trishuli and the Lhende Khola at Gyirong Port / Rasuwagadhi. Combined flow ran roughly 100 km down the Trishuli.',
  status:'REPORTED',date:'2026-08-26',name:'CNN',url:'https://www.cnn.com/2026/08/26/world/live-news/nepal-flash-flooding-floods-intl'},
 {figure:'Probable bedrock-first failure with a fall of about 1,200 m; the role of permafrost thaw remains interpretive rather than established.',
  status:'EXPERT INTERPRETATION · NO CONSENSUS',date:'2026-09-02',name:'The Conversation',url:'https://theconversation.com/the-collapse-of-a-mountainside-triggered-nepals-devastating-floods-as-the-regions-mountains-heat-up-it-wont-be-the-last-290924'},
 {figure:'Affected settlements along the corridor included Timure, Dhunche, Mailung, Syafrubesi, Betrawati, Trishuli and Devighat. Rasuwa district accounts for 140 bodies. Bodies were also recovered along the Trishuli and Narayani in Nuwakot, Dhading, Gorkha, Tanahu, Chitwan and both Nawalparasi districts. No village-by-village casualty breakdown has been published.',
  status:'REPORTED · NO PER-PLACE BREAKDOWN',date:'2026-08-27',name:'Al Jazeera',url:'https://www.aljazeera.com/news/2026/8/27/nepal-tibet-floods-what-happened-what-caused-them-and-who-is-missing'},
 {figure:'Elevation grid: AWS Terrain Tiles (terrarium), zoom 12, public domain, derived from SRTM, ALOS AW3D30 and national datasets. Sampled into a corridor-space grid of 1024 × 224 covering 93.08 km of channel and ±4,200 m either side (≈91 m along, ≈38 m across), quantised to 3 m, deflated, embedded as base64 and decoded in the browser. No imagery of any kind.',
  status:'DATASET · PUBLIC DOMAIN',date:'2026-09-05',name:'AWS Terrain Tiles / Mapzen',url:'https://registry.opendata.aws/terrain-tiles/'},
 {figure:'Channel centreline: traced through the grid by priority-flood depression filling and D8 steepest descent from the scar, 93.08 km to the box edge. Independent check — the traced confluence at Rasuwagadhi falls 29 m from its published coordinate, Syafrubesi 115 m, Betrawati 113 m, Devighat about 300 m.',
  status:'DERIVED FROM THE GRID',date:'2026-09-05',name:'Computed in this build',url:''},
 {figure:'Prime Minister Disaster Relief Fund portal, operated for the Government of Nepal by Nepal Clearing House Limited. Linked from this page as the official donation channel; no payment code is reproduced here.',
  status:'OFFICIAL CHANNEL',date:'2026-09-05',name:'Government of Nepal · PMDRF',url:'https://pmdrf.nchl.com.np/'},
];
const MODELLED=[
 ['Front timing','Front celerity 54.5 m/s to chainage 21.78 km, set so the front reaches the Rasuwagadhi confluence at the reported ~7 minutes; then an exponential relaxation (3.5 km length scale) to 8.5 m/s downstream. Arrival everywhere else follows from that, not from a gauge.'],
 ['Peak stage','20 m at the scar rising to 66 m through the first 6 km of entrainment, decaying to about 10 m at 93 km. The upper value sits inside the reported "tens of metres" in the gorges. No stage was measured for this model.'],
 ['Blockage & breach','Blockage grows T+120 s to T+240 s; impoundment fills to T+480 s; breach incises and widens over 300 s, launching a second pulse. Sources confirm a blockage and a breach but publish no times. This chronology is a hypothesis.'],
 ['Collapse','3 × 10⁶ m³ failure volume, ice mass fraction 0.35, frictional melt efficiency 0.35 over a 1,200 m fall — which converts under 5% of the ice, not "a large fraction". Fragment paths are deterministic ballistics, not granular-flow simulation.'],
 ['Flow solver','A reduced GPU transport of depth, sediment proxy and speed around prescribed analytic hydrographs, with centripetal cross-channel tilt, constriction run-up, junction backwater and eddy slack, and a Manning velocity from the measured bed slope. NOT a conservative 2D shallow-water or debris-rheology model; it cannot establish site-specific inundation.'],
 ['Map dots','The red markers show settlements and sites that lay in the flow path. They are not scaled to casualties and carry no per-place death count, because none has been published.'],
 ['Deposition & damage','Sediment fans, trim line, vegetation stripping and structure exposure follow from modelled stage against grid elevation. Structures are neutral massing at approximate sites, not surveyed footprints.'],
 ['Display extent','93.08 km of traced channel, clipped to ±4.2 km either side. Reported affected extent is longer (~100 km), and bodies were recovered far beyond it. The reported 9 m rise in 30 minutes belongs to Galchhi, outside this extent, and is not assigned to any station shown.'],
 ['Everything else','All colour, texture, noise, sky, fog, particle, vegetation and camera behaviour is procedural. No satellite or aerial imagery, no HDRI, no downloaded model, texture or audio file.'],
];
// Reported toll, shown once, with the source and date attached to each figure.
const TOLL=[
 {n:'1,342',k:'Reported dead · Nepal',src:'at least, as of 5 Sep 2026',red:true},
 {n:'4,886',k:'Reported missing · Nepal',src:'incl. 583 foreign nationals',red:true},
 {n:'31 / 531',k:'Dead / missing · Tibet',src:'as of 4 Sep 2026',red:true},
 {n:'5,300',k:'Reported injured',src:'Nepal, as of 5 Sep 2026'},
 {n:'8,317',k:'Houses destroyed',src:'Nepal, preliminary'},
 {n:'Rs 387.5bn',k:'Preliminary damage',src:'≈ US$2.57 bn, as of 4 Sep 2026'},
];

export { SOURCES, MODELLED, TOLL };
