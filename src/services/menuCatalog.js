// src/services/menuCatalog.js

// ── Menu item → regular price lookup ─────────────────────────────────────────
export const menuCatalog = {
  // Burgers & Sandwiches
  "cheeseburger": 18,
  "pressed chicken sandwich": 14,
  "smoked gouda jalapeno bratwurst": 14,
  "smoked brisket reuben": 16,
  "italian sandwich": 22,

  // Salads
  "wedge salad": 15,
  "caprese salad": 16,
  "chef's salad": 14,
  "salmon salad": 20,

  // Dinner apps & entrees
  "brisket tacos": 15,
  "smoked chicken wings": 14,
  "angel hair pasta": 22,
  "cauliflower fritters": 14,
  "beef tips": 26,
  "roasted corn dip": 20,
  "crab cakes": 16,
  "black cod": 24,
  "smoked salmon": 24,
  "sea scallops": 26,
  "chilled smoked shrimp gazpacho": 18,

  // Meat & Poultry
  "short rib": 28,
  "filet mignon": 60,
  "wagyu beef": 6,  // per ounce
  "duroc pork tenderloin": 26,
  "bucatini": 24,
  "ancho chipotle chicken": 22,
  "14 hour smoked brisket": 30,
  "korean pork ribs": 26,
  "chef's butcher board": 140,

  // Vegetables & Sides
  "caramelized brussel sprouts": 14,
  "wood fired carrots": 14,
  "green beans": 16,
  "pesto risotto": 20,
  "grilled pave potatoes": 14,

  // Desserts
  "lemon curd": 8,
  "coconut crusted pineapple": 12,
  "cinnamon roll ice cream sandwich": 14,
  "eclairs": 10,
  "ice cream": 8,
  "peanut butter cups": 8,

  // Cocktails
  "crosby": 11,
  "matchstick manhattan": 15,
  "espresso martini": 16,
  "holy mole": 15,
  "paper plane": 15,
  "knockin on heavens door": 15,
  "spritz al lampone": 14,
  "monkeys in a barrel": 14,
  "seoul tea": 15,
  "el vampiro": 16,
  "pisco disco": 15,
  "just a dillusion": 15,
  "blissful bubbles": 14,
  "the last lager": 14,

  // NA Cocktails
  "last call for alcohol": 9,
  "mock-scow mule": 9,
  "faux 75": 10,
  "phony negroni": 10,
  "lavender lush": 10,
  "naperol spritz": 10,

  // Wines (assume full-bottle price)
  "daou cabernet": 64,
  "routestock cabernet": 75,
  "caymus grand durif": 64,
  "cooper pinot noir": 75,
  "catena malbec": 60,
  "laboure roi pinot noir": 56,
  "familia valdelana": 56,
  "anne collard": 48,
  "chateau de costis": 48,
  "monte rio zinfandel": 60,
  "treffethen chardonnay": 58,
  "santa julia chardonnay": 40,
  "muri gries pinot bianco": 58,
  "pullus pinot grigio": 56,
  "paolo saracco moscato": 48,
  "huia sauvignon blanc": 54,
  "hedges sauvignon blanc": 48,
  "bisol prosecco": 48,
  "domaine bousquet sparkling rose": 48,
  "peyra rose": 54,
  "newfound rose": 58,

  // Dessert wines
  "roumieu lacoste sauternes": 30,
  "taylor 10 year port": 48,
  "yalumba 50 tawny": 110,
  "dal forno romano": 200
};

// ── Light aliasing for common phrasing/plurals ──────────────────────────────
const ALIASES = {
  "caramelized brussel sprouts": ["caramelized brussels sprouts", "brussels sprouts", "brussel sprouts"],
  "cinnamon roll ice cream sandwich": ["ice cream sandwich"],
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalize(s = "") {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function escapePhraseForRegex(phrase) {
  // allow flexible whitespace between words
  return phrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
}
function buildPattern(name) {
  const variants = [name, ...(ALIASES[name] || [])];
  const parts = variants.map(v => escapePhraseForRegex(v));
  return new RegExp(`(?:^|\\b)(?:${parts.join('|')})(?:\\b|$)`, 'gi');
}

// ── Smarter revenue estimator (counts quantities; Wagyu per-oz) ─────────────
export function estimateOrderRevenue(message) {
  const text = normalize(message || "");
  if (!text) return 0;

  let total = 0;

  for (const [item, price] of Object.entries(menuCatalog)) {
    const pattern = buildPattern(item);

    // Special handling: Wagyu priced per ounce
    if (item === "wagyu beef") {
      // e.g., "6oz wagyu beef", "10 ounces wagyu beef"
      const wagyu = new RegExp(
        String.raw`(?:^|\b)(\d{1,3})\s*(?:oz|ounce|ounces)\s*(?:of\s+)?(?:wagyu\s+beef)(?:\b|$)`,
        'gi'
      );
      let m;
      let matched = false;
      while ((m = wagyu.exec(text)) !== null) {
        matched = true;
        const oz = parseInt(m[1], 10) || 1;
        total += oz * price;
      }
      // fallback: if they said "wagyu beef" but no ounces, count as 1 oz
      if (!matched) {
        let k;
        while ((k = pattern.exec(text)) !== null) {
          total += price; // assume 1 oz if unspecified
        }
      }
      continue;
    }

    // Generic items: optional leading quantity like "2 cheeseburgers" or "2x cheeseburger"
    // We match quantities per occurrence to avoid double-counting across aliases.
    const qtyPattern = new RegExp(
      String.raw`(?:^|\b)(?:([1-9]\d?)\s*(?:x)?\s*)?(?:${buildPattern(item).source.slice(7, -4)})`,
      'gi'
    );

    let m;
    while ((m = qtyPattern.exec(text)) !== null) {
      const qty = parseInt(m[1], 10) || 1;
      total += qty * price;
    }
  }

  return total;
}
