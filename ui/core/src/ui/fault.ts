// A backend's refusal in the person's words: the daemon says what went wrong
// as a dictionary key (`err.*`), sometimes with the values for its blanks; a
// message that is no key is shown as it came.
import { text } from "../i18n";
import { faultText } from "./gate-machine";

export function faultWords(e: unknown): string {
  // Web refusals carry their shape/status arguments beside Error.message;
  // the daemon puts the same arguments in its wire string.
  if (e && typeof e === "object" && "code" in e && typeof e.code === "string" && "args" in e) {
    try {
      const structured = faultText(`${e.code} ${JSON.stringify(e.args)}`);
      if (structured) return text(structured);
    } catch {
      // A malformed error still has its ordinary message.
    }
  }
  const msg = (e instanceof Error ? e.message : String(e)).trim();
  const known = faultText(msg);
  return known ? text(known) : msg;
}
