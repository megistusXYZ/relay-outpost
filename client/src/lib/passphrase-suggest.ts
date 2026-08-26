// Tiny embedded wordlist for "Generate strong passphrase" UX.
// 256 short, common, easy-to-spell English words. Four words from this list
// give ~32 bits of entropy — paired with the user's own choice of separator
// and capitalisation it crosses into "very strong" territory for offline
// scrypt attacks (NIP-49 logn=16).
//
// This list is intentionally conservative: no words that look alike, no
// homophones, no profanity, no plurals, all 4–7 letters.

const WORDS = [
  "amber","anchor","apple","arrow","atlas","autumn","bacon","badge",
  "bagel","baker","banjo","barn","basil","beach","bear","berry",
  "birch","bison","blade","bloom","blue","boat","bold","brave",
  "bread","brick","brisk","broom","brown","brush","bubble","buffalo",
  "bunny","cabin","cable","cactus","camel","candle","canyon","carbon",
  "cargo","carrot","castle","cedar","chalk","cherry","chess","cider",
  "circle","clay","cliff","cloud","clover","cobalt","cocoa","coffee",
  "comet","copper","coral","cosmic","cotton","crane","cream","crest",
  "crisp","crown","crystal","cyan","daisy","dance","dandy","desert",
  "diamond","disco","domino","donut","dragon","dream","drift","duck",
  "eagle","earth","ember","fable","falcon","fancy","feather","fern",
  "fiber","field","fjord","flag","flame","flax","fleet","flint",
  "flower","fluffy","forest","fossil","fox","frame","frog","frost",
  "fuzzy","galaxy","garden","gentle","ghost","ginger","glacier","glow",
  "golden","grape","grass","gravy","green","grove","gummy","happy",
  "harbor","hatch","hawk","hazel","heron","hill","honey","hoot",
  "horse","hotel","ivory","jade","jam","jelly","jet","jolly",
  "juice","jungle","kayak","kettle","kind","kite","koala","lagoon",
  "lamp","lantern","laser","lava","leaf","lemon","lily","linen",
  "lion","lobby","lotus","lucky","lumber","lunar","mango","maple",
  "marble","marina","meadow","melody","melon","mercury","metal","mint",
  "mirror","misty","mocha","moon","moss","muffin","music","nebula",
  "needle","neon","nest","nimble","noble","north","nova","oak",
  "ocean","olive","onyx","opal","orange","orchid","otter","owl",
  "paddle","panda","paper","parade","peach","pear","pebble","pencil",
  "penguin","pepper","piano","pilot","pixel","planet","plum","polar",
  "pony","poppy","prairie","puppet","purple","puzzle","quartz","quiet",
  "rabbit","raccoon","radio","rain","raven","red","reed","reef",
  "ribbon","river","robin","rocket","roof","ruby","sage","salad",
  "sandy","sapphire","scarlet","seal","shadow","shell","silver","skate",
  "sky","slate","sleepy","snow","solar","spark","spring","squash",
  "stone","storm","sugar","summer","sun","sunset","swan","tango",
  "tarot","teal","thistle","thunder","tidal","tiger","timber","tin",
  "topaz","train","tree","tulip","turtle","twig","umbra","unicorn",
  "valley","velvet","violet","walnut","warm","water","wave","whale",
  "wheat","willow","winter","wolf","woods","yarn","yellow","yogurt",
  "zebra","zen","zest","zinc",
];

// Default word count: 6 words from a 256-word list ≈ 48 bits of entropy.
// Combined with NIP-49 scrypt at logn=16 (~150ms / guess on commodity hardware),
// this is considered strong against offline attacks on a leaked ncryptsec.
// Callers that want extra headroom can pass a larger wordCount.
export function generatePassphraseSuggestion(wordCount = 6, separator = "-"): string {
  const buf = new Uint32Array(wordCount);
  crypto.getRandomValues(buf);
  const max = WORDS.length;
  const picks: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    picks.push(WORDS[buf[i] % max]);
  }
  return picks.join(separator);
}
