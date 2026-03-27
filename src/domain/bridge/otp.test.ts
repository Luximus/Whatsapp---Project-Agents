import { describe, it, expect } from "vitest";
import {
  generateOtpCode,
  generateOtpReference,
  extractBridgeReference,
  buildBridgeMessage
} from "./otp.js";

describe("generateOtpCode", () => {
  it("produces a 6-digit zero-padded string", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("generateOtpReference", () => {
  it("produces an 8-char uppercase alphanumeric string", () => {
    for (let i = 0; i < 50; i++) {
      const ref = generateOtpReference();
      expect(ref).toMatch(/^[A-Z0-9]{8}$/);
    }
  });
});

describe("extractBridgeReference", () => {
  it("extracts ref from 'REF ABC123'", () => {
    expect(extractBridgeReference("Tu codigo es 123456. REF ABC12345")).toBe("ABC12345");
  });

  it("extracts from 'id:XYZ99' pattern", () => {
    expect(extractBridgeReference("id:XYZ99AB")).toBe("XYZ99AB");
  });

  it("returns null for messages without a reference", () => {
    expect(extractBridgeReference("123456")).toBeNull();
    expect(extractBridgeReference("")).toBeNull();
    expect(extractBridgeReference(null)).toBeNull();
    expect(extractBridgeReference(undefined)).toBeNull();
  });
});

describe("buildBridgeMessage", () => {
  it("contains code and ref for verification flow", () => {
    const msg = buildBridgeMessage("verification", "123456", "ABCD1234");
    expect(msg).toContain("123456");
    expect(msg).toContain("ABCD1234");
    expect(msg).toContain("verificacion");
  });

  it("contains correct display name for login flow", () => {
    const msg = buildBridgeMessage("login", "000001", "REF00001");
    expect(msg).toContain("inicio de sesion");
  });

  it("contains correct display name for register flow", () => {
    const msg = buildBridgeMessage("register", "000002", "REF00002");
    expect(msg).toContain("registro");
  });

  it("contains correct display name for recovery flow", () => {
    const msg = buildBridgeMessage("recovery", "000003", "REF00003");
    expect(msg).toContain("recuperacion");
  });
});
