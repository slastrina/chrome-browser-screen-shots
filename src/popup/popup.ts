import type {
  CaptureFormat,
  CaptureMode,
  CaptureRequest,
  CaptureResponse,
  CaptureTheme,
  PdfLayout
} from "../lib/messages";

const form = document.getElementById("modes") as HTMLFormElement;
const formatSelect = document.getElementById("format") as HTMLSelectElement;
const themeSelect = document.getElementById("theme") as HTMLSelectElement;
const pdfLayoutField = document.getElementById("pdf-layout-field") as HTMLLabelElement;
const pdfLayoutSelect = document.getElementById("pdf-layout") as HTMLSelectElement;
const zapCheckbox = document.getElementById("zap") as HTMLInputElement;
const captureButton = document.getElementById("capture") as HTMLButtonElement;
const copyButton = document.getElementById("copy") as HTMLButtonElement;
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

function syncControls(): void {
  const mode = selectedMode();
  // The layout choice only exists for PDFs of multi-shot captures.
  const multiShot = mode === "device" || themeSelect.value === "both";
  pdfLayoutField.hidden = !(formatSelect.value === "pdf" && multiShot);

  // Copy delivers one PNG to the clipboard while the popup is open, so it
  // needs a single-image capture that doesn't hand control to the page.
  const copyable =
    (mode === "viewport" || mode === "full-page") && themeSelect.value !== "both" && !zapCheckbox.checked;
  copyButton.disabled = !copyable;
  copyButton.title = copyable
    ? "Copy the capture to the clipboard as PNG"
    : "Copy works for single viewport or full-page captures without zap";
}

async function restoreLastSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(["lastMode", "lastFormat", "lastPdfLayout", "lastTheme"]);
  const input = form.querySelector<HTMLInputElement>(`input[value="${stored.lastMode}"]`);
  if (input) {
    input.checked = true;
  }
  if (typeof stored.lastFormat === "string") {
    formatSelect.value = stored.lastFormat;
  }
  if (typeof stored.lastPdfLayout === "string") {
    pdfLayoutSelect.value = stored.lastPdfLayout;
  }
  if (typeof stored.lastTheme === "string") {
    themeSelect.value = stored.lastTheme;
  }
  syncControls();
}

function buildRequest(copy: boolean): CaptureRequest {
  return {
    kind: "capture",
    mode: selectedMode(),
    format: formatSelect.value as CaptureFormat,
    pdfLayout: pdfLayoutSelect.value as PdfLayout,
    theme: themeSelect.value as CaptureTheme,
    zapFirst: zapCheckbox.checked,
    copy
  };
}

async function send(copy: boolean): Promise<void> {
  const request = buildRequest(copy);
  await chrome.storage.local.set({
    lastMode: request.mode,
    lastFormat: request.format,
    lastPdfLayout: request.pdfLayout,
    lastTheme: request.theme
  });

  captureButton.disabled = true;
  copyButton.disabled = true;
  setStatus(request.mode === "device" ? "Capturing 3 sizes…" : "Capturing…");

  let response: CaptureResponse;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
    captureButton.disabled = false;
    syncControls();
    return;
  }

  if (!response.ok) {
    setStatus(response.error, true);
    captureButton.disabled = false;
    syncControls();
    return;
  }

  if ("pending" in response) {
    // Zapper or element picker has taken over on the page.
    window.close();
    return;
  }

  if ("dataUrl" in response) {
    const blob = await (await fetch(response.dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    setStatus("Copied to clipboard");
  } else {
    setStatus(`Saved ${response.filenames.join(", ")}`);
  }
  captureButton.disabled = false;
  syncControls();
}

captureButton.addEventListener("click", () => void send(false));
copyButton.addEventListener("click", () => void send(true));
formatSelect.addEventListener("change", syncControls);
themeSelect.addEventListener("change", syncControls);
zapCheckbox.addEventListener("change", syncControls);
form.addEventListener("change", syncControls);
void restoreLastSettings();
