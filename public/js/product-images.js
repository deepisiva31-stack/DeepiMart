// Product-default image resolution.
//
// DeepiMart relies on this helper everywhere a product image is rendered.
// Rules:
//   * If a farmer uploaded a photo, that photo is ALWAYS used (never replaced).
//   * Otherwise a default image is chosen from the product name (matched
//     case-insensitively, with common country/plural spelling variants).
//   * If the name is not recognised, a category-appropriate generic image is
//     used, falling back to a plain fresh-produce image. Never a broken link.
(function () {
  'use strict';

  window.DM = window.DM || {};

  var IMG_DIR = '/assets/images';

  // Canonical key -> image file name.
  var FILES = {
    tomato: 'tomato.svg',
    onion: 'onion.svg',
    potato: 'potato.svg',
    carrot: 'carrot.svg',
    brinjal: 'brinjal.svg',
    cabbage: 'cabbage.svg',
    cauliflower: 'cauliflower.svg',
    okra: 'okra.svg',
    banana: 'banana.svg',
    mango: 'mango.svg',
    apple: 'apple.svg',
    rice: 'rice.svg',
    wheat: 'wheat.svg',
    corn: 'corn.svg',
  };

  // Common alternative spellings / local names for the same produce.
  var ALIASES = {
    tomato: ['tomato', 'tomatoes'],
    onion: ['onion', 'onions'],
    potato: ['potato', 'potatoes', 'irish potato'],
    carrot: ['carrot', 'carrots'],
    brinjal: ['brinjal', 'brinjals', 'eggplant', 'eggplants', 'aubergine'],
    cabbage: ['cabbage', 'cabbages'],
    cauliflower: ['cauliflower', 'cauliflowers'],
    okra: ['okra', 'lady finger', 'lady fingers', 'ladyfinger', 'ladyfingers', 'bhindi'],
    banana: ['banana', 'bananas', 'matooke'],
    mango: ['mango', 'mangoes', 'mangos'],
    apple: ['apple', 'apples'],
    rice: ['rice', 'paddy'],
    wheat: ['wheat'],
    corn: ['corn', 'maize'],
  };

  // Fallback image per product category when the name is not recognised.
  var CATEGORY_FILES = {
    vegetables: 'vegetables.svg',
    fruits: 'fruits.svg',
    grains: 'grains.svg',
    grainscereals: 'grains.svg',
    tubers: 'tubers.svg',
    tubersroots: 'tubers.svg',
    dairy: 'dairy.svg',
    meat: 'meat.svg',
    poultrymeat: 'meat.svg',
    produce: 'produce.svg',
  };

  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRe(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function keyForName(name) {
    var text = normalize(name);
    if (!text) return null;
    var keys = Object.keys(ALIASES);
    for (var i = 0; i < keys.length; i++) {
      var aliases = ALIASES[keys[i]];
      for (var j = 0; j < aliases.length; j++) {
        // Word-boundary match that also tolerates the common plural suffixes
        // ("Tomatoes" -> tomato, "Mangoes" -> mango) while rejecting plain
        // substrings ("Pineapple" does not match "Apple").
        var re = new RegExp('(^|[^a-z0-9])' + escapeRe(aliases[j]) + '(s|es)?(?=$|[^a-z0-9])');
        if (re.test(text)) return keys[i];
      }
    }
    return null;
  }

  function categoryFile(categoryName) {
    var key = normalize(categoryName).replace(/\s+/g, '');
    return CATEGORY_FILES[key] || null;
  }

  function defaultProductImage(name, categoryName) {
    var key = keyForName(name);
    if (key && FILES[key]) return IMG_DIR + '/' + FILES[key];
    var cat = categoryFile(categoryName);
    if (cat) return IMG_DIR + '/' + cat;
    return IMG_DIR + '/produce.svg';
  }

  // Accepts any product-like object with an optional uploaded photo and a
  // name field (`name` for products, `productName` for cart/wishlist items).
  function productImage(product) {
    var p = product || {};
    if (p.photo) return p.photo;
    return defaultProductImage(p.name || p.productName, p.category && p.category.name);
  }

  DM.defaultProductImage = defaultProductImage;
  DM.productImage = productImage;
})();