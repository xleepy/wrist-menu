import { inter400Url, inter600Url } from "../generated/bundled-font-data.js";

let installed;

export function installBundledFont() {
  if (installed) return installed;
  installed = Promise.all([
    new FontFace("WristMenuInter", `url(${inter400Url})`, { weight: "400", style: "normal" }).load(),
    new FontFace("WristMenuInter", `url(${inter600Url})`, { weight: "600", style: "normal" }).load(),
  ]).then((faces) => {
    for (const face of faces) document.fonts.add(face);
    return faces;
  });
  return installed;
}
