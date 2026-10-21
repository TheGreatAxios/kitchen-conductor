import { NARRATION, pickVoice } from "./voices.ts";

const list = document.querySelector("#lines") as HTMLElement;
const caption = document.querySelector("#caption") as HTMLElement;
let stop = false;

function voice(): SpeechSynthesisVoice | undefined {
  const synth = window.speechSynthesis;
  if (!synth) return undefined;
  const voices = synth.getVoices();
  const picked = pickVoice(voices.map((v) => ({ name: v.name, lang: v.lang })), "narrator");
  return voices.find((v) => v.name === picked?.name);
}

function speak(text: string): Promise<void> {
  caption.textContent = text;
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const picked = voice();
    if (picked) u.voice = picked;
    u.lang = picked?.lang || "en-US";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(done, 20000);
    u.onend = () => {
      window.clearTimeout(timer);
      done();
    };
    u.onerror = () => {
      window.clearTimeout(timer);
      done();
    };
    synth.cancel();
    synth.speak(u);
  });
}

function render(): void {
  list.innerHTML = NARRATION.map((line, i) =>
    `<li><time>${line.cue}</time><p>${line.say}</p><button type="button" data-i="${i}">Play</button></li>`,
  ).join("");
}

list.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button");
  if (!btn) return;
  const line = NARRATION[Number(btn.getAttribute("data-i"))];
  if (line) void speak(line.say);
});

document.querySelector("#all")?.addEventListener("click", async () => {
  stop = false;
  for (const line of NARRATION) {
    if (stop) break;
    await speak(line.say);
  }
});

document.querySelector("#stop")?.addEventListener("click", () => {
  stop = true;
  window.speechSynthesis?.cancel();
});

render();
window.speechSynthesis?.addEventListener("voiceschanged", () => voice());
