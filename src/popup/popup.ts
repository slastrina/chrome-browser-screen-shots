import type { CaptureMode, CaptureRequest, CaptureResponse } from "../lib/messages";

const form = document.getElementById("modes") as HTMLFormElement;
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

async function restoreLastMode(): Promise<void> {
  const { lastMode } = await chrome.storage.local.get("lastMode");
  const input = form.querySelector<HTMLInputElement>(`input[value="${lastMode}"]`);
  if (input) {
    input.checked = true;
  }
}

async function capture(): Promise<void> {
  const mode = selectedMode();
  await chrome.storage.local.set({ lastMode: mode });

  captureButton.disabled = true;
  setStatus(mode === "device" ? "Capturing 3 sizes…" : "Capturing…");

  const request: CaptureRequest = { kind: "capture", mode };
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
void restoreLastMode();
