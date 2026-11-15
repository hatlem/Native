import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchWithTimeout, isTimeoutError } from "./fetch-timeout";

test("fetchWithTimeout: rejects with a timeout error when the server hangs", async () => {
  const server = http.createServer(() => {
    /* never respond */
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await assert.rejects(
      fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 50),
      (err) => isTimeoutError(err),
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("fetchWithTimeout: passes a fast response through", async () => {
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 2000);
    assert.equal(await res.text(), "ok");
  } finally {
    server.close();
  }
});
