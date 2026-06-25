import { describe, expect, test } from "bun:test";
import { normalizeAskUserQuestionInput } from "./normalize-ask-user-question";

const validQuestion = {
  question: "Which direction?",
  header: "Direction",
  options: [
    { label: "Simple", description: "Keep it minimal" },
    { label: "Full", description: "Build everything" },
  ],
  multiSelect: false,
};

describe("normalizeAskUserQuestionInput", () => {
  test("passes through well-formed input", () => {
    expect(
      normalizeAskUserQuestionInput({ questions: [validQuestion] }),
    ).toEqual([validQuestion]);
  });

  test("parses a stringified input payload", () => {
    expect(
      normalizeAskUserQuestionInput(
        JSON.stringify({ questions: [validQuestion] }),
      ),
    ).toEqual([validQuestion]);
  });

  test("parses stringified questions and options fields", () => {
    expect(
      normalizeAskUserQuestionInput({
        questions: JSON.stringify([
          { ...validQuestion, options: JSON.stringify(validQuestion.options) },
        ]),
      }),
    ).toEqual([validQuestion]);
  });

  test("wraps a single question object into an array", () => {
    expect(normalizeAskUserQuestionInput({ questions: validQuestion })).toEqual(
      [validQuestion],
    );
  });

  test("repairs missing fields instead of crashing", () => {
    expect(
      normalizeAskUserQuestionInput({
        questions: [{ question: "Proceed with the migration?" }],
      }),
    ).toEqual([
      {
        question: "Proceed with the migration?",
        header: "Proceed with",
        options: [],
        multiSelect: false,
      },
    ]);
  });

  test("coerces string options into labels", () => {
    expect(
      normalizeAskUserQuestionInput({
        questions: [{ ...validQuestion, options: ["Yes", "No"] }],
      }),
    ).toEqual([
      {
        ...validQuestion,
        options: [
          { label: "Yes", description: "" },
          { label: "No", description: "" },
        ],
      },
    ]);
  });

  test("drops unsalvageable values", () => {
    expect(normalizeAskUserQuestionInput(undefined)).toEqual([]);
    expect(normalizeAskUserQuestionInput("not json")).toEqual([]);
    expect(normalizeAskUserQuestionInput({ questions: 42 })).toEqual([]);
    expect(
      normalizeAskUserQuestionInput({ questions: [{ header: "No text" }] }),
    ).toEqual([]);
  });
});
