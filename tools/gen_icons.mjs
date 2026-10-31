// Ship only the Lucide icons the app uses: every PascalCase string in src/ that names a Lucide
// icon goes into src/ui/icons.gen.js (runs before dev and build). Saves ~1,500 unused icons.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as lucide from "lucide";
const names = new Set();
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.js$/.test(f) && !f.endsWith("icons.gen.js")) for (const m of readFileSync(p, "utf8").matchAll(/["'`]([A-Z][A-Za-z0-9]+)["'`]/g)) names.add(m[1]); } };
walk("src");
const used = [...names].filter((n) => lucide.icons?.[n]).sort();
writeFileSync("src/ui/icons.gen.js", `// Made by tools/gen_icons.mjs; don't edit. The Lucide icons the app uses.\nexport { ${used.join(", ")} } from "lucide";\n`);
console.log(`icons.gen.js: ${used.length} icons`);
