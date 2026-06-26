import type { JSONObject, JSONPrimitive, JSONValue } from "../src/types/json.ts";
import { describe, expect, test } from "bun:test";

describe("JSONPrimitive", () => {
  test("string is assignable", () => {
    const x: JSONPrimitive = "hello";
    expect(x).toBe("hello");
  });

  test("number is assignable", () => {
    const x: JSONPrimitive = 42;
    expect(x).toBe(42);
  });

  test("boolean is assignable", () => {
    const x: JSONPrimitive = true;
    expect(x).toBe(true);
  });

  test("null is assignable", () => {
    const x: JSONPrimitive = null;
    expect(x).toBeNull();
  });
});

describe("JSONValue", () => {
  test("string literal is assignable", () => {
    const x: JSONValue = "hello";
    expect(x).toBe("hello");
  });

  test("number literal is assignable", () => {
    const x: JSONValue = 42;
    expect(x).toBe(42);
  });

  test("nested array is assignable", () => {
    const x: JSONValue = [1, "b", null];
    expect(Array.isArray(x)).toBe(true);
  });

  test("nested object is assignable", () => {
    const x: JSONValue = { a: 1, b: "two", c: [true, null] };
    expect(x).toEqual({ a: 1, b: "two", c: [true, null] });
  });

  test("deeply nested structure is assignable", () => {
    const x: JSONValue = {
      name: "test",
      counts: [1, 2, 3],
      nested: {
        flag: true,
        items: [{ id: 1 }, { id: 2 }],
      },
    };
    expect(x).toBeDefined();
  });
});

describe("JSONObject", () => {
  test("plain object is assignable", () => {
    const x: JSONObject = { key: "value", num: 42, flag: true };
    expect(x.key).toBe("value");
  });

  test("can contain arrays as values", () => {
    const x: JSONObject = { items: [1, 2, 3] };
    expect(Array.isArray(x.items)).toBe(true);
  });

  test("can contain nested objects", () => {
    const x: JSONObject = { nested: { deep: true } };
    expect(x.nested).toEqual({ deep: true });
  });

  test("null-as-value is valid", () => {
    const x: JSONObject = { missing: null };
    expect(x.missing).toBeNull();
  });
});

describe("structural subtyping", () => {
  test("JSONObject is assignable to JSONValue", () => {
    const obj: JSONObject = { a: 1 };
    const val: JSONValue = obj;
    expect(val).toEqual({ a: 1 });
  });

  test("JSONPrimitive is assignable to JSONValue", () => {
    const prim: JSONPrimitive = 123;
    const val: JSONValue = prim;
    expect(val).toBe(123);
  });

  test("string[] is assignable to JSONValue", () => {
    const arr: string[] = ["a", "b"];
    const val: JSONValue = arr;
    expect(val).toEqual(["a", "b"]);
  });
});
