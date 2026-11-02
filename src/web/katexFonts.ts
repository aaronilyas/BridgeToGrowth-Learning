import amsRegularW2 from "katex/dist/fonts/KaTeX_AMS-Regular.woff2";
import amsRegularW from "katex/dist/fonts/KaTeX_AMS-Regular.woff";
import amsRegularT from "katex/dist/fonts/KaTeX_AMS-Regular.ttf";
import caligraphicBoldW2 from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2";
import caligraphicBoldW from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff";
import caligraphicBoldT from "katex/dist/fonts/KaTeX_Caligraphic-Bold.ttf";
import caligraphicRegularW2 from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2";
import caligraphicRegularW from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff";
import caligraphicRegularT from "katex/dist/fonts/KaTeX_Caligraphic-Regular.ttf";
import frakturBoldW2 from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2";
import frakturBoldW from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff";
import frakturBoldT from "katex/dist/fonts/KaTeX_Fraktur-Bold.ttf";
import frakturRegularW2 from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2";
import frakturRegularW from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff";
import frakturRegularT from "katex/dist/fonts/KaTeX_Fraktur-Regular.ttf";
import mainBoldW2 from "katex/dist/fonts/KaTeX_Main-Bold.woff2";
import mainBoldW from "katex/dist/fonts/KaTeX_Main-Bold.woff";
import mainBoldT from "katex/dist/fonts/KaTeX_Main-Bold.ttf";
import mainBoldItalicW2 from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2";
import mainBoldItalicW from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff";
import mainBoldItalicT from "katex/dist/fonts/KaTeX_Main-BoldItalic.ttf";
import mainItalicW2 from "katex/dist/fonts/KaTeX_Main-Italic.woff2";
import mainItalicW from "katex/dist/fonts/KaTeX_Main-Italic.woff";
import mainItalicT from "katex/dist/fonts/KaTeX_Main-Italic.ttf";
import mainRegularW2 from "katex/dist/fonts/KaTeX_Main-Regular.woff2";
import mainRegularW from "katex/dist/fonts/KaTeX_Main-Regular.woff";
import mainRegularT from "katex/dist/fonts/KaTeX_Main-Regular.ttf";
import mathBoldItalicW2 from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2";
import mathBoldItalicW from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff";
import mathBoldItalicT from "katex/dist/fonts/KaTeX_Math-BoldItalic.ttf";
import mathItalicW2 from "katex/dist/fonts/KaTeX_Math-Italic.woff2";
import mathItalicW from "katex/dist/fonts/KaTeX_Math-Italic.woff";
import mathItalicT from "katex/dist/fonts/KaTeX_Math-Italic.ttf";
import sansSerifBoldW2 from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2";
import sansSerifBoldW from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff";
import sansSerifBoldT from "katex/dist/fonts/KaTeX_SansSerif-Bold.ttf";
import sansSerifItalicW2 from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2";
import sansSerifItalicW from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff";
import sansSerifItalicT from "katex/dist/fonts/KaTeX_SansSerif-Italic.ttf";
import sansSerifRegularW2 from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2";
import sansSerifRegularW from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff";
import sansSerifRegularT from "katex/dist/fonts/KaTeX_SansSerif-Regular.ttf";
import scriptRegularW2 from "katex/dist/fonts/KaTeX_Script-Regular.woff2";
import scriptRegularW from "katex/dist/fonts/KaTeX_Script-Regular.woff";
import scriptRegularT from "katex/dist/fonts/KaTeX_Script-Regular.ttf";
import size1RegularW2 from "katex/dist/fonts/KaTeX_Size1-Regular.woff2";
import size1RegularW from "katex/dist/fonts/KaTeX_Size1-Regular.woff";
import size1RegularT from "katex/dist/fonts/KaTeX_Size1-Regular.ttf";
import size2RegularW2 from "katex/dist/fonts/KaTeX_Size2-Regular.woff2";
import size2RegularW from "katex/dist/fonts/KaTeX_Size2-Regular.woff";
import size2RegularT from "katex/dist/fonts/KaTeX_Size2-Regular.ttf";
import size3RegularW2 from "katex/dist/fonts/KaTeX_Size3-Regular.woff2";
import size3RegularW from "katex/dist/fonts/KaTeX_Size3-Regular.woff";
import size3RegularT from "katex/dist/fonts/KaTeX_Size3-Regular.ttf";
import size4RegularW2 from "katex/dist/fonts/KaTeX_Size4-Regular.woff2";
import size4RegularW from "katex/dist/fonts/KaTeX_Size4-Regular.woff";
import size4RegularT from "katex/dist/fonts/KaTeX_Size4-Regular.ttf";
import typewriterRegularW2 from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2";
import typewriterRegularW from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff";
import typewriterRegularT from "katex/dist/fonts/KaTeX_Typewriter-Regular.ttf";

