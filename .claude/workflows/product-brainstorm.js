export const meta = {
  name: 'product-brainstorm',
  description:
    'Brainstorm a new product idea: research market, competitors, users, MVP scope, business model, feasibility and risks in parallel, cross-check, then synthesize a decision brief into docs/brainstorm/.',
  phases: ['Research (fan-out)', 'Cross-check', 'Synthesize brief'],
};

// ---------------------------------------------------------------------------
// Dynamic workflow for early-stage product brainstorming (pre-/requirements).
//
// Run it interactively in Claude Code:
//     /product-brainstorm "app mobile du lich phuot xe may tai Viet Nam (iOS + Android)"
//
// `args` is a string (one idea) or an array (many ideas).
// Output is a decision brief, NOT a spec: it ends with options + open questions
// for the human to decide. Feed the chosen direction into /requirements.
// Date.now()/Math.random() are disabled inside workflow scripts, so slugs use
// string ops only.
// ---------------------------------------------------------------------------

const ideas = (Array.isArray(args) ? args : [args])
  .filter(Boolean)
  .map((t) => String(t).trim());

if (ideas.length === 0) {
  log('No idea given. Try: /product-brainstorm "app phuot xe may Viet Nam"');
  return [];
}

const slug = (t) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const ANGLES = [
  {
    key: 'market',
    ask: (t) =>
      `Research the market for: "${t}". Size of the segment (riders / trips / spend), growth trend, seasonality, and the regional split (e.g. Northern mountain loops vs Central coast). Separate domestic users from foreign tourists. Cite sources and flag any number you could not verify.`,
  },
  {
    key: 'competitors',
    ask: (t) =>
      `Map the competitive landscape for: "${t}". Cover local players (e.g. Namduro, RoadTips, community forums/Facebook groups) AND global players (Calimoto, Kurviger, REVER, Komoot, Maps.me, Google Maps). For each: what it does, pricing, store rating / install signals, whether it is still actively maintained, and its weak spot for this market. Cite sources.`,
  },
  {
    key: 'users',
    ask: (t) =>
      `Research the users for: "${t}". Build 3-4 evidence-based personas (e.g. solo rider, group/convoy rider, foreign tourist, weekend commuter-turned-tourer). For each: jobs-to-be-done, current workaround (Google Maps, Zalo/Facebook groups, paper), top pain points on the road (no signal, bad roads, fuel, breakdown, safety). Cite sources.`,
  },
  {
    key: 'features',
    ask: (t) =>
      `Propose candidate feature areas for: "${t}" and rank them by user value vs build cost: route planning/discovery, offline maps, group live-location, trip journal, road-condition/hazard reports, POIs (fuel, repair, homestay), SOS, marketplace/booking. Recommend a minimal MVP (3-5 features) and what to defer. Ground claims in what existing apps do or users ask for. Cite sources.`,
  },
  {
    key: 'business',
    ask: (t) =>
      `Research monetization for: "${t}". Compare subscription (Calimoto-style), freemium, commissions from homestay/rental/repair partners, ads, sponsorship from motorbike brands, and B2B (tour operators). Give realistic price points for Vietnam and willingness-to-pay signals. Cite sources.`,
  },
  {
    key: 'feasibility',
    ask: (t) =>
      `Assess technical feasibility for: "${t}" on iOS + Android. Compare cross-platform options (Flutter vs React Native vs native), map stack and data (OpenStreetMap coverage in rural Vietnam, Mapbox / MapLibre / Google Maps pricing, offline tiles), background GPS and battery limits, backend choice, and the cold-start content problem (who supplies routes and POIs). Cite sources.`,
  },
  {
    key: 'risks',
    ask: (t) =>
      `Identify the biggest risks for: "${t}": rider safety and liability (route advice, use while riding), Vietnam data/location regulations, map data licensing, user-generated-content moderation, cold-start / network effects against free Facebook groups, and app-store policy (background location). Rank by severity and suggest a mitigation each. Cite sources.`,
  },
];

const findingSchema = {
  type: 'object',
  required: ['angle', 'summary', 'points', 'sources'],
  properties: {
    angle: { type: 'string' },
    summary: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string' } },
  },
};

const results = await pipeline(ideas, async (idea) => {
  phase('Research (fan-out)');
  const findings = await parallel(
    ANGLES.map((angle) => () =>
      agent(angle.ask(idea), {
        label: `${idea.slice(0, 30)} · ${angle.key}`,
        schema: findingSchema,
      }),
    ),
  );
  const kept = findings.filter(Boolean);

  phase('Cross-check');
  const verified = await agent(
    `You are a skeptical product analyst reviewing research for the idea "${idea}".\n` +
      `Below are findings as JSON. Flag any claim that is unsupported, outdated, ` +
      `contradicted across angles, or that looks like a guessed market number. ` +
      `Drop or caveat it. Mark each retained claim as VERIFIED or ASSUMPTION. ` +
      `Return corrected, deduplicated findings plus a "verification_notes" list.\n\n` +
      JSON.stringify(kept),
    { label: `${idea.slice(0, 30)} · verify` },
  );

  phase('Synthesize brief');
  const synth = await agent(
    `Write a product-brainstorm decision brief in VIETNAMESE for "${idea}" and SAVE it to ` +
      `docs/brainstorm/${slug(idea)}.md (create the directory if needed).\n\n` +
      `Use this exact section order: Title + one-line "Date" line; ` +
      `1. Tom tat y tuong va gia dinh; 2. Thi truong; 3. Doi thu (bang so sanh); ` +
      `4. Nguoi dung / personas; 5. Khoang trong co the khai thac; ` +
      `6. Ba huong san pham (A/B/C) voi uu-nhuoc va de xuat cua ban; ` +
      `7. MVP de xuat; 8. Mo hinh doanh thu; 9. Kha thi ky thuat; ` +
      `10. Rui ro; 11. Cau hoi mo can nguoi quyet dinh; 12. Nguon.\n\n` +
      `Base it ONLY on the cross-checked findings. Label every ASSUMPTION clearly and do not ` +
      `invent numbers. This is a brief, NOT a spec: do not write code or scaffold anything. ` +
      `After writing, reply with the file path and a 3-bullet TL;DR.\n\n` +
      `CROSS-CHECKED FINDINGS:\n` +
      JSON.stringify(verified),
    { label: `${idea.slice(0, 30)} · synthesize` },
  );

  log(`Done: ${idea} -> docs/brainstorm/${slug(idea)}.md`);
  return { idea, slug: slug(idea), result: synth };
});

return results.filter(Boolean);
