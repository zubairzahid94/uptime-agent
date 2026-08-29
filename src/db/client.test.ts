import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./client.js";

describe("db client", () => {
  it("can create and read a monitor", async () => {
    const monitor = await prisma.monitor.create({
      data: { url: "https://example.com", label: "example", intervalSeconds: 60 },
    });
    const found = await prisma.monitor.findUnique({ where: { id: monitor.id } });
    expect(found?.url).toBe("https://example.com");
    await prisma.monitor.delete({ where: { id: monitor.id } });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
