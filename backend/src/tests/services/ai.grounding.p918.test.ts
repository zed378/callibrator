/**
 * P9-18 (ai): a RAG answer is instructed to come ONLY from the tenant's
 * retrieved context.
 *
 * Found by a planted defect during the conversion. Replacing the system
 * prompt with a generic "helpful assistant" left every suite green. The
 * grounding instruction is what keeps an answer from being invented ("say you
 * don't have that information"). That is the reason the query path retrieves
 * the tenant's own SOP chunks at all (AZ-02).
 */
interface ChatMessage {
  role: string;
  content: string;
}

const mockPost = jest.fn();
jest.mock("../../config", () => ({
  db: { query: jest.fn().mockResolvedValue([{ content: "Sterilise the pump weekly.", similarity: "0.9" }]) },
}));
jest.mock("../../models", () => ({
  TenantSettings: { findAll: jest.fn().mockResolvedValue([{ key: "ai_api_key", value: "k" }]) },
}));
jest.mock("axios", () => ({ post: mockPost }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const ai = require("../../services/ai.service") as {
  queryDocuments: (tenantId: string, question: string) => Promise<string | null>;
};

describe("ai — a RAG answer is grounded in the retrieved context", () => {
  it("the completion is told to answer only from the context, and is given that context", async () => {
    mockPost.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/embeddings")
          ? { data: { data: [{ embedding: [0.1] }] } }
          : { data: { choices: [{ message: { content: "Weekly." } }] } },
      ),
    );

    await expect(ai.queryDocuments("5ea5c400-0000-4000-8000-0000000000a1", "How often?")).resolves.toBe("Weekly.");

    const completion = (mockPost.mock.calls as [string, { messages: ChatMessage[] }][]).find(([url]) =>
      url.endsWith("/chat/completions"),
    );
    expect(completion).toBeDefined();
    const [system, user] = (completion as [string, { messages: ChatMessage[] }])[1].messages as [ChatMessage, ChatMessage];
    expect(system.role).toBe("system");
    expect(system.content).toMatch(/ONLY the provided document context/);
    expect(system.content).toMatch(/don't have that information/);
    expect(user.content).toContain("Sterilise the pump weekly.");
    expect(user.content).toContain("Question: How often?");
  });
});
