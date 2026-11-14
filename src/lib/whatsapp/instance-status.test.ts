import { describe, expect, test } from "bun:test";
import { readMegaInstanceStatus } from "./instance-status";

describe("situação da instância MEGA", () => {
  test("instância desconectada não conserva o estado ERROR", () => {
    expect(readMegaInstanceStatus({ state: "close" }, null)).toBe("DISCONNECTED");
  });

  test("resposta conectada com número vira CONNECTED", () => {
    expect(readMegaInstanceStatus({ state: "open" }, "5511961994746")).toBe("CONNECTED");
  });

  test("estado conectado sem número confirmado não vira CONNECTED", () => {
    expect(readMegaInstanceStatus({ state: "open" }, null)).toBe("DISCONNECTED");
  });
});
