// Shared bits for the providers: a Stop error, plain-English errors, and tool-result text limits.

/** Thrown when the user presses Stop. */
export class StoppedError extends Error {
  constructor() {
    super("Stopped.");
    this.name = "AbortError";
  }
}

/** An error whose message is already written for the user. */
export class FriendlyError extends Error {
  constructor(message, { hint = "" } = {}) {
    super(message);
    this.name = "FriendlyError";
    this.hint = hint;
  }
}

export const isStop = (e) => e?.name === "AbortError" || e instanceof StoppedError;

export function throwIfStopped(signal) {
  if (signal?.aborted) throw new StoppedError();
}

/** Tool results go back to the AI; keep them a sensible size. */
export const MAX_RESULT_CHARS = 20000;
export function clipText(text) {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n…(cut to ${MAX_RESULT_CHARS} characters)` : s;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** A tool's picture, if it is a well-formed base64 image. */
export function safeImage(image) {
  if (!image || typeof image !== "object") return null;
  const mediaType = String(image.mediaType || "");
  const data = typeof image.data === "string" ? image.data.replace(/^data:[^,]*,/, "") : "";
  if (!IMAGE_TYPES.includes(mediaType) || !data || !/^[A-Za-z0-9+/=\s]+$/.test(data.slice(0, 200))) return null;
  return { mediaType, data };
}
