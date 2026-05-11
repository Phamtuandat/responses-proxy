import assert from "node:assert/strict";
import test from "node:test";
import { formatDateTime } from "./message-format.js";

test("formatDateTime renders a compact Vietnam-local timestamp", () => {
  assert.equal(formatDateTime("2026-05-11T07:30:00.000Z"), "11/05/2026 14:30");
});

test("formatDateTime keeps invalid values visible", () => {
  assert.equal(formatDateTime("not-a-date"), "not-a-date");
  assert.equal(formatDateTime(undefined), "none");
});
