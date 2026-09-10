import { socketTokenService } from "./socketToken.service";
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

describe("socketTokenService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getSocketToken", () => {
    it("POSTs an empty body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "ok",
        data: { token: "abc", expiresIn: 60 },
      });

      const res = await socketTokenService.getSocketToken();

      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/auth/socket-token",
        {},
      );
      expect(res).toEqual({ token: "abc", expiresIn: 60 });
    });
  });
});
