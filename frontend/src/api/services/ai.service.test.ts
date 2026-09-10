import { aiService } from "./ai.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

describe("aiService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("ocr", () => {
    it("POSTs a multipart FormData with the file to /api/v1/ai/ocr and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ certificateNumber: "CN-1", status: "PASS" }),
      );

      const file = new File(["bytes"], "cert.pdf", { type: "application/pdf" });
      const res = await aiService.ocr(file);

      expect(mockedApi.post).toHaveBeenCalledTimes(1);
      const [url, body] = mockedApi.post.mock.calls[0];
      expect(url).toBe("/api/v1/ai/ocr");
      expect(body).toBeInstanceOf(FormData);
      expect((body as FormData).get("file")).toBe(file);
      expect(res).toEqual({ certificateNumber: "CN-1", status: "PASS" });
    });
  });

  describe("query", () => {
    it("POSTs { question } to /api/v1/ai/query and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ answer: "42" }));

      const res = await aiService.query("what is it?");

      expect(mockedApi.post).toHaveBeenCalledWith("/api/v1/ai/query", {
        question: "what is it?",
      });
      expect(res).toEqual({ answer: "42" });
    });
  });
});
