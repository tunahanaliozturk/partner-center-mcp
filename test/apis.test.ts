import { test, expect } from "vitest";
import { API_BASES, baseUrlFor, basePathFor } from "../src/knowledge/apis.js";

test("baseUrlFor defaults to the Partner Center base when api is absent", () => {
  expect(baseUrlFor(undefined)).toBe(API_BASES["partner-center"]);
  expect(baseUrlFor(undefined)).toBe("https://api.partnercenter.microsoft.com");
});

test("baseUrlFor(\"graph\") includes the /v1.0 prefix", () => {
  expect(baseUrlFor("graph")).toBe("https://graph.microsoft.com/v1.0");
});

test("baseUrlFor(\"pricing-and-referrals\") has no version prefix", () => {
  expect(baseUrlFor("pricing-and-referrals")).toBe("https://api.partner.microsoft.com");
});

test("basePathFor(\"graph\") is the pathname portion, /v1.0", () => {
  expect(basePathFor("graph")).toBe("/v1.0");
});

test("basePathFor is empty for partner-center and pricing-and-referrals", () => {
  expect(basePathFor(undefined)).toBe("");
  expect(basePathFor("partner-center")).toBe("");
  expect(basePathFor("pricing-and-referrals")).toBe("");
});
