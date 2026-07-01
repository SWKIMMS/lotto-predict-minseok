import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputJson = resolve(projectRoot, "data", "lotto-history.json");
const outputJs = resolve(projectRoot, "data", "lotto-history.js");

const headers = {
  accept: "application/json, text/html;q=0.9",
  "user-agent": "lotto-stat-site/0.1"
};

const latestResultUrl = "https://www.dhlottery.co.kr/lt645/result";
const roundDetailUrl = "https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do";

async function fetchText(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

function parseLatestRound(html) {
  const match = html.match(/id="opt_val"[^>]*value="(\d+)"/i);
  if (!match) {
    throw new Error("Unable to find latest lotto round.");
  }
  return Number.parseInt(match[1], 10);
}

function formatYmd(raw) {
  const value = String(raw);
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Unexpected date format: ${value}`);
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function normalizeItem(item) {
  return {
    draw: Number(item.ltEpsd),
    date: formatYmd(item.ltRflYmd),
    numbers: [item.tm1WnNo, item.tm2WnNo, item.tm3WnNo, item.tm4WnNo, item.tm5WnNo, item.tm6WnNo].map(Number),
    bonus: Number(item.bnsWnNo)
  };
}

async function fetchRoundWindow(round) {
  const url = new URL(roundDetailUrl);
  url.searchParams.set("srchDir", "center");
  url.searchParams.set("srchLtEpsd", String(round));
  const payload = await fetchJson(url.toString());
  const list = payload?.data?.list;

  if (!Array.isArray(list)) {
    throw new Error(`No result list returned for round ${round}.`);
  }

  return list.map(normalizeItem);
}

async function main() {
  await mkdir(resolve(projectRoot, "data"), { recursive: true });
  const latestRound = parseLatestRound(await fetchText(latestResultUrl));
  const byRound = new Map();

  for (let round = latestRound; round >= 1; round -= 10) {
    const rows = await fetchRoundWindow(round);
    rows.forEach((row) => {
      if (row.draw >= 1 && row.draw <= latestRound) {
        byRound.set(row.draw, row);
      }
    });
  }

  const firstRows = await fetchRoundWindow(1);
  firstRows.forEach((row) => {
    if (row.draw >= 1 && row.draw <= latestRound) {
      byRound.set(row.draw, row);
    }
  });

  if (!byRound.size) {
    throw new Error("No draw data fetched.");
  }

  const rows = Array.from(byRound.values()).sort((a, b) => a.draw - b.draw);
  const missing = [];
  for (let draw = 1; draw <= latestRound; draw += 1) {
    if (!byRound.has(draw)) missing.push(draw);
  }
  if (missing.length) {
    throw new Error(`Missing draw data: ${missing.slice(0, 12).join(", ")}`);
  }

  const json = `${JSON.stringify(rows, null, 2)}\n`;
  const js = `window.LOTTO_HISTORY = ${JSON.stringify(rows)};\n`;
  await writeFile(outputJson, json, "utf8");
  await writeFile(outputJs, js, "utf8");

  const latest = rows.at(-1);
  console.log(`Wrote ${rows.length} draws. Latest: ${latest.draw} (${latest.date})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
