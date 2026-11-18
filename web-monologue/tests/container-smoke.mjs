// Run against a disposable Compose project, never an existing user data volume.
import assert from "node:assert/strict";

const phase = process.argv[2];
const base = process.argv[3] || "http://127.0.0.1:3100";
const name = "docker-검증캐릭터";
async function request(route, body) {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Iyagi-Request": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
assert.equal((await request("/health")).ok, true);
if (phase === "seed") {
  const { character } = await request("/api/characters", {
    name,
    password: "container-test-password",
  });
  await request(`/api/characters/${character.id}/script`, {
    name: "docker.scs",
    data: Buffer.from('여기부터(){글월쓰기("컨테이너 검증");}').toString(
      "base64",
    ),
    headers: [],
  });
  console.log("컨테이너에서 캐릭터 추가·암호화 저장·소스 번역 성공");
} else if (phase === "verify") {
  const result = await request("/api/characters");
  assert.ok(!JSON.stringify(result).includes("container-test-password"));
  const character = result.characters.find((c) => c.name === name);
  assert.ok(character);
  assert.equal(character.fileName, "docker.scs");
  assert.equal(character.hasScript, true);
  assert.equal(character.connected, false);
  console.log("컨테이너 재시작 후 캐릭터·소스 복구 및 암호 비노출 확인");
} else throw Error("seed 또는 verify를 지정하세요.");
