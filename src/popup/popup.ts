import type { CaptureFormat, CaptureMode, CaptureRequest, CaptureResponse, PdfLayout } from "../lib/messages";

const form = document.getElementById("modes") as HTMLFormElement;
const formatSelect = document.getElementById("format") as HTMLSelectElement;
const pdfLayoutField = document.getElementById("pdf-layout-field") as HTMLLabelElement;
const pdfLayoutSelect = document.getElementById("pdf-layout") as HTMLSelectElement;
const captureButton = document.getElementById("capture") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;

function selectedMode(): CaptureMode {
  const data = new FormData(form);
  return (data.get("mode") as CaptureMode) ?? "viewport";
}

function setStatus(text: string, isError = false): void {
  status.hidden = text === "";
  status.textContent = text;
  status.classList.toggle("error", isError);
}

// The layout choice only exists for PDFs of the three device sizes;
// every other combination is inherently a single file per capture.
function syncPdfLayoutVisibility(): void {
  pdfLayoutField.hidden = !(formatSelect.value === "pdf" && selectedMode() === "device");
}

async function restoreLastSettings(): Promise<void> {
  const { lastMode, lastFormat, lastPdfLayout } = await chrome.storage.local.get([
    "lastMode",
    "lastFormat",
    "lastPdfLayout"
  ]);
  const input = form.querySelector<HTMLInputElement>(`input[value="${lastMode}"]`);
  if (input) {
    input.checked = true;
  }
  if (typeof lastFormat === "string") {
    formatSelect.value = lastFormat;
  }
  if (typeof lastPdfLayout === "string") {
    pdfLayoutSelect.value = lastPdfLayout;
  }
  syncPdfLayoutVisibility();
}

async function capture(): Promise<void> {
  const mode = selectedMode();
  const format = formatSelect.value as CaptureFormat;
  const pdfLayout = pdfLayoutSelect.value as PdfLayout;
  await chrome.storage.local.set({ lastMode: mode, lastFormat: format, lastPdfLayout: pdfLayout });

  captureButton.disabled = true;
  setStatus(mode === "device" ? "Capturing 3 sizes…" : "Capturing…");

  const request: CaptureRequest = { kind: "capture", mode, format, pdfLayout };
  let response: CaptureResponse;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    captureButton.disabled = false;
    return;
  }

  if (!response.ok) {
    setStatus(response.error, true);
    captureButton.disabled = false;
    return;
  }

  if ("pending" in response) {
    // Element mode: hand over to the in-page picker.
    window.close();
    return;
  }

  setStatus(`Saved ${response.filenames.join(", ")}`);
  captureButton.disabled = false;
}

captureButton.addEventListener("click", () => void capture());
formatSelect.addEventListener("change", syncPdfLayoutVisibility);
form.addEventListener("change", syncPdfLayoutVisibility);
void restoreLastSettings();
