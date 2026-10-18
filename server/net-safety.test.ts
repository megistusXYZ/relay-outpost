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

describe("isPrivateIp — the less common ranges a server must never reach", () => {
  it("blocks reserved, multicast, broadcast, benchmark and protocol ranges", () => {
    for (const ip of ["192.0.0.8", "198.18.0.1", "198.19.255.254", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("blocks IPv6 forms that carry a private IPv4 address inside them", () => {
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // ::ffff:127.0.0.1 in hex
    expect(isPrivateIp("::127.0.0.1")).toBe(true); // IPv4-compatible
    expect(isPrivateIp("64:ff9b::a9fe:a9fe")).toBe(true); // NAT64 of 169.254.169.254
    expect(isPrivateIp("2002:c0a8:0101::1")).toBe(true); // 6to4 of 192.168.1.1
  });

  it("blocks IPv6 multicast, site-local and discard ranges", () => {
    for (const ip of ["ff02::1", "fec0::1", "100::1"]) expect(isPrivateIp(ip), ip).toBe(true);
  });

  it("still allows public IPv6 and a NAT64 of a public address", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIp("64:ff9b::808:808")).toBe(false); // NAT64 of 8.8.8.8
    expect(isPrivateIp("::ffff:808:808")).toBe(false);
  });
});
