import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const contractDir = path.join(process.cwd(), "tests", "contracts", "chatgpt-composer");
const generatedFixturePath = path.join(process.cwd(), "tests", "fixtures", "generated", "chatgpt-composer-contract.html");
const files = (await readdir(contractDir)).filter((file) => file.endsWith(".json")).sort();

assert(files.length > 0, "at least one composer contract is required");

for (const file of files) {
  const contractPath = path.join(contractDir, file);
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  assert(contract.schemaVersion === 1, `${file}: schemaVersion must be 1`);
  assert(typeof contract.contractId === "string" && contract.contractId.length > 0, `${file}: contractId missing`);
  assert(contract.privacy?.promptTextIncluded === false, `${file}: prompt text must be excluded`);
  assert(contract.privacy?.conversationTextIncluded === false, `${file}: conversation text must be excluded`);
  assert(contract.privacy?.answerTextIncluded === false, `${file}: answer text must be excluded`);
  assert(contract.privacy?.requestDataIncluded === false, `${file}: request data must be excluded`);
  assert(contract.privacy?.rawDomIncluded === false, `${file}: raw DOM must be excluded`);
  assert(contract.privacy?.authDataIncluded === false, `${file}: auth data must be excluded`);
  assert(contract.composer?.editable?.tag, `${file}: editable tag missing`);
  assert(contract.composer?.root?.tag, `${file}: root tag missing`);
  assert(Array.isArray(contract.nodes) && contract.nodes.length > 0, `${file}: structural nodes missing`);

  const serialized = JSON.stringify(contract);
  for (const forbidden of ["Authorization", "Cookie", "access_token", "refresh_token", "fixture secret prompt", "fixture answer should not leak"]) {
    assert(!serialized.includes(forbidden), `${file}: forbidden sensitive token present: ${forbidden}`);
  }
}

const generatedFixture = await readFile(generatedFixturePath, "utf8");
for (const token of [
  "data-mica-fixture=\"true\"",
  "data-composer-surface=\"true\"",
  "promptTextIncluded: false",
  "conversationTextIncluded: false",
  "../../dist/mica-dev/content.js"
]) {
  assert(generatedFixture.includes(token), `generated contract fixture missing ${token}`);
}

console.log(JSON.stringify({ passed: true, contracts: files, generatedFixture: path.relative(process.cwd(), generatedFixturePath) }, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
