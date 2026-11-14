import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readMegaInstanceStatus } from "./instance-status";

describe("situação da instância MEGA", () => {
  test("instância desconectada não conserva o estado ERROR", () => {
    assert.equal(readMegaInstanceStatus({ state: "close" }, null), "DISCONNECTED");
  });

  test("resposta conectada com número vira CONNECTED", () => {
    assert.equal(readMegaInstanceStatus({ state: "open" }, "5511961994746"), "CONNECTED");
  });

  test("estado conectado sem número confirmado não vira CONNECTED", () => {
    assert.equal(readMegaInstanceStatus({ state: "open" }, null), "DISCONNECTED");
  });
});
