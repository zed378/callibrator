/**
 * S-01 / ADR-042 — which store an editor image goes to.
 *
 * A blog/news image is PUBLISHED, so it must go to the public media class
 * (`/uploads/public/cms/...`). Any other editor (tickets) is tenant-internal,
 * so its image is an attachment whose url is the GATED download route. Before
 * this change both went to attachments and got a permanent unauthenticated
 * `/uploads/attachments/...` URL.
 */
import { uploadImage } from "../RichTextEditor";
import { attachmentService } from "@/api/services/attachment.service";
import { contentService } from "@/api/services/content.service";

jest.mock("@/api/services/attachment.service", () => ({
  attachmentService: { upload: jest.fn() },
}));
jest.mock("@/api/services/content.service", () => ({
  contentService: { media: { upload: jest.fn() } },
}));

const file = new File(["x"], "a.png", { type: "image/png" });

beforeEach(() => jest.clearAllMocks());

describe("RichTextEditor uploadImage", () => {
  it("S-01: a post image goes to the public CMS media class", async () => {
    (contentService.media.upload as jest.Mock).mockResolvedValue({ url: "/uploads/public/cms/a.png" });
    await expect(uploadImage(file, "post")).resolves.toBe("/uploads/public/cms/a.png");
    expect(attachmentService.upload).not.toHaveBeenCalled();
  });

  it("S-01: a ticket image stays a (gated) attachment", async () => {
    (attachmentService.upload as jest.Mock).mockResolvedValue({ url: "/api/v1/attachments/1/download" });
    await expect(uploadImage(file, "Ticket")).resolves.toBe("/api/v1/attachments/1/download");
    expect(attachmentService.upload).toHaveBeenCalledWith({ file, resourceType: "Ticket" });
    expect(contentService.media.upload).not.toHaveBeenCalled();
  });

  it("returns null when the upload fails or yields no url", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (contentService.media.upload as jest.Mock).mockRejectedValue(new Error("403"));
    await expect(uploadImage(file, "post")).resolves.toBeNull();
    (contentService.media.upload as jest.Mock).mockResolvedValue(undefined);
    await expect(uploadImage(file, "post")).resolves.toBeNull();
    (attachmentService.upload as jest.Mock).mockResolvedValue({});
    await expect(uploadImage(file, "Ticket")).resolves.toBeNull();
  });
});
