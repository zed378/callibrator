/**
 * Tests for user avatar upload functions (consolidated into user.service.js)
 */

// Mock appError first with proper constructor signature matching service usage
jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(message, status, isOperational, details) {
      // Handle both (status, message) and (message, status) signatures
      let actualStatus, actualMessage;
      if (typeof message === "number") {
        actualStatus = message;
        actualMessage = status;
      } else {
        actualMessage = message;
        actualStatus = status;
      }
      super(actualMessage);
      this.name = "AppError";
      this.status = actualStatus || 500;
      this.isOperational = isOperational !== false;
    }
  }
  return { AppError };
});

// Mock dependencies before importing service
jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(),
  getUploadUrl: jest.fn((filename, folder) => `/${folder}/${filename}`),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../../models", () => ({
  Users: {
    findByPk: jest.fn(),
  },
}));

const { deleteUpload, getUploadUrl } = require("../../utils/upload.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const { AppError } = require("../../utils/appError.util");
const {
  updateUserAvatar,
  removeUserAvatar,
} = require("../../services/user.service");
const { Users } = require("../../models");

describe("user avatar upload (consolidated into user.service)", () => {
  const mockUser = {
    id: "user-123",
    picture: "/uploads/profile/old-avatar.png",
    update: jest.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Users.findByPk.mockResolvedValue(mockUser);
    deleteUpload.mockResolvedValue(undefined);
    getUploadUrl.mockImplementation(
      (filename, folder) => `/${folder}/${filename}`,
    );
  });

  describe("updateUserAvatar", () => {
    it("should update user avatar successfully", async () => {
      const result = await updateUserAvatar(
        "user-123",
        "new-avatar.png",
        "user-123",
      );

      expect(deleteUpload).toHaveBeenCalledWith(
        "old-avatar.png",
        "uploads/profile",
      );
      expect(mockUser.update).toHaveBeenCalledWith(
        { avatarUrl: "new-avatar.png" },
        { silent: true },
      );
      expect(logger.info).toHaveBeenCalledWith(
        "User avatar updated: user-123 by user-123",
      );
      expect(result).toEqual({
        data: { avatar: "new-avatar.png" },
        message: "User avatar updated successfully",
        status: 200,
      });
    });

    it("should handle user without existing avatar", async () => {
      Users.findByPk.mockResolvedValue({
        ...mockUser,
        picture: null,
      });

      const result = await updateUserAvatar(
        "user-123",
        "new-avatar.png",
        "user-123",
      );

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(mockUser.update).toHaveBeenCalledWith(
        { avatarUrl: "new-avatar.png" },
        { silent: true },
      );
      expect(result).toEqual({
        data: { avatar: "new-avatar.png" },
        message: "User avatar updated successfully",
        status: 200,
      });
    });

    it("should throw 404 when user not found", async () => {
      Users.findByPk.mockResolvedValue(null);

      await expect(
        updateUserAvatar("invalid-id", "new-avatar.png", "user-123"),
      ).rejects.toThrow("User not found");
    });

    it("should continue if old avatar deletion fails", async () => {
      deleteUpload.mockRejectedValue(new Error("File not found"));

      const result = await updateUserAvatar(
        "user-123",
        "new-avatar.png",
        "user-123",
      );

      expect(logger.warn).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe("removeUserAvatar", () => {
    it("should remove user avatar successfully", async () => {
      const result = await removeUserAvatar("user-123", "user-123");

      expect(deleteUpload).toHaveBeenCalledWith(
        "old-avatar.png",
        "uploads/profile",
      );
      expect(mockUser.update).toHaveBeenCalledWith(
        { avatarUrl: "default.svg" },
        { silent: true },
      );
      expect(logger.info).toHaveBeenCalledWith(
        "User avatar removed: user-123 by user-123",
      );
      expect(result).toEqual({
        data: { avatar: "default.svg" },
        message: "User avatar removed successfully",
        status: 200,
      });
    });

    it("should do nothing if user has no avatar", async () => {
      Users.findByPk.mockResolvedValue({
        ...mockUser,
        picture: null,
      });

      const result = await removeUserAvatar("user-123", "user-123");

      expect(deleteUpload).not.toHaveBeenCalled();
      expect(mockUser.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: { avatar: "default.svg" },
        message: "User avatar removed successfully",
        status: 200,
      });
    });

    it("should throw 404 when user not found", async () => {
      Users.findByPk.mockResolvedValue(null);

      await expect(removeUserAvatar("invalid-id", "user-123")).rejects.toThrow(
        "User not found",
      );
    });
  });
});
