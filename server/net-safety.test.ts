import { describe, it, expect } from "vitest";
import { isPrivateIp } from "./net-safety";

describe("isPrivateIp — whole-CIDR checks, not string prefixes", () => {
  it("blocks the ENTIRE 127.0.0.0/8, not just 127.0.0.1 (the closed gap)", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("127.0.0.2")).toBe(true);
    expect(isPrivateIp("127.1.2.3")).toBe(true);
    expect(isPrivateIp("127.255.255.255")).toBe(true);
  });

  it("blocks the entire 0.0.0.0/8", () => {
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    expect(isPrivateIp("0.0.0.5")).toBe(true);
    expect(isPrivateIp("0.1.2.3")).toBe(true);
  });

  it("blocks the classic private + link-local + CGNAT ranges", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true); // cloud metadata
    expect(isPrivateIp("100.64.0.1")).toBe(true);
  });

  it("allows ordinary public addresses (incl. near-boundary)", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("128.0.0.1")).toBe(false);
    expect(isPrivateIp("126.255.255.255")).toBe(false);
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("100.63.255.255")).toBe(false);
    expect(isPrivateIp("100.128.0.1")).toBe(false);
    expect(isPrivateIp("11.0.0.1")).toBe(false);
  });

  it("handles IPv6 loopback / ULA / link-local and IPv4-mapped forms", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);
    expect(isPrivateIp("fd00::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.2")).toBe(true);
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false); // public v6
  });

  it("rejects malformed octets rather than mis-parsing them as public", () => {
    // 256 is not a valid octet; must not be treated as a matchable IPv4.
    expect(isPrivateIp("127.0.0.256")).toBe(false);
    expect(isPrivateIp("not-an-ip")).toBe(false);
  });
});
