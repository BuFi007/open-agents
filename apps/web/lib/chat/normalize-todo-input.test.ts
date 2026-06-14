import { describe, expect, test } from "bun:test";
import type { TodoItem } from "@open-agents/agent";
import { normalizeTodoInput } from "./normalize-todo-input";

const validTodos: TodoItem[] = [
  { id: "1", content: "Inspect files", status: "completed" },
  { id: "2", content: "Implement fix", status: "in_progress" },
];

describe("normalizeTodoInput", () => {
  test("passes through well-formed input", () => {
    expect(normalizeTodoInput({ todos: validTodos })).toEqual(validTodos);
  });

  test("parses stringified input and todos fields", () => {
    expect(
      normalizeTodoInput(JSON.stringify({ todos: JSON.stringify(validTodos) })),
    ).toEqual(validTodos);
  });

  test("wraps a single todo object into an array", () => {
    expect(normalizeTodoInput({ todos: validTodos[0] })).toEqual([
      validTodos[0],
    ]);
  });

  test("repairs incomplete todo items", () => {
    expect(
      normalizeTodoInput({
        todos: [{ content: "Run checks", status: "unknown" }, "Deploy preview"],
      }),
    ).toEqual([
      { id: "todo-0", content: "Run checks", status: "pending" },
      { id: "todo-1", content: "Deploy preview", status: "pending" },
    ]);
  });

  test("accepts a root todo array", () => {
    expect(normalizeTodoInput(validTodos)).toEqual(validTodos);
  });

  test("drops unsalvageable values", () => {
    expect(normalizeTodoInput(undefined)).toEqual([]);
    expect(normalizeTodoInput("not json")).toEqual([]);
    expect(normalizeTodoInput({ todos: 42 })).toEqual([]);
    expect(normalizeTodoInput({ todos: [{ status: "pending" }] })).toEqual([]);
  });
});
