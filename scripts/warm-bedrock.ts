import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { AWS_REGION, MODEL_ID, buildParseCommand } from "@kc/recipes";

const FIXTURES = [
  {
    name: "Stuffing",
    text: "Herb stuffing. Dice an onion and two celery stalks and cook them in butter for 8 minutes. Stir in 10 cups of dried bread cubes, broth, and thyme. Spoon into a dish. Bake at 375 for 40 minutes. Rest 10 minutes.",
  },
  {
    name: "Green beans",
    text: "Green beans. Trim a pound of beans. Boil them for 6 minutes, then drain. Toss with butter, salt, and sliced almonds in a skillet for 4 minutes.",
  },
  {
    name: "Chocolate chip cookies",
    text: "Chocolate chip cookies. Heat the oven to 375. Cream butter and sugar, beat in an egg and vanilla, then mix in flour, salt, baking soda, and chocolate chips. Scoop onto a sheet. Bake 10 minutes. Rest 5 minutes.",
  },
];

async function main(): Promise<void> {
  if ((process.env.KC_BEDROCK ?? "stub") !== "live") {
    console.error("Refusing to call AWS while KC_BEDROCK is not live. Run: AWS_REGION=us-east-1 KC_BEDROCK=live npx tsx scripts/warm-bedrock.ts");
    process.exit(1);
  }
  const region = process.env.AWS_REGION ?? AWS_REGION;
  const modelId = process.env.KC_MODEL_ID ?? MODEL_ID;
  const client = new BedrockRuntimeClient({ region });
  const started = Date.now();
  const res = await client.send(buildParseCommand(FIXTURES, modelId));
  const text = (res.output?.message?.content ?? []).map((part) => ("text" in part ? part.text ?? "" : "")).join("");
  let dishes: number;
  try {
    dishes = (JSON.parse(text) as { dishes?: unknown[] }).dishes?.length ?? 0;
  } catch {
    dishes = 0;
  }
  console.log(JSON.stringify({ region, modelId, ms: Date.now() - started, dishes, chars: text.length }));
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("warm-bedrock.ts") || entry.endsWith("warm-bedrock.js")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