type FaceRow = [family: string, style: string, weight: string, woff2: string, woff: string, ttf: string];

// INV: mirrors the @font-face rules of katex/dist/katex.min.css 0.19.1 (family, style, weight, display:block, woff2→woff→ttf order); scripts/build.ts strips those rules so these faces are the only ones in production
const FACES: FaceRow[] = [
  ["KaTeX_AMS", "normal", "400", amsRegularW2, amsRegularW, amsRegularT],
  ["KaTeX_Caligraphic", "normal", "700", caligraphicBoldW2, caligraphicBoldW, caligraphicBoldT],
  ["KaTeX_Caligraphic", "normal", "400", caligraphicRegularW2, caligraphicRegularW, caligraphicRegularT],
  ["KaTeX_Fraktur", "normal", "700", frakturBoldW2, frakturBoldW, frakturBoldT],
  ["KaTeX_Fraktur", "normal", "400", frakturRegularW2, frakturRegularW, frakturRegularT],
  ["KaTeX_Main", "normal", "700", mainBoldW2, mainBoldW, mainBoldT],
  ["KaTeX_Main", "italic", "700", mainBoldItalicW2, mainBoldItalicW, mainBoldItalicT],
  ["KaTeX_Main", "italic", "400", mainItalicW2, mainItalicW, mainItalicT],
  ["KaTeX_Main", "normal", "400", mainRegularW2, mainRegularW, mainRegularT],
  ["KaTeX_Math", "italic", "700", mathBoldItalicW2, mathBoldItalicW, mathBoldItalicT],
  ["KaTeX_Math", "italic", "400", mathItalicW2, mathItalicW, mathItalicT],
  ["KaTeX_SansSerif", "normal", "700", sansSerifBoldW2, sansSerifBoldW, sansSerifBoldT],
  ["KaTeX_SansSerif", "italic", "400", sansSerifItalicW2, sansSerifItalicW, sansSerifItalicT],
  ["KaTeX_SansSerif", "normal", "400", sansSerifRegularW2, sansSerifRegularW, sansSerifRegularT],
  ["KaTeX_Script", "normal", "400", scriptRegularW2, scriptRegularW, scriptRegularT],
  ["KaTeX_Size1", "normal", "400", size1RegularW2, size1RegularW, size1RegularT],
  ["KaTeX_Size2", "normal", "400", size2RegularW2, size2RegularW, size2RegularT],
  ["KaTeX_Size3", "normal", "400", size3RegularW2, size3RegularW, size3RegularT],
  ["KaTeX_Size4", "normal", "400", size4RegularW2, size4RegularW, size4RegularT],
  ["KaTeX_Typewriter", "normal", "400", typewriterRegularW2, typewriterRegularW, typewriterRegularT],
];

let registered = false;

// O(faces)
// INV: Bun inlines every CSS url() asset under 128 KiB as a data: URL with no option to disable it, so the fonts are imported here with the file loader and become hashed same-origin files
// INV: a FontFace added to document.fonts is fetched only when rendered text needs it, like an @font-face rule, so pages without math download no font
// SEC: urls are same-origin bundle assets, allowed by font-src 'self'; no CSP change
export function registerKatexFonts(): void {
  if (registered || typeof document === "undefined" || typeof FontFace === "undefined") return;
  registered = true;
  for (const [family, style, weight, woff2, woff, ttf] of FACES) {
    const src = `url(${JSON.stringify(woff2)}) format("woff2"), url(${JSON.stringify(woff)}) format("woff"), url(${JSON.stringify(ttf)}) format("truetype")`;
    document.fonts.add(new FontFace(family, src, { style, weight, display: "block" }));
  }
}
