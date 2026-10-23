/** Browser voice preference for the conductor, the cook, and the narration. */

export interface VoiceLike {
  name: string;
  lang: string;
}

export type VoiceRole = "conductor" | "cook" | "narrator";

export const VOICE_ORDER: Record<VoiceRole, string[]> = {
  conductor: ["Google US English", "Samantha", "Microsoft Aria", "Karen"],
  cook: ["Samantha", "Jenny", "Karen", "Moira"],
  narrator: ["Daniel", "Aaron", "Microsoft Guy", "Alex", "Google UK English Male"],
};

export interface ScriptLine {
  say: string;
  /** Local clock on the demo day, before this line is spoken. */
  at?: string;
}

export const COOK_SCRIPT: ScriptLine[] = [
  {
    at: "15:12",
    say: "We're making turkey, stuffing, potatoes, green beans, gravy and rolls. We eat at five.",
  },
  { at: "15:40", say: "The turkey's running thirty minutes late." },
  { say: "Sounds good." },
  { say: "Add what I'm missing to my list." },
];

export const NARRATION: { cue: string; say: string }[] = [
  { cue: "0:00", say: "Every November, the same two problems: one oven, six dishes, and timers you can't trust." },
  { cue: "0:12", say: "Kitchen Conductor is an Alexa+ add-on. Tell it what you're making and when you eat." },
  {
    cue: "0:35",
    say: "It knows you have one oven at one temperature, four burners and two hands. The stuffing wants 375; the turkey needs 350, so it shares the oven and gets ten extra minutes. Rolls go in at 425 while the turkey rests.",
  },
  { cue: "1:05", say: "Every step rings when it's due. The clock is sped up for the video." },
  {
    cue: "1:20",
    say: "When something slips, the whole evening re-plans: potatoes, gravy, beans and rolls all move, and the rest gets shorter.",
  },
  {
    cue: "1:50",
    say: "Timers live in this server process, so a reload keeps them. A restart clears them until you seed the demo again.",
  },
  { cue: "2:05", say: "Missing ingredients go straight to your list." },
  {
    cue: "2:20",
    say: "Under the hood it's a self-hosted MCP server on the 2026-07-28 spec, over Streamable HTTP, in one local process. Bedrock reads a new recipe once. The scheduling is plain code.",
  },
  { cue: "2:40", say: "Kitchen Conductor. Dinner, on time." },
];

function pool(voices: VoiceLike[]): VoiceLike[] {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return en.length ? en : voices;
}

/** Prefer the role's list. The cook skips whatever voice the conductor already took. */
export function pickVoice(voices: VoiceLike[], role: VoiceRole, avoidName?: string): VoiceLike | undefined {
  const rows = pool(voices);
  if (!rows.length) return undefined;
  const avoid = avoidName?.toLowerCase();
  const free = (v: VoiceLike) => !avoid || v.name.toLowerCase() !== avoid;
  for (const want of VOICE_ORDER[role]) {
    const hit = rows.find((v) => free(v) && v.name.toLowerCase().includes(want.toLowerCase()));
    if (hit) return hit;
  }
  if (role === "narrator") {
    const male = rows.find((v) => free(v) && /male|daniel|aaron|guy|alex|david/i.test(v.name));
    if (male) return male;
  }
  return rows.find(free) ?? rows[0];
}
