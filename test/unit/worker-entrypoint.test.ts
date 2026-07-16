import { describe, expect, it } from "vitest";
import * as workerEntrypoint from "../../src/index";

describe("production Worker entrypoint", () => {
  it("exports only the default Worker handler", () => {
    expect(Object.keys(workerEntrypoint)).toEqual(["default"]);
  });
});
