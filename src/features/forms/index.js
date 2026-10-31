// Forms, signing, stamps, OCR and camera scanning (CSS prefix .fs-).
import "./forms.css";
import { installForms } from "./forms.js";
import { installSign } from "./sign.js";
import { installStamps } from "./stamps.js";
import { installOcr } from "./ocr.js";
import { installScan } from "./scan.js";

export function install(app) {
  installForms(app); // first: it creates app.fs for the others
  installSign(app);
  installStamps(app);
  installOcr(app);
  installScan(app);
}
