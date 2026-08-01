import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/preview-ad", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

test("400 on invalid input", async () => {
  const res = await POST(req({ brand: "", product: "", market: "US", tone: "loud" }));
  assert.equal(res.status, 400);
});

test("200 + template article when no gateway key", async () => {
  const prevAi = process.env.GETPLATFORM_AI_KEY;
  const prevMaster = process.env.GETPLATFORM_API_KEY;
  delete process.env.GETPLATFORM_AI_KEY;
  delete process.env.GETPLATFORM_API_KEY;
  try {
    const res = await POST(req({ brand: "Volvo", product: "an electric SUV", market: "NO", tone: "warm" }));
    assert.equal(res.status, 200);
    const json = (await res.json()) as { source: string; article: { body: string[] } };
    assert.equal(json.source, "template");
    assert.ok(json.article.body.length >= 3);
  } finally {
    if (prevAi !== undefined) process.env.GETPLATFORM_AI_KEY = prevAi;
    if (prevMaster !== undefined) process.env.GETPLATFORM_API_KEY = prevMaster;
  }
});
